// Streaming downloads + release discovery helpers (GitHub, Forgejo, Dolphin, libretro buildbot).
// Node built-ins only: global fetch (undici), fs streams.
import { createHash, type Hash } from 'crypto'
import { createReadStream, createWriteStream, type WriteStream } from 'fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { hostArch, hostOs, type HostArch, type HostOs } from '../platform'
import { createLimiter } from './limit'

export const USER_AGENT = 'RetroDesk/0.1 (+https://github.com/retrodesk)'

export interface DownloadOptions {
  /** Called with bytes received so far and total bytes (0 if unknown). */
  onProgress?: (received: number, total: number) => void
  /** Called when the download has to wait for a free download slot (see MAX_CONCURRENT_DOWNLOADS). */
  onQueued?: () => void
  signal?: AbortSignal
  /** Attempts in total (default 4). */
  retries?: number
  headers?: Record<string, string>
  /** Inactivity timeout per attempt; aborts if no bytes arrive for this long (default 60s). */
  stallTimeoutMs?: number
  /** Refuse plain HTTP, on the URL itself and on every redirect hop. */
  httpsOnly?: boolean
}

export interface DownloadResult {
  bytes: number
  /** Lower-case hex SHA-256 of the file, computed while it streamed in. */
  sha256: string
  /** Validators the server sent; Last-Modified doubles as the version of nightly cores. */
  etag?: string
  lastModified?: string
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string
  ) {
    super(`HTTP ${status} for ${url}`)
    this.name = 'HttpError'
  }
}

/** The server is rate limiting us (GitHub allows 60 API requests an hour without an account). Never retried. */
export class RateLimitError extends HttpError {
  constructor(
    status: number,
    url: string,
    /** When the limit resets, if the server said. */
    public readonly resetAt?: Date
  ) {
    super(status, url)
    this.name = 'RateLimitError'
    const host = new URL(url).hostname
    const when = resetAt ? `Try again after ${resetAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : 'Try again later.'
    this.message =
      host === 'api.github.com'
        ? `GitHub allows 60 release lookups an hour without an account, and this network has used them up. ${when}`
        : `${host} is rate limiting downloads from this network. ${when}`
  }
}

/** 429, or a 403 that says the quota is used up (GitHub), with the reset time from X-RateLimit-Reset / Retry-After. */
function rateLimitError(res: Response, url: string): RateLimitError | undefined {
  const h = res.headers
  if (res.status !== 429 && !(res.status === 403 && (h.get('x-ratelimit-remaining') === '0' || h.has('retry-after')))) return undefined
  const reset = Number(h.get('x-ratelimit-reset'))
  const retryAfter = Number(h.get('retry-after'))
  const resetAt = reset > 0 ? new Date(reset * 1000) : retryAfter > 0 ? new Date(Date.now() + retryAfter * 1000) : undefined
  return new RateLimitError(res.status, url, resetAt)
}

/** The download was refused or failed verification. Never retried. */
export class UntrustedDownloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UntrustedDownloadError'
  }
}

/**
 * Hosts RetroDesk installs executables from. URLs handed to us by a release feed (GitHub / Forgejo / Dolphin)
 * must point at one of these, so a tampered feed cannot send the download somewhere else.
 */
const TRUSTED_DOWNLOAD_HOSTS = ['buildbot.libretro.com', 'github.com', 'dolphin-emu.org', 'eden-emu.dev']

export function isTrustedDownloadUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:') return false
  const host = u.hostname.toLowerCase()
  return TRUSTED_DOWNLOAD_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal))
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(abortError(signal))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })

function abortError(signal?: AbortSignal): Error {
  const r = signal?.reason
  if (r instanceof Error) return r
  const e = new Error('Download canceled')
  e.name = 'AbortError'
  return e
}

/** 4xx (except 408/429) and rate limits are permanent; everything else (network, 5xx, stalls) is worth retrying. */
function isRetryable(err: unknown): boolean {
  if (err instanceof RateLimitError) return false
  if (err instanceof HttpError) return err.status >= 500 || err.status === 408 || err.status === 429
  if (err instanceof UntrustedDownloadError) return false
  if (err instanceof Error && err.name === 'AbortError') return false
  return true
}

const MAX_REDIRECTS = 10

/** fetch() that follows redirects itself so every hop can be checked for HTTPS. */
async function fetchHttpsOnly(url: string, init: RequestInit): Promise<Response> {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (new URL(current).protocol !== 'https:') throw new UntrustedDownloadError(`Refusing a download that is not HTTPS: ${current}`)
    const res = await fetch(current, { ...init, redirect: 'manual' })
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
    if (!location) return res
    await res.body?.cancel().catch(() => undefined)
    current = new URL(location, current).toString()
  }
  throw new UntrustedDownloadError(`Too many redirects for ${url}`)
}

/** Large downloads in flight at once; "install all" queues the rest instead of saturating the disk and network. */
export const MAX_CONCURRENT_DOWNLOADS = 3
const downloadSlots = createLimiter(MAX_CONCURRENT_DOWNLOADS)

/** What earlier attempts of one downloadFile call left in the `.part` file, so a retry can resume it. */
interface PartState {
  /** Bytes handed to the file so far (checked against its size before resuming). */
  bytes: number
  /** SHA-256 of those bytes; Node can't serialize a hash, but it can keep one going across attempts. */
  hash: Hash
  /** Strong ETag or Last-Modified of what we are downloading, for If-Range. No validator, no resume. */
  validator?: string
  etag?: string
  lastModified?: string
}

/**
 * Download `url` to `dest` with progress, redirects (fetch follows them), retries with backoff, a `.part` temp
 * file and an atomic rename. A retry resumes the `.part` with a Range request when the server supports it (and
 * starts over when the file changed); on final failure/cancel the temp file is removed. At most
 * MAX_CONCURRENT_DOWNLOADS run at once; the rest wait their turn.
 */
export async function downloadFile(url: string, dest: string, opts: DownloadOptions = {}): Promise<DownloadResult> {
  return downloadSlots(() => downloadWithRetries(url, dest, opts), { signal: opts.signal, onQueued: opts.onQueued })
}

async function downloadWithRetries(url: string, dest: string, opts: DownloadOptions): Promise<DownloadResult> {
  const attempts = Math.max(1, opts.retries ?? 4)
  await mkdir(dirname(dest), { recursive: true })
  const part = `${dest}.part`
  // A .part left behind by an earlier run can't be checked against the server, so only resume our own.
  await rm(part, { force: true })
  const state: PartState = { bytes: 0, hash: createHash('sha256') }
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    if (opts.signal?.aborted) break
    try {
      const r = await downloadOnce(url, part, opts, state)
      await rm(dest, { force: true })
      await rename(part, dest)
      return r
    } catch (err) {
      lastErr = err
      if (opts.signal?.aborted || !isRetryable(err) || i === attempts - 1) break
      await sleep(Math.min(8000, 750 * 2 ** i), opts.signal).catch(() => undefined)
    }
  }
  await rm(part, { force: true }).catch(() => undefined)
  if (opts.signal?.aborted) throw abortError(opts.signal)
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

function resetPart(state: PartState): void {
  state.bytes = 0
  state.hash = createHash('sha256')
}

const result = (s: PartState): DownloadResult => ({ bytes: s.bytes, sha256: s.hash.copy().digest('hex'), etag: s.etag, lastModified: s.lastModified })

async function downloadOnce(url: string, part: string, opts: DownloadOptions, state: PartState): Promise<DownloadResult> {
  const onDisk = await fileSize(part)
  const resume = onDisk > 0 && !!state.validator
  if (!resume) resetPart(state)
  else if (onDisk !== state.bytes) {
    // A failed write can leave fewer bytes on disk than we hashed; re-hash what is really there.
    state.hash = await hashFile(part)
    state.bytes = onDisk
  }
  const ctrl = new AbortController()
  const stallMs = opts.stallTimeoutMs ?? 60_000
  const onOuterAbort = () => ctrl.abort(opts.signal?.reason)
  opts.signal?.addEventListener('abort', onOuterAbort, { once: true })
  let stallTimer: NodeJS.Timeout | undefined
  const armStall = () => {
    clearTimeout(stallTimer)
    stallTimer = setTimeout(() => ctrl.abort(new Error(`Download stalled (no data for ${stallMs / 1000}s)`)), stallMs)
  }
  armStall()
  let out: WriteStream | undefined
  let outClosed: Promise<void> = Promise.resolve()
  try {
    // identity: byte offsets in Range must match the bytes we wrote, so no transparent decompression.
    const headers: Record<string, string> = { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'identity', ...opts.headers }
    if (resume) Object.assign(headers, { Range: `bytes=${state.bytes}-`, 'If-Range': state.validator! })
    const init: RequestInit = { headers, redirect: 'follow', signal: ctrl.signal }
    const res = opts.httpsOnly ? await fetchHttpsOnly(url, init) : await fetch(url, init)
    if (res.status === 416 && resume) {
      // Nothing left to send: either the previous attempt got everything, or the file shrank under us.
      await res.body?.cancel().catch(() => undefined)
      if (Number(/^bytes \*\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1]) === state.bytes) return result(state)
      resetPart(state)
      await rm(part, { force: true })
      throw new Error('The server refused to resume the download')
    }
    if (!res.ok || !res.body) throw new HttpError(res.status, url)
    let total: number
    if (res.status === 206) {
      const range = /^bytes (\d+)-\d+\/(\d+|\*)$/.exec(res.headers.get('content-range') ?? '')
      if (!resume || Number(range?.[1]) !== state.bytes) {
        await res.body.cancel().catch(() => undefined)
        resetPart(state)
        throw new Error('The server sent an unexpected part of the file')
      }
      total = range?.[2] === '*' ? 0 : Number(range![2])
    } else {
      // 200: the whole file (no resume, or If-Range said it changed), so start over.
      resetPart(state)
      total = Number(res.headers.get('content-length') ?? 0) || 0
    }
    state.etag = res.headers.get('etag') ?? undefined
    state.lastModified = res.headers.get('last-modified') ?? undefined
    state.validator = state.etag && !state.etag.startsWith('W/') ? state.etag : state.lastModified
    const file = createWriteStream(part, { flags: res.status === 206 ? 'a' : 'w' })
    out = file
    const outDone = new Promise<void>((resolve, reject) => {
      file.on('finish', resolve)
      file.on('error', reject)
    })
    outDone.catch(() => undefined) // handled below; avoid unhandled rejection noise
    outClosed = new Promise<void>((resolve) => file.on('close', resolve))
    opts.onProgress?.(state.bytes, total)
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      armStall()
      state.hash.update(value)
      state.bytes += value.byteLength
      // A failed write (disk full, drive removed) never emits 'drain'; outDone rejects instead.
      if (!file.write(value)) await Promise.race([new Promise<void>((r) => file.once('drain', r)), outDone])
      opts.onProgress?.(state.bytes, total)
    }
    file.end()
    await outDone
    await outClosed
    if (total && state.bytes !== total) throw new Error(`Incomplete download: ${state.bytes} of ${total} bytes`)
    return result(state)
  } catch (err) {
    out?.destroy()
    await outClosed
    // Surface the reason the controller was aborted with (stall / cancel), not undici's generic message.
    if (ctrl.signal.aborted && ctrl.signal.reason instanceof Error) throw ctrl.signal.reason
    throw err
  } finally {
    clearTimeout(stallTimer)
    opts.signal?.removeEventListener('abort', onOuterAbort)
  }
}

function hashFile(file: string): Promise<Hash> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    const s = createReadStream(file)
    s.on('data', (d) => h.update(d))
    s.on('error', reject)
    s.on('end', () => resolve(h))
  })
}

/**
 * Check a finished download against what the release feed said about it. Throws on mismatch. Pass what
 * downloadFile returned as `actual` to skip re-reading the file.
 */
export async function verifyDownload(file: string, expected: { size?: number; sha256?: string }, actual?: Pick<DownloadResult, 'bytes' | 'sha256'>): Promise<void> {
  if (expected.size !== undefined) {
    const size = actual?.bytes ?? (await stat(file)).size
    if (size !== expected.size) throw new UntrustedDownloadError(`${basename(file)} is ${size} bytes, expected ${expected.size}`)
  }
  if (expected.sha256 && (actual?.sha256 ?? (await hashFile(file)).digest('hex')) !== expected.sha256.toLowerCase()) {
    throw new UntrustedDownloadError(`${basename(file)} does not match its published SHA-256`)
  }
}

/**
 * downloadFile for anything RetroDesk will go on to execute: the URL must be on a trusted host, every redirect
 * hop must be HTTPS, and the result is checked against the size / SHA-256 the release feed published, if any.
 */
export async function downloadTrusted(url: string, dest: string, opts: DownloadOptions & { size?: number; sha256?: string } = {}): Promise<DownloadResult> {
  if (!isTrustedDownloadUrl(url)) throw new UntrustedDownloadError(`Refusing to download from an untrusted location: ${url}`)
  const r = await downloadFile(url, dest, { ...opts, httpsOnly: true })
  try {
    await verifyDownload(dest, opts, r)
  } catch (e) {
    await rm(dest, { force: true }).catch(() => undefined)
    throw e
  }
  return r
}

export interface FetchTextInit {
  headers?: Record<string, string>
  signal?: AbortSignal
  /** Attempts in total (default 3). */
  retries?: number
  /** Per attempt (default 10s): metadata is small, so a server that is this slow is better given up on. */
  timeoutMs?: number
}

/** GET with retries for small metadata. 304 counts as success (for conditional requests); rate limits throw RateLimitError. */
async function fetchMeta(url: string, init: FetchTextInit = {}): Promise<{ status: number; headers: Headers; text: string }> {
  const attempts = Math.max(1, init.retries ?? 3)
  const timeoutMs = init.timeoutMs ?? 10_000
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      const timeout = AbortSignal.timeout(timeoutMs)
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...init.headers }, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout })
      if (!res.ok && res.status !== 304) {
        await res.body?.cancel().catch(() => undefined)
        throw rateLimitError(res, url) ?? new HttpError(res.status, url)
      }
      return { status: res.status, headers: res.headers, text: await res.text() }
    } catch (err) {
      lastErr = err
      if (init.signal?.aborted || !isRetryable(err) || i === attempts - 1) break
      await sleep(500 * 2 ** i, init.signal)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

export async function fetchText(url: string, init: FetchTextInit = {}): Promise<string> {
  return (await fetchMeta(url, init)).text
}

export async function fetchJson<T>(url: string, init: { headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<T> {
  return JSON.parse(await fetchText(url, { ...init, headers: { Accept: 'application/json', ...init.headers } })) as T
}

/** Where release feed responses are cached, below the data root's downloads folder. */
export const releaseCacheDir = (downloads: string): string => join(downloads, 'release-cache')

/** GitHub counts revalidations (304s) against the unauthenticated limit too, so a recent copy is used as is. */
export const RELEASE_CACHE_MAX_AGE_MS = 15 * 60_000

interface CachedResponse {
  url: string
  etag?: string
  fetchedAt: number
  body: string
}

const cacheFile = (dir: string, key: string) => join(dir, `${createHash('sha1').update(key).digest('hex').slice(0, 16)}.json`)

async function readJsonFile<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return undefined
  }
}

async function writeJsonFile(file: string, value: unknown): Promise<void> {
  try {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(`${file}.tmp`, JSON.stringify(value))
    await rename(`${file}.tmp`, file)
  } catch (e) {
    console.warn(`[emulators] could not write ${file}`, e)
  }
}

/**
 * fetchJson through an on-disk cache in `cacheDir` (none: plain fetchJson). A copy younger than `maxAgeMs` is used
 * without asking; an older one is revalidated with If-None-Match. When the server rate-limits us, can't be
 * reached or sends garbage, any cached copy beats failing the install.
 */
export async function fetchJsonCached<T>(url: string, init: { headers?: Record<string, string>; signal?: AbortSignal; cacheDir?: string; maxAgeMs?: number } = {}): Promise<T> {
  if (!init.cacheDir) return fetchJson<T>(url, init)
  const file = cacheFile(init.cacheDir, url)
  const hit = await readJsonFile<CachedResponse>(file)
  const cached = hit?.url === url && typeof hit.body === 'string' ? hit : undefined
  const age = cached ? Date.now() - cached.fetchedAt : Infinity
  if (cached && age >= 0 && age < (init.maxAgeMs ?? RELEASE_CACHE_MAX_AGE_MS)) return JSON.parse(cached.body) as T
  try {
    const headers: Record<string, string> = { Accept: 'application/json', ...init.headers }
    if (cached?.etag) headers['If-None-Match'] = cached.etag
    const res = await fetchMeta(url, { headers, signal: init.signal })
    const body = res.status === 304 && cached ? cached.body : res.text
    const value = JSON.parse(body) as T
    await writeJsonFile(file, { url, etag: res.headers.get('etag') ?? cached?.etag, fetchedAt: Date.now(), body } satisfies CachedResponse)
    return value
  } catch (e) {
    if (init.signal?.aborted || !cached || !(e instanceof RateLimitError || isRetryable(e))) throw e
    console.warn(`[emulators] using the cached copy of ${url} from ${new Date(cached.fetchedAt).toISOString()}`, e)
    return JSON.parse(cached.body) as T
  }
}

/** HEAD-less metadata probe: returns Last-Modified as YYYY-MM-DD (used as a version for nightly cores). */
export function lastModifiedToVersion(header: string | null | undefined): string | undefined {
  if (!header) return undefined
  const d = new Date(header)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------------------------
// Release discovery
// ---------------------------------------------------------------------------------------------

export interface ReleaseAsset {
  name: string
  url: string
  size?: number
  /** Lower-case hex SHA-256, when the release feed publishes one. */
  sha256?: string
}

export interface ResolvedRelease {
  version: string
  asset: ReleaseAsset
}

interface GhRelease {
  tag_name: string
  published_at?: string
  /** GitHub publishes `digest: "sha256:<hex>"` per asset; Forgejo does not. */
  assets: { name: string; browser_download_url: string; size: number; digest?: string | null }[]
}

const digestToSha256 = (digest?: string | null): string | undefined => /^sha256:([0-9a-f]{64})$/i.exec(digest ?? '')?.[1]?.toLowerCase()

/** Strip a leading "v" from tags like "v1.20.4". */
export const tagToVersion = (tag: string): string => tag.replace(/^v(?=\d)/i, '')

export function pickAsset(assets: ReleaseAsset[], pattern: RegExp): ReleaseAsset | undefined {
  return assets.find((a) => pattern.test(a.name))
}

const GITHUB_API_HEADERS = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }

/**
 * GitHub releases: `tag` undefined -> releases/latest, otherwise releases/tags/<tag> (rolling tags like
 * "continuous"/"latest", whose version is the publish date). With a `cacheDir` (see releaseCacheDir) the answer is
 * cached on disk, which keeps us inside GitHub's 60 requests/hour and lets installs proceed when rate-limited.
 */
export async function githubRelease(repo: string, assetPattern: RegExp, tag?: string, signal?: AbortSignal, cacheDir?: string): Promise<ResolvedRelease> {
  const url = tag ? `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}` : `https://api.github.com/repos/${repo}/releases/latest`
  const rel = await fetchJsonCached<GhRelease>(url, { headers: GITHUB_API_HEADERS, signal, cacheDir })
  const assets = rel.assets.map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size, sha256: digestToSha256(a.digest) }))
  const asset = pickAsset(assets, assetPattern)
  if (!asset) throw new Error(`No asset matching ${assetPattern} in ${repo} ${rel.tag_name}`)
  const version = tag ? (rel.published_at ?? '').slice(0, 10) || tag : tagToVersion(rel.tag_name)
  return { version, asset }
}

/** Forgejo/Gitea: GET <api>/repos/<owner>/<repo>/releases?limit=1 (newest first). */
export async function forgejoLatestRelease(apiBase: string, repo: string, assetPattern: RegExp, signal?: AbortSignal, cacheDir?: string): Promise<ResolvedRelease> {
  const rels = await fetchJsonCached<GhRelease[]>(`${apiBase.replace(/\/$/, '')}/repos/${repo}/releases?limit=1`, { signal, cacheDir })
  const rel = rels[0]
  if (!rel) throw new Error(`No releases for ${repo}`)
  const assets = rel.assets.map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size || undefined }))
  const asset = pickAsset(assets, assetPattern)
  if (!asset) throw new Error(`No asset matching ${assetPattern} in ${repo} ${rel.tag_name}`)
  return { version: tagToVersion(rel.tag_name), asset }
}

interface DolphinUpdate {
  shortrev: string
  artifacts: { system: string; url: string }[]
}

/** Dolphin's update endpoint, e.g. https://dolphin-emu.org/update/latest/beta/ */
export async function dolphinLatest(url = 'https://dolphin-emu.org/update/latest/beta/', signal?: AbortSignal, cacheDir?: string): Promise<ResolvedRelease> {
  const j = await fetchJsonCached<DolphinUpdate>(url, { signal, cacheDir })
  return parseDolphinUpdate(j)
}

/** The feed's build for `os`: "Windows x64", or the macOS one (a universal .dmg, preferred over an Intel-only one). */
export function parseDolphinUpdate(j: DolphinUpdate, os: HostOs = hostOs()): ResolvedRelease {
  const art =
    os === 'macos'
      ? (j.artifacts.find((a) => /^macos/i.test(a.system) && /universal/i.test(`${a.system} ${a.url}`)) ?? j.artifacts.find((a) => /^macos/i.test(a.system)))
      : j.artifacts.find((a) => a.system === 'Windows x64')
  if (!art) throw new Error(`Dolphin update feed has no ${os === 'macos' ? 'macOS' : 'Windows x64'} artifact`)
  return { version: j.shortrev, asset: { name: art.url.split('/').pop() ?? (os === 'macos' ? 'dolphin.dmg' : 'dolphin.7z'), url: art.url } }
}

/** Numeric dotted-version compare (1.9.9 < 1.10.0 < 1.22.2). Non-numeric parts compare as 0. */
export function semverCompare(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d < 0 ? -1 : 1
  }
  return 0
}

/** Parse the buildbot /stable/ directory listing and return the highest version (semver sort). */
export function parseBuildbotStableListing(html: string): string | undefined {
  const versions = new Set<string>()
  for (const m of html.matchAll(/href="(?:\/stable\/)?(\d+\.\d+\.\d+)\/"/g)) versions.add(m[1]!)
  return [...versions].sort(semverCompare).at(-1)
}

export const RETROARCH_FALLBACK_VERSION = '1.22.2'
/** The stable RetroArch build for `os`. The macOS one is a universal (Intel + Apple Silicon) disk image. */
export const retroArchUrl = (version: string, os: HostOs = hostOs()): string =>
  os === 'macos' ? `https://buildbot.libretro.com/stable/${version}/apple/osx/universal/RetroArch_Metal.dmg` : `https://buildbot.libretro.com/stable/${version}/windows/x86_64/RetroArch.7z`

/** How long a discovered RetroArch version is trusted (in memory and in the release cache) before asking again. */
export const RETROARCH_VERSION_MAX_AGE_MS = 60 * 60_000
/** How long the buildbot gets to answer on its own before GitHub is asked as well. */
const GITHUB_HEAD_START_MS = 2000

let raVersionMemo: { version: string; at: number } | undefined

/** Forget the remembered RetroArch version (tests). */
export function clearRetroArchVersionMemo(): void {
  raVersionMemo = undefined
}

/**
 * Latest RetroArch stable: buildbot listing raced against the GitHub API (see discoverRetroArchStable), then the
 * last version found (even if old), then the pinned fallback. Remembered for RETROARCH_VERSION_MAX_AGE_MS, in memory
 * and, with a `cacheDir`, on disk.
 */
export async function retroArchLatestStable(signal?: AbortSignal, cacheDir?: string): Promise<string> {
  const fresh = (m?: { version: string; at: number }) => !!m && Date.now() - m.at >= 0 && Date.now() - m.at < RETROARCH_VERSION_MAX_AGE_MS
  if (fresh(raVersionMemo)) return raVersionMemo!.version
  const file = cacheDir ? join(cacheDir, 'retroarch-stable.json') : undefined
  const disk = file ? await readJsonFile<{ version: string; at: number }>(file) : undefined
  const remembered = typeof disk?.version === 'string' && typeof disk.at === 'number' ? disk : undefined
  if (fresh(remembered)) return (raVersionMemo = remembered!).version
  try {
    const version = await discoverRetroArchStable(signal, cacheDir)
    raVersionMemo = { version, at: Date.now() }
    if (file) await writeJsonFile(file, raVersionMemo)
    return version
  } catch (e) {
    if (signal?.aborted) throw e
    console.warn('[emulators] RetroArch version lookup failed', e)
  }
  return remembered?.version ?? RETROARCH_FALLBACK_VERSION
}

/**
 * Ask the buildbot listing and the GitHub API, first answer wins. GitHub only starts once the buildbot has failed
 * or had GITHUB_HEAD_START_MS to answer, so when both are reachable the buildbot (whose folder we download from)
 * answers as before and no API request is spent; a slow or dead buildbot no longer holds things up for minutes.
 */
async function discoverRetroArchStable(signal?: AbortSignal, cacheDir?: string): Promise<string> {
  const done = new AbortController()
  const sig = signal ? AbortSignal.any([signal, done.signal]) : done.signal
  const buildbot = fetchText('https://buildbot.libretro.com/stable/', { signal: sig, retries: 2 }).then((html) => {
    const v = parseBuildbotStableListing(html)
    if (!v) throw new Error('No versions in the buildbot stable listing')
    return v
  })
  const github = (async () => {
    // Settles only when the buildbot fails; a buildbot answer leaves GitHub waiting until it is called off.
    await Promise.race([
      sleep(GITHUB_HEAD_START_MS, sig),
      buildbot.then(
        () => new Promise<never>(() => undefined),
        () => undefined
      )
    ])
    const rel = await fetchJsonCached<{ tag_name: string }>('https://api.github.com/repos/libretro/RetroArch/releases/latest', { headers: GITHUB_API_HEADERS, signal: sig, cacheDir })
    const version = tagToVersion(rel.tag_name)
    // GitHub can tag a release before the buildbot folder RetroArch is downloaded from exists.
    const head = await fetch(retroArchUrl(version), { method: 'HEAD', headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.any([sig, AbortSignal.timeout(10_000)]) })
    if (!head.ok) throw new HttpError(head.status, retroArchUrl(version))
    return version
  })()
  try {
    return await Promise.any([buildbot, github])
  } catch (e) {
    if (signal?.aborted) throw abortError(signal)
    const errors = e instanceof AggregateError ? e.errors : [e]
    throw new Error(`buildbot: ${String(errors[0])}; GitHub: ${String(errors[1] ?? errors[0])}`)
  } finally {
    done.abort()
  }
}

/** Shared library extension of libretro cores on `os`. */
export const coreLibExt = (os: HostOs = hostOs()): '.dll' | '.dylib' => (os === 'macos' ? '.dylib' : '.dll')

/**
 * A nightly core build. On macOS cores are per architecture (RetroArch itself is universal, but a process loads
 * only libraries of its own architecture), and the buildbot does not have every core for both.
 */
export const coreUrl = (coreFile: string, os: HostOs = hostOs(), arch: HostArch = hostArch()): string =>
  os === 'macos'
    ? `https://buildbot.libretro.com/nightly/apple/osx/${arch === 'arm64' ? 'arm64' : 'x86_64'}/latest/${coreFile}.dylib.zip`
    : `https://buildbot.libretro.com/nightly/windows/x86_64/latest/${coreFile}.dll.zip`

export async function fileSize(p: string): Promise<number> {
  try {
    return (await stat(p)).size
  } catch {
    return 0
  }
}
