import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { Game, GameQuery, SortKey } from '../../shared/types'
import { systemOrder } from '../systems'
import { fold } from './util'

/**
 * In-memory game library persisted to a versioned JSON file:
 *   { "version": 1, "games": Game[] }
 * Writes are debounced and atomic (temp file + rename); `flushSync()` is called on app quit.
 */

export const LIBRARY_FILE_VERSION = 1

interface LibraryFile {
  version: number
  games: unknown[]
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Validate/repair one persisted game. Returns undefined if unusable. */
export function sanitizeGame(v: unknown): Game | undefined {
  if (!isRecord(v)) return undefined
  const str = (k: string): string | undefined => (typeof v[k] === 'string' ? (v[k] as string) : undefined)
  const num = (k: string, d = 0): number => (typeof v[k] === 'number' && Number.isFinite(v[k]) ? (v[k] as number) : d)
  const strArr = (k: string): string[] => (Array.isArray(v[k]) ? (v[k] as unknown[]).filter((x): x is string => typeof x === 'string') : [])
  const id = str('id')
  const systemId = str('systemId')
  const path = str('path')
  if (!id || !systemId || !path) return undefined
  const media: Game['media'] = {}
  if (isRecord(v.media)) {
    for (const k of ['boxart', 'snap', 'title'] as const) {
      const m = v.media[k]
      if (typeof m === 'string' && m) media[k] = m
    }
  }
  const rawName = str('rawName') ?? path
  const g: Game = {
    id,
    systemId,
    path,
    fileName: str('fileName') ?? rawName,
    title: str('title') ?? rawName,
    rawName,
    regions: strArr('regions'),
    tags: strArr('tags'),
    sizeBytes: num('sizeBytes'),
    addedAt: num('addedAt', Date.now()),
    playTimeSec: num('playTimeSec'),
    playCount: num('playCount'),
    favorite: v.favorite === true,
    hidden: v.hidden === true,
    media
  }
  const lp = num('lastPlayedAt', -1)
  if (lp > 0) g.lastPlayedAt = lp
  const ov = str('emulatorOverride')
  if (ov) g.emulatorOverride = ov
  return g
}

export class GameStore {
  private games = new Map<string, Game>()
  private searchText = new Map<string, string>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private dirty = false
  /** When the unsaved changes started piling up (Date.now()). */
  private dirtySince = 0
  private writing: Promise<void> = Promise.resolve()

  /**
   * @param debounceMs save this long after the last change...
   * @param maxWaitMs ...but no later than this after the first unsaved one, so a steady stream of changes
   *   (artwork downloads) still reaches the disk regularly instead of only once it stops.
   */
  constructor(
    readonly file: string,
    private readonly debounceMs = 1000,
    private readonly maxWaitMs = 10_000
  ) {}

  /** Synchronous load. A corrupt file is moved aside, never thrown. */
  load(): void {
    let text: string | undefined
    try {
      text = readFileSync(this.file, 'utf8')
    } catch {
      /* first run */
    }
    this.parse(text)
  }

  /** load() with the file read off the main thread (startup, while the window opens). */
  async loadAsync(): Promise<void> {
    let text: string | undefined
    try {
      text = await readFile(this.file, 'utf8')
    } catch {
      /* first run */
    }
    this.parse(text)
  }

  private parse(text: string | undefined): void {
    this.games.clear()
    this.searchText.clear()
    if (text === undefined) return
    try {
      const data = JSON.parse(text) as unknown
      const games = isRecord(data) ? data.games : undefined
      const list: unknown[] = Array.isArray(games) ? games : Array.isArray(data) ? data : []
      for (const raw of list) {
        const g = sanitizeGame(raw)
        if (g) this.games.set(g.id, g)
      }
    } catch (e) {
      console.error(`[library] ${this.file} is corrupt, starting empty`, e)
      try {
        renameSync(this.file, `${this.file}.corrupt-${Date.now()}`)
      } catch {
        /* ignore */
      }
    }
  }

  get size(): number {
    return this.games.size
  }

  all(): Game[] {
    return [...this.games.values()]
  }

  get(id: string): Game | undefined {
    return this.games.get(id)
  }

  /** Insert or replace a game, then schedule a save. */
  put(g: Game): void {
    this.games.set(g.id, g)
    this.searchText.delete(g.id)
    this.markDirty()
  }

  remove(id: string): boolean {
    const had = this.games.delete(id)
    this.searchText.delete(id)
    if (had) this.markDirty()
    return had
  }

  /** Apply `fn` to a game in place and schedule a save. */
  update(id: string, fn: (g: Game) => void): Game | undefined {
    const g = this.games.get(id)
    if (!g) return undefined
    fn(g)
    this.searchText.delete(id)
    this.markDirty()
    return g
  }

  markDirty(): void {
    const now = Date.now()
    if (!this.dirty) this.dirtySince = now
    this.dirty = true
    if (this.timer) clearTimeout(this.timer)
    const wait = Math.max(0, Math.min(this.debounceMs, this.dirtySince + this.maxWaitMs - now))
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, wait)
  }

  private serialize(): string {
    const data: LibraryFile = { version: LIBRARY_FILE_VERSION, games: this.all() }
    return JSON.stringify(data)
  }

  /** Write now (async, atomic). Concurrent calls are serialised. */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.dirty) return this.writing
    this.dirty = false
    const body = this.serialize()
    this.writing = this.writing.then(async () => {
      try {
        await mkdir(dirname(this.file), { recursive: true })
        const tmp = `${this.file}.tmp`
        await writeFile(tmp, body)
        await rename(tmp, this.file)
      } catch (e) {
        console.error('[library] save failed', e)
        this.dirty = true
      }
    })
    return this.writing
  }

  /** Blocking write for app shutdown. */
  flushSync(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.dirty) return
    this.dirty = false
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, this.serialize())
      renameSync(tmp, this.file)
    } catch (e) {
      console.error('[library] save failed', e)
    }
  }

  private haystack(g: Game): string {
    let s = this.searchText.get(g.id)
    if (s === undefined) {
      s = fold(`${g.title} ${g.rawName}`)
      this.searchText.set(g.id, s)
    }
    return s
  }

  query(q: GameQuery = {}): Game[] {
    const tokens = q.search ? fold(q.search).split(/\s+/).filter(Boolean) : []
    const list = this.all().filter((g) => {
      if (q.systemId && g.systemId !== q.systemId) return false
      if (q.favoritesOnly && !g.favorite) return false
      if (!q.includeHidden && g.hidden) return false
      if (tokens.length) {
        const h = this.haystack(g)
        if (!tokens.every((t) => h.includes(t))) return false
      }
      return true
    })
    const cmp = comparator(q.sort ?? 'title')
    // Home asks for the first 16/30 of everything: pick those without sorting the whole library.
    if (q.limit !== undefined && q.limit >= 0) return firstSorted(list, q.limit, cmp)
    return list.sort(cmp)
  }

  recent(limit = 20): Game[] {
    const played = this.all().filter((g) => g.lastPlayedAt && !g.hidden)
    return firstSorted(played, Math.max(0, limit), (a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
  }
}

const byTitle = (a: Game, b: Game): number => collator.compare(a.title, b.title) || collator.compare(a.rawName, b.rawName)
const COMPARATORS: Record<SortKey, (a: Game, b: Game) => number> = {
  title: byTitle,
  lastPlayed: (a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) || byTitle(a, b),
  playTime: (a, b) => b.playTimeSec - a.playTimeSec || byTitle(a, b),
  added: (a, b) => b.addedAt - a.addedAt || byTitle(a, b),
  system: (a, b) => systemOrder(a.systemId) - systemOrder(b.systemId) || byTitle(a, b)
}

function comparator(sort: SortKey): (a: Game, b: Game) => number {
  return COMPARATORS[sort] ?? byTitle
}

export function sortGames(list: Game[], sort: SortKey): Game[] {
  return list.sort(comparator(sort))
}

/**
 * The first `k` items of `list` in `cmp` order, the same ones a stable sort followed by slice(0, k) gives, in
 * O(n log k) instead of O(n log n). Keeps a sorted window of the best k seen so far.
 */
export function firstSorted<T>(list: readonly T[], k: number, cmp: (a: T, b: T) => number): T[] {
  if (k <= 0) return []
  if (k >= list.length) return list.slice().sort(cmp)
  const out: T[] = []
  for (const x of list) {
    if (out.length === k && cmp(x, out[k - 1] as T) >= 0) continue
    // After any equal items already in the window, as a stable sort would place it.
    let lo = 0
    let hi = out.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cmp(x, out[mid] as T) < 0) hi = mid
      else lo = mid + 1
    }
    out.splice(lo, 0, x)
    if (out.length > k) out.pop()
  }
  return out
}
