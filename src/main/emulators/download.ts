// Streaming downloads + release discovery helpers (GitHub, Forgejo, Dolphin, libretro buildbot).
// Node built-ins only: global fetch (undici), fs streams.
import { createHash } from 'crypto'
import { createReadStream, createWriteStream } from 'fs'
import { mkdir, rename, rm, stat } from 'fs/promises'
import { basename, dirname } from 'path'

export const USER_AGENT = 'RetroDesk/0.1 (+https://github.com/retrodesk)'

export interface DownloadOptions {
  /** Called with bytes received so far and total bytes (0 if unknown). */
  onProgress?: (received: number, total: number) => void
  signal?: AbortSignal
  /** Attempts in total (default 4). */
  retries?: number
  headers?: Record<string, string>
  /** Inactivity timeout per attempt; aborts if no bytes arrive for this long (default 60s). */
  stallTimeoutMs?: number
  /** Refuse plain HTTP, on the URL itself and on every redirect hop. */
  httpsOnly?: boolean
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
  const e = new Error('Download cancelled')
  e.name = 'AbortError'
  return e
}

/** 4xx (except 408/429) are permanent; everything else (network, 5xx, stalls) is worth retrying. */
function isRetryable(err: unknown): boolean {
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

/**
 * Download `url` to `dest` with progress, redirects (fetch follows them), retries with backoff,
 * a `.part` temp file and an atomic rename. On failure/cancel the temp file is removed.
 */
export async function downloadFile(url: string, dest: string, opts: DownloadOptions = {}): Promise<{ bytes: number }> {
  const attempts = Math.max(1, opts.retries ?? 4)
  await mkdir(dirname(dest), { recursive: true })
  const part = `${dest}.part`
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    if (opts.signal?.aborted) throw abortError(opts.signal)
    try {
      const bytes = await downloadOnce(url, part, opts)
      await rm(dest, { force: true })
      await rename(part, dest)
      return { bytes }
    } catch (err) {
      lastErr = err
      await rm(part, { force: true }).catch(() => undefined)
      if (opts.signal?.aborted) throw abortError(opts.signal)
      if (!isRetryable(err) || i === attempts - 1) break
      await sleep(Math.min(8000, 750 * 2 ** i), opts.signal)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

async function downloadOnce(url: string, part: string, opts: DownloadOptions): Promise<number> {
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
  const out = createWriteStream(part)
  const outDone = new Promise<void>((resolve, reject) => {
    out.on('finish', resolve)
    out.on('error', reject)
  })
  outDone.catch(() => undefined) // handled below; avoid unhandled rejection noise
  const outClosed = new Promise<void>((resolve) => out.on('close', resolve))
  try {
    const init: RequestInit = { headers: { 'User-Agent': USER_AGENT, ...opts.headers }, redirect: 'follow', signal: ctrl.signal }
    const res = opts.httpsOnly ? await fetchHttpsOnly(url, init) : await fetch(url, init)
    if (!res.ok || !res.body) throw new HttpError(res.status, url)
    const total = Number(res.headers.get('content-length') ?? 0) || 0
    let received = 0
    opts.onProgress?.(0, total)
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      armStall()
      received += value.byteLength
      // A failed write (disk full, drive removed) never emits 'drain'; outDone rejects instead.
      if (!out.write(value)) await Promise.race([new Promise<void>((r) => out.once('drain', r)), outDone])
      opts.onProgress?.(received, total)
    }
    out.end()
    await outDone
    await outClosed
    if (total && received !== total) throw new Error(`Incomplete download: ${received} of ${total} bytes`)
    return received
  } catch (err) {
    out.destroy()
    await outClosed
    // Surface the reason the controller was aborted with (stall / cancel), not undici's generic message.
    if (ctrl.signal.aborted && ctrl.signal.reason instanceof Error) throw ctrl.signal.reason
    throw err
  } finally {
    clearTimeout(stallTimer)
    opts.signal?.removeEventListener('abort', onOuterAbort)
  }
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    const s = createReadStream(file)
    s.on('data', (d) => h.update(d))
    s.on('error', reject)
    s.on('end', () => resolve(h.digest('hex')))
  })
}

/** Check a finished download against what the release feed said about it. Throws on mismatch. */
export async function verifyDownload(file: string, expected: { size?: number; sha256?: string }): Promise<void> {
  if (expected.size !== undefined) {
    const { size } = await stat(file)
    if (size !== expected.size) throw new UntrustedDownloadError(`${basename(file)} is ${size} bytes, expected ${expected.size}`)
  }
  if (expected.sha256 && (await sha256File(file)) !== expected.sha256.toLowerCase()) {
    throw new UntrustedDownloadError(`${basename(file)} does not match its published SHA-256`)
  }
}

/**
 * downloadFile for anything RetroDesk will go on to execute: the URL must be on a trusted host, every redirect
 * hop must be HTTPS, and the result is checked against the size / SHA-256 the release feed published, if any.
 */
export async function downloadTrusted(url: string, dest: string, opts: DownloadOptions & { size?: number; sha256?: string } = {}): Promise<{ bytes: number }> {
  if (!isTrustedDownloadUrl(url)) throw new UntrustedDownloadError(`Refusing to download from an untrusted location: ${url}`)
  const r = await downloadFile(url, dest, { ...opts, httpsOnly: true })
  try {
    await verifyDownload(dest, opts)
  } catch (e) {
    await rm(dest, { force: true }).catch(() => undefined)
    throw e
  }
  return r
}

export async function fetchText(url: string, init: { headers?: Record<string, string>; signal?: AbortSignal; retries?: number } = {}): Promise<string> {
  const attempts = Math.max(1, init.retries ?? 3)
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, ...init.headers },
        signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000)
      })
      if (!res.ok) throw new HttpError(res.status, url)
      return await res.text()
    } catch (err) {
      lastErr = err
      if (init.signal?.aborted || !isRetryable(err) || i === attempts - 1) break
      await sleep(500 * 2 ** i, init.signal)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

export async function fetchJson<T>(url: string, init: { headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<T> {
  return JSON.parse(await fetchText(url, { ...init, headers: { Accept: 'application/json', ...init.headers } })) as T
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

/**
 * GitHub releases: `tag` undefined -> releases/latest, otherwise releases/tags/<tag> (rolling tags like
 * "continuous"/"latest", whose version is the publish date).
 */
export async function githubRelease(repo: string, assetPattern: RegExp, tag?: string, signal?: AbortSignal): Promise<ResolvedRelease> {
  const url = tag ? `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}` : `https://api.github.com/repos/${repo}/releases/latest`
  const rel = await fetchJson<GhRelease>(url, { headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal })
  const assets = rel.assets.map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size, sha256: digestToSha256(a.digest) }))
  const asset = pickAsset(assets, assetPattern)
  if (!asset) throw new Error(`No asset matching ${assetPattern} in ${repo} ${rel.tag_name}`)
  const version = tag ? (rel.published_at ?? '').slice(0, 10) || tag : tagToVersion(rel.tag_name)
  return { version, asset }
}

/** Forgejo/Gitea: GET <api>/repos/<owner>/<repo>/releases?limit=1 (newest first). */
export async function forgejoLatestRelease(apiBase: string, repo: string, assetPattern: RegExp, signal?: AbortSignal): Promise<ResolvedRelease> {
  const rels = await fetchJson<GhRelease[]>(`${apiBase.replace(/\/$/, '')}/repos/${repo}/releases?limit=1`, { signal })
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
export async function dolphinLatest(url = 'https://dolphin-emu.org/update/latest/beta/', signal?: AbortSignal): Promise<ResolvedRelease> {
  const j = await fetchJson<DolphinUpdate>(url, { signal })
  return parseDolphinUpdate(j)
}

export function parseDolphinUpdate(j: DolphinUpdate): ResolvedRelease {
  const art = j.artifacts.find((a) => a.system === 'Windows x64')
  if (!art) throw new Error('Dolphin update feed has no Windows x64 artifact')
  return { version: j.shortrev, asset: { name: art.url.split('/').pop() ?? 'dolphin.7z', url: art.url } }
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
export const retroArchUrl = (version: string): string => `https://buildbot.libretro.com/stable/${version}/windows/x86_64/RetroArch.7z`

/** Latest RetroArch stable: buildbot listing first, GitHub API second, pinned fallback last. */
export async function retroArchLatestStable(signal?: AbortSignal): Promise<string> {
  try {
    const v = parseBuildbotStableListing(await fetchText('https://buildbot.libretro.com/stable/', { signal }))
    if (v) return v
  } catch (e) {
    if (signal?.aborted) throw e
    console.warn('[emulators] buildbot listing failed', e)
  }
  try {
    const rel = await fetchJson<{ tag_name: string }>('https://api.github.com/repos/libretro/RetroArch/releases/latest', { signal })
    return tagToVersion(rel.tag_name)
  } catch (e) {
    if (signal?.aborted) throw e
    console.warn('[emulators] GitHub RetroArch lookup failed', e)
  }
  return RETROARCH_FALLBACK_VERSION
}

export const coreUrl = (coreFile: string): string => `https://buildbot.libretro.com/nightly/windows/x86_64/latest/${coreFile}.dll.zip`

export async function fileSize(p: string): Promise<number> {
  try {
    return (await stat(p)).size
  } catch {
    return 0
  }
}
