import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { mkdir, rename, writeFile } from 'fs/promises'
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
  private writing: Promise<void> = Promise.resolve()

  constructor(
    readonly file: string,
    private readonly debounceMs = 1000
  ) {}

  /** Synchronous load (startup). A corrupt file is moved aside, never thrown. */
  load(): void {
    this.games.clear()
    this.searchText.clear()
    let text: string
    try {
      text = readFileSync(this.file, 'utf8')
    } catch {
      return // first run
    }
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
    this.dirty = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, this.debounceMs)
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
    let list = this.all().filter((g) => {
      if (q.systemId && g.systemId !== q.systemId) return false
      if (q.favoritesOnly && !g.favorite) return false
      if (!q.includeHidden && g.hidden) return false
      if (tokens.length) {
        const h = this.haystack(g)
        if (!tokens.every((t) => h.includes(t))) return false
      }
      return true
    })
    list = sortGames(list, q.sort ?? 'title')
    if (q.limit !== undefined && q.limit >= 0) list = list.slice(0, q.limit)
    return list
  }

  recent(limit = 20): Game[] {
    return this.all()
      .filter((g) => g.lastPlayedAt && !g.hidden)
      .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
      .slice(0, Math.max(0, limit))
  }
}

export function sortGames(list: Game[], sort: SortKey): Game[] {
  const byTitle = (a: Game, b: Game): number => collator.compare(a.title, b.title) || collator.compare(a.rawName, b.rawName)
  const cmp: Record<SortKey, (a: Game, b: Game) => number> = {
    title: byTitle,
    lastPlayed: (a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) || byTitle(a, b),
    playTime: (a, b) => b.playTimeSec - a.playTimeSec || byTitle(a, b),
    added: (a, b) => b.addedAt - a.addedAt || byTitle(a, b),
    system: (a, b) => systemOrder(a.systemId) - systemOrder(b.systemId) || byTitle(a, b)
  }
  return list.sort(cmp[sort] ?? byTitle)
}
