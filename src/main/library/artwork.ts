import { createHash } from 'crypto'
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'fs/promises'
import { dirname, extname, join } from 'path'
import type { Game, MediaKind, Settings } from '../../shared/types'
import { getSystemDef } from '../systems'
import { createLimiter } from './limiter'
import { appIdFromPath, findLocalSteamArt } from './steam'
import { matchKey, parseRomName } from './titles'
import { errMsg, mapLimit, mediaFileName, sleep, thumbnailSafeName } from './util'

/**
 * Artwork from libretro-thumbnails (no API key) and Steam's CDN / local cache.
 *
 * Layout: <media>/<systemId>/<kind>/<rawName>.png   (Steam: <media>/steam/<kind>/<appid>.jpg)
 * Directory listings of thumbnails.libretro.com are cached for 24h in <media>/_index/<Folder>.json, artwork they
 * do not have in <media>/_index/misses.json.
 */

export const THUMBNAILS_BASE = 'https://thumbnails.libretro.com'
const INDEX_TTL_MS = 24 * 60 * 60 * 1000
const ARCADE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const FBNEO_DAT_URL = 'https://raw.githubusercontent.com/libretro/FBNeo/master/dats/FinalBurn%20Neo%20(ClrMame%20Pro%20XML%2C%20Arcade%20only).dat'
const STEAM_CDNS = ['https://cdn.cloudflare.steamstatic.com/steam/apps', 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps']

export const KIND_DIRS: Record<MediaKind, string> = { boxart: 'Named_Boxarts', snap: 'Named_Snaps', title: 'Named_Titles' }
const KINDS: MediaKind[] = ['boxart', 'snap', 'title']
const USER_AGENT = 'RetroDesk/0.1 (+https://github.com/retrodesk)'

type Region = Settings['scraping']['preferredRegion']

// ---------------------------------------------------------------- network

export class HttpError extends Error {
  constructor(
    readonly status: number,
    url: string
  ) {
    super(`HTTP ${status} for ${url}`)
  }
}

/** GET with timeout + retries (network errors, 5xx, 429). 404 and other 4xx fail immediately. */
export async function fetchWithRetry(url: string, opts: { retries?: number; timeoutMs?: number } = {}): Promise<Response> {
  const retries = opts.retries ?? 3
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) })
      if (res.ok) return res
      if (res.status !== 429 && res.status < 500) throw new HttpError(res.status, url)
      lastErr = new HttpError(res.status, url)
    } catch (e) {
      if (e instanceof HttpError && e.status !== 429 && e.status < 500) throw e
      lastErr = e
    }
    if (attempt < retries) await sleep(400 * 2 ** attempt)
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/** Download to `dest` atomically. Returns false on 404. */
export async function downloadFile(url: string, dest: string): Promise<boolean> {
  let res: Response
  try {
    res = await fetchWithRetry(url)
  } catch (e) {
    if (e instanceof HttpError && (e.status === 404 || e.status === 403)) return false
    throw e
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 64) return false
  await mkdir(dirname(dest), { recursive: true })
  const tmp = `${dest}.part`
  await writeFile(tmp, buf)
  await rename(tmp, dest)
  return true
}

// ---------------------------------------------------------------- libretro listings

/** Thumbnail names (without .png) from an Apache directory listing. */
export function parseListing(html: string): string[] {
  const out: string[] = []
  for (const m of html.matchAll(/href="([^"?/][^"]*?)\.png"/gi)) {
    const raw = m[1]
    if (!raw) continue
    let name: string
    try {
      name = decodeURIComponent(raw)
    } catch {
      name = raw
    }
    out.push(name.replace(/&amp;/g, '&'))
  }
  return out
}

export function thumbnailUrl(folder: string, kind: MediaKind, name: string): string {
  return `${THUMBNAILS_BASE}/${encodeURIComponent(folder)}/${KIND_DIRS[kind]}/${encodeURIComponent(name)}.png`
}

/** Bump when the cached fields change meaning (including any change to matchKey): older files are rebuilt. */
const INDEX_FORMAT = 2

interface IndexFile {
  v?: number
  fetchedAt: number
  kinds: Partial<Record<string, string[]>>
  /** matchKey of each name, same order ('' for none): loading a listing then skips parseRomName over every name. */
  keys?: Partial<Record<string, string[]>>
  /** Hash of each listing. Artwork misses are recorded against it, so they expire when the listing changes. */
  versions?: Partial<Record<string, string>>
}

export interface ThumbIndex {
  names: string[]
  exact: Map<string, string>
  byKey: Map<string, string[]>
  /** matchKey per name (parallel to `names`). */
  keys: string[]
  version: string
}

export function listingVersion(names: string[]): string {
  return createHash('sha1').update(names.join('\n')).digest('hex').slice(0, 16)
}

/** Lookup tables for a listing. `keys`/`version` come from the on-disk cache when known (computing keys is the slow part). */
export function buildThumbIndex(names: string[], keys?: string[], version?: string): ThumbIndex {
  const ks = keys && keys.length === names.length ? keys : names.map((n) => matchKey(n))
  const exact = new Map<string, string>()
  const byKey = new Map<string, string[]>()
  names.forEach((n, i) => {
    exact.set(n.toLowerCase(), n)
    const k = ks[i]
    if (!k) return
    const list = byKey.get(k)
    if (list) list.push(n)
    else byKey.set(k, [n])
  })
  return { names, exact, byKey, keys: ks, version: version ?? listingVersion(names) }
}

/** Per-run cache of listings with on-disk 24h cache (stale cache is used if the network fails). */
export class LibretroIndexCache {
  private mem = new Map<string, Promise<ThumbIndex | undefined>>()
  readonly errors: string[] = []

  constructor(
    private readonly indexDir: string,
    private readonly fetchListing: (url: string) => Promise<string> = async (url) => (await fetchWithRetry(url, { timeoutMs: 60_000 })).text()
  ) {}

  get(folder: string, kind: MediaKind): Promise<ThumbIndex | undefined> {
    const key = `${folder}|${kind}`
    let p = this.mem.get(key)
    if (!p) {
      p = this.load(folder, kind)
      this.mem.set(key, p)
    }
    return p
  }

  private fileFor(folder: string): string {
    return join(this.indexDir, `${mediaFileName(folder)}.json`)
  }

  /** The cached file. One from an older format keeps its names (still usable) but loses the derived fields. */
  private async readFile(folder: string): Promise<IndexFile | undefined> {
    try {
      const data = JSON.parse(await readFile(this.fileFor(folder), 'utf8')) as IndexFile
      if (typeof data.fetchedAt !== 'number' || typeof data.kinds !== 'object' || !data.kinds) return undefined
      if (data.v !== INDEX_FORMAT) return { v: INDEX_FORMAT, fetchedAt: data.fetchedAt, kinds: data.kinds, keys: {}, versions: {} }
      return data
    } catch {
      return undefined
    }
  }

  private static fromFile(data: IndexFile, dirName: string): ThumbIndex | undefined {
    const names = data.kinds[dirName]
    return names ? buildThumbIndex(names, data.keys?.[dirName], data.versions?.[dirName]) : undefined
  }

  private async save(folder: string, dirName: string, idx: ThumbIndex, fetchedAt: number): Promise<void> {
    // Re-read before writing: other kinds of the same folder may have been saved meanwhile.
    const latest = await this.readFile(folder)
    const fresh: IndexFile = latest && Date.now() - latest.fetchedAt < INDEX_TTL_MS ? latest : { v: INDEX_FORMAT, fetchedAt, kinds: {} }
    fresh.kinds[dirName] = idx.names
    fresh.keys = { ...fresh.keys, [dirName]: idx.keys }
    fresh.versions = { ...fresh.versions, [dirName]: idx.version }
    await mkdir(this.indexDir, { recursive: true })
    const tmp = `${this.fileFor(folder)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    await writeFile(tmp, JSON.stringify(fresh))
    await rename(tmp, this.fileFor(folder))
  }

  private async load(folder: string, kind: MediaKind): Promise<ThumbIndex | undefined> {
    const dirName = KIND_DIRS[kind]
    const cached = await this.readFile(folder)
    const cachedIdx = cached && LibretroIndexCache.fromFile(cached, dirName)
    if (cached && cachedIdx && Date.now() - cached.fetchedAt < INDEX_TTL_MS) {
      // Written by an older version: store the keys computed just now so the next run can skip that work.
      if (!cached.keys?.[dirName]) await this.save(folder, dirName, cachedIdx, cached.fetchedAt).catch(() => undefined)
      return cachedIdx
    }
    try {
      const html = await this.fetchListing(`${THUMBNAILS_BASE}/${encodeURIComponent(folder)}/${dirName}/`)
      const idx = buildThumbIndex(parseListing(html))
      await this.save(folder, dirName, idx, Date.now())
      return idx
    } catch (e) {
      this.errors.push(`${folder}/${dirName}: ${errMsg(e)}`)
      return cachedIdx
    }
  }
}

// ---------------------------------------------------------------- misses

const MISS_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Game artwork libretro does not have, persisted in <media>/_index/misses.json so "fetch missing" does not search
 * for it again on every run. An entry holds the version of the listing it was checked against: it stops counting
 * once that listing changes (new thumbnails were added), and after 30 days regardless.
 */
export class ArtworkMissCache {
  private entries = new Map<string, [version: string, at: number]>()
  private dirty = false

  constructor(private readonly file: string) {}

  /** What was searched for: the same game searched under a new name (e.g. arcade names loaded) is a new search. */
  static key(folder: string, kind: MediaKind, names: string[], title: string): string {
    return createHash('sha1').update([folder, kind, title, ...names].join('\u0000')).digest('hex').slice(0, 20)
  }

  async load(): Promise<void> {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8')) as Record<string, [string, number]>
      const now = Date.now()
      for (const [k, v] of Object.entries(data)) {
        if (Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'number' && now - v[1] < MISS_TTL_MS) this.entries.set(k, [v[0], v[1]])
      }
    } catch {
      /* none yet */
    }
  }

  has(key: string, version: string): boolean {
    const e = this.entries.get(key)
    return !!e && e[0] === version && Date.now() - e[1] < MISS_TTL_MS
  }

  add(key: string, version: string): void {
    this.entries.set(key, [version, Date.now()])
    this.dirty = true
  }

  delete(key: string): void {
    if (this.entries.delete(key)) this.dirty = true
  }

  async save(): Promise<void> {
    if (!this.dirty) return
    this.dirty = false
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(Object.fromEntries(this.entries)))
    await rename(tmp, this.file)
  }
}

// ---------------------------------------------------------------- matching

const BAD_TAG = /^(beta|proto|prototype|demo|sample|kiosk|unl|pirate|hack|aftermarket|alt|program|debug|virtual console|limited run)/i

function regionOrder(preferred: Region | undefined): string[] {
  return [...new Set([preferred ?? 'USA', 'USA', 'World', 'Europe', 'Japan'])]
}

/** Choose the best thumbnail among same-title candidates. */
export function pickBest(candidates: string[], game: Pick<Game, 'regions' | 'tags'>, preferred?: Region): string | undefined {
  const order = regionOrder(preferred)
  const gameDisc = game.tags.find((t) => /^disc \d+/i.test(t))
  let best: string | undefined
  let bestScore = -Infinity
  for (const c of candidates) {
    const p = parseRomName(c)
    let s = 0
    if (game.regions.length && p.regions.length === game.regions.length && p.regions.every((r) => game.regions.includes(r))) s += 1000
    const ranks = p.regions.map((r) => order.indexOf(r)).filter((i) => i >= 0)
    s -= (ranks.length ? Math.min(...ranks) : order.length + 1) * 10
    for (const t of p.tags) if (BAD_TAG.test(t) && !game.tags.includes(t)) s -= 50
    const disc = p.tags.find((t) => /^disc \d+/i.test(t))
    if (gameDisc) s += disc?.toLowerCase() === gameDisc.toLowerCase() ? 200 : 0
    else if (disc) s += /^disc 1\b/i.test(disc) ? 5 : -5
    s -= p.tags.length
    if (s > bestScore || (s === bestScore && best !== undefined && c.length < best.length)) {
      best = c
      bestScore = s
    }
  }
  return best
}

/** Find the libretro thumbnail name for a game: exact name, exact without [tags], then fuzzy title match. */
export function matchThumbnail(index: ThumbIndex, names: string[], game: Pick<Game, 'regions' | 'tags' | 'title'>, preferred?: Region): string | undefined {
  for (const n of names) {
    const hit = index.exact.get(thumbnailSafeName(n).toLowerCase()) ?? index.exact.get(thumbnailSafeName(n.replace(/\s*\[[^\]]*\]/g, '')).toLowerCase())
    if (hit) return hit
  }
  for (const n of [...names, game.title]) {
    const k = matchKey(thumbnailSafeName(n))
    const cands = k ? index.byKey.get(k) : undefined
    if (cands?.length) return pickBest(cands, game, preferred)
  }
  return undefined
}

// ---------------------------------------------------------------- arcade names (FBNeo DAT)

export function parseFbneoDat(xml: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /<game name="([^"]+)"[^>]*>\s*<description>([^<]*)<\/description>/g
  for (const m of xml.matchAll(re)) {
    if (!m[1] || !m[2]) continue
    const desc = m[2]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
    out.set(m[1].toLowerCase(), desc)
  }
  return out
}

/** Arcade shortname -> description, cached 30 days in <indexDir>/fbneo-names.json. Undefined if unavailable. */
export async function loadArcadeNames(indexDir: string, allowNetwork: boolean): Promise<Map<string, string> | undefined> {
  const file = join(indexDir, 'fbneo-names.json')
  let cached: { fetchedAt: number; names: Record<string, string> } | undefined
  try {
    cached = JSON.parse(await readFile(file, 'utf8')) as { fetchedAt: number; names: Record<string, string> }
  } catch {
    cached = undefined
  }
  const fromCache = cached ? new Map(Object.entries(cached.names)) : undefined
  if (fromCache && (!allowNetwork || Date.now() - (cached?.fetchedAt ?? 0) < ARCADE_TTL_MS)) return fromCache
  if (!allowNetwork) return undefined
  try {
    const xml = await (await fetchWithRetry(FBNEO_DAT_URL, { timeoutMs: 120_000 })).text()
    const map = parseFbneoDat(xml)
    if (map.size < 100) return fromCache
    await mkdir(indexDir, { recursive: true })
    await writeFile(`${file}.tmp`, JSON.stringify({ fetchedAt: Date.now(), names: Object.fromEntries(map) }))
    await rename(`${file}.tmp`, file)
    return map
  } catch {
    return fromCache
  }
}

// ---------------------------------------------------------------- runner

/** Games worked on at once: file checks and matching, which are cheap. Downloads are bounded separately. */
const GAME_CONCURRENCY = 12
/** Image downloads in flight for the whole run; a game's boxart, snap and title download in parallel within it. */
const DOWNLOAD_CONCURRENCY = 10

export interface ArtworkOptions {
  mediaDir: string
  preferredRegion?: Region
  /** Re-download even if a file already exists. */
  force?: boolean
  steamPath?: string
  arcadeNames?: Map<string, string>
  onProgress?: (done: number, total: number, detail: string) => void
  /** Called as soon as a game's media changed (lets the caller persist/notify incrementally). */
  onUpdate?: (id: string, media: Game['media']) => void
  /** Can the UI load this path? Artwork left under a previous data folder cannot be, so it is copied into mediaDir. */
  isServable?: (p: string) => boolean
  /** Injected for tests. */
  index?: LibretroIndexCache
  /** Injected for tests (default: <mediaDir>/_index/misses.json). */
  misses?: ArtworkMissCache
  /** Injected for tests (default: downloadFile). */
  download?: (url: string, dest: string) => Promise<boolean>
}

/** State shared by every game of one fetchArtworkForGames call. */
interface Run {
  opts: ArtworkOptions
  index: LibretroIndexCache
  misses: ArtworkMissCache
  res: ArtworkResult
  /** Download through the run's shared connection limit. */
  download: (url: string, dest: string) => Promise<boolean>
}

export interface ArtworkResult {
  /** Media per game id (only games whose media changed). */
  updates: Map<string, Game['media']>
  downloaded: number
  /** Games with no artwork found at all. */
  notFound: number
  failed: number
  errors: string[]
}

export function mediaPath(mediaDir: string, systemId: string, kind: MediaKind, rawName: string, ext = '.png'): string {
  return join(mediaDir, systemId, kind, `${mediaFileName(rawName)}${ext}`)
}

async function nonEmptyFile(p: string | undefined): Promise<boolean> {
  if (!p) return false
  try {
    const s = await stat(p)
    return s.isFile() && s.size > 0
  } catch {
    return false
  }
}

/**
 * The image already recorded for a game, if it can still be used. One left under a previous data folder exists
 * on disk but is no longer served: copy it next to `dest` instead of downloading it again.
 */
async function usableExisting(current: string | undefined, dest: string, opts: ArtworkOptions): Promise<string | undefined> {
  if (!current || !(await nonEmptyFile(current))) return undefined
  if (!opts.isServable || opts.isServable(current)) return current
  const ext = extname(current).toLowerCase()
  const target = ext && ext !== extname(dest).toLowerCase() ? `${dest.slice(0, dest.length - extname(dest).length)}${ext}` : dest
  try {
    await mkdir(dirname(target), { recursive: true })
    await copyFile(current, target)
    return target
  } catch {
    return undefined
  }
}

async function steamArtwork(game: Game, { opts, res, download }: Run): Promise<Game['media']> {
  const appid = appIdFromPath(game.path)
  const media: Game['media'] = { ...game.media }
  if (!appid) return media
  const local = opts.steamPath ? await findLocalSteamArt(opts.steamPath, appid) : {}
  const plan: { kind: MediaKind; local?: string; files: string[] }[] = [
    { kind: 'boxart', local: local.boxart, files: ['library_600x900.jpg', 'library_600x900_2x.jpg', 'header.jpg'] },
    { kind: 'snap', local: local.hero, files: ['library_hero.jpg', 'header.jpg'] }
  ]
  for (const step of plan) {
    const dest = join(opts.mediaDir, 'steam', step.kind, `${appid}.jpg`)
    if (!opts.force) {
      const kept = (await usableExisting(media[step.kind], dest, opts)) ?? ((await nonEmptyFile(dest)) ? dest : undefined)
      if (kept) {
        media[step.kind] = kept
        continue
      }
    }
    if (step.local) {
      try {
        await mkdir(dirname(dest), { recursive: true })
        await copyFile(step.local, dest)
        media[step.kind] = dest
        res.downloaded++
        continue
      } catch {
        /* fall through to CDN */
      }
    }
    outer: for (const f of step.files) {
      for (const cdn of STEAM_CDNS) {
        try {
          if (await download(`${cdn}/${appid}/${f}`, dest)) {
            media[step.kind] = dest
            res.downloaded++
            break outer
          }
        } catch (e) {
          res.errors.push(`${game.title}: ${errMsg(e)}`)
        }
      }
    }
  }
  return media
}

async function libretroArtwork(game: Game, { opts, index, misses, res, download }: Run): Promise<Game['media']> {
  const media: Game['media'] = { ...game.media }
  const sys = getSystemDef(game.systemId)
  const folder = sys?.thumbnailsFolder
  if (!folder) return media
  const names = [game.rawName]
  if ((game.systemId === 'arcade' || game.systemId === 'neogeo') && opts.arcadeNames) {
    const desc = opts.arcadeNames.get(game.rawName.toLowerCase())
    if (desc) names.unshift(desc)
  }
  const dests = new Map(KINDS.map((kind) => [kind, mediaPath(opts.mediaDir, game.systemId, kind, game.rawName)]))
  const kept = opts.force
    ? []
    : await Promise.all(
        KINDS.map(async (kind) => {
          const dest = dests.get(kind) as string
          return (await usableExisting(media[kind], dest, opts)) ?? ((await nonEmptyFile(dest)) ? dest : undefined)
        })
      )
  // Resolve every name first (snap and title prefer the variant the boxart matched), then download them together.
  const jobs: { kind: MediaKind; name: string; dest: string; miss?: { key: string; version: string } }[] = []
  let matchedBoxart: string | undefined
  for (const [i, kind] of KINDS.entries()) {
    const have = kept[i]
    if (have) {
      media[kind] = have
      continue
    }
    const idx = await index.get(folder, kind)
    let name: string | undefined
    let miss: { key: string; version: string } | undefined
    if (idx) {
      miss = { key: ArtworkMissCache.key(folder, kind, names, game.title), version: idx.version }
      // Nothing found last time and the listing has not changed since: don't search again (unless asked to).
      if (!opts.force && misses.has(miss.key, miss.version)) continue
      if (matchedBoxart && idx.exact.has(matchedBoxart.toLowerCase())) name = matchedBoxart
      else name = matchThumbnail(idx, names, game, opts.preferredRegion)
      if (!name) {
        misses.add(miss.key, miss.version)
        continue
      }
    } else {
      // No listing (offline / server error): try the exact name directly.
      name = thumbnailSafeName(names[0] ?? game.rawName)
    }
    if (kind === 'boxart') matchedBoxart = name
    jobs.push({ kind, name, dest: dests.get(kind) as string, miss })
  }
  await Promise.all(
    jobs.map(async (j) => {
      try {
        if (await download(thumbnailUrl(folder, j.kind, j.name), j.dest)) {
          media[j.kind] = j.dest
          res.downloaded++
          if (j.miss) misses.delete(j.miss.key)
        }
        // A listed name that fails to download (403, cut-off body) is not remembered as a miss: it may work next run.
      } catch (e) {
        res.failed++
        res.errors.push(`${game.title} (${j.kind}): ${errMsg(e)}`)
      }
    })
  )
  return media
}

function sameMedia(a: Game['media'], b: Game['media']): boolean {
  return KINDS.every((k) => a[k] === b[k])
}

/** Fetch artwork for `games`. Never throws for per-game failures (they are counted and listed in `errors`). */
export async function fetchArtworkForGames(games: Game[], opts: ArtworkOptions): Promise<ArtworkResult> {
  const res: ArtworkResult = { updates: new Map(), downloaded: 0, notFound: 0, failed: 0, errors: [] }
  const indexDir = join(opts.mediaDir, '_index')
  const index = opts.index ?? new LibretroIndexCache(indexDir)
  let misses = opts.misses
  if (!misses) {
    misses = new ArtworkMissCache(join(indexDir, 'misses.json'))
    await misses.load()
  }
  const limit = createLimiter(DOWNLOAD_CONCURRENCY)
  const fetchImage = opts.download ?? downloadFile
  const run: Run = { opts, index, misses, res, download: (url, dest) => limit(() => fetchImage(url, dest)) }
  let done = 0
  await mapLimit(games, GAME_CONCURRENCY, async (g) => {
    try {
      const media = g.systemId === 'steam' ? await steamArtwork(g, run) : await libretroArtwork(g, run)
      if (!media.boxart && !media.snap && !media.title) res.notFound++
      if (!sameMedia(media, g.media)) {
        res.updates.set(g.id, media)
        opts.onUpdate?.(g.id, media)
      }
    } catch (e) {
      res.failed++
      res.errors.push(`${g.title}: ${errMsg(e)}`)
    } finally {
      done++
      opts.onProgress?.(done, games.length, g.title)
    }
  })
  // Losing the miss list only costs a repeat search next time.
  await misses.save().catch(() => undefined)
  res.errors.push(...index.errors)
  return res
}
