import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { readdir, stat } from 'fs/promises'
import { join, resolve } from 'path'

/** Case- and diacritic-insensitive folding used for search and fuzzy matching. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** Normalized absolute path used for ids and comparisons (Windows paths are case-insensitive). */
export function normPath(p: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) return p.toLowerCase() // URLs such as steam://rungameid/123
  return resolve(p)
    .replace(/[\\/]+$/, '')
    .toLowerCase()
}

/** Game.id: first 16 hex chars of sha1(normalized lower-case absolute path). */
export function gameIdForPath(p: string): string {
  return createHash('sha1').update(normPath(p)).digest('hex').slice(0, 16)
}

/** True when `child` is `parent` or inside it (both absolute). */
export function isUnder(child: string, parent: string): boolean {
  return isUnderNorm(normPath(child), normPath(parent))
}

/** isUnder for paths already passed through normPath. */
export function isUnderNorm(c: string, p: string): boolean {
  return c === p || c.startsWith(p.endsWith('\\') ? p : `${p}\\`) || c.startsWith(`${p}/`)
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile()
  } catch {
    return false
  }
}

export async function dirExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}

export interface MatchedFile {
  /** The file to read or copy. */
  path: string
  /** The name it goes by: the file's own, or its folder's for a folder-form entry. */
  name: string
}

export interface FindMatchingOptions {
  /** Also look in sub folders (up to `depth` levels down; default 4). */
  recursive?: boolean
  depth?: number
  /**
   * A folder whose name matches counts too when it holds just this file, which then stands for the folder
   * (Switch firmware dumps store each NCA as <id>.nca/00). Nothing below such a folder is searched.
   */
  folderFile?: string
}

/** Entries in `dir` whose name matches `re`, in folder-then-name order. Missing or unreadable folders yield nothing. */
export async function findMatching(dir: string, re: RegExp, opts: FindMatchingOptions = {}): Promise<MatchedFile[]> {
  const out: MatchedFile[] = []
  const depth = opts.recursive ? (opts.depth ?? 4) : 0
  let level = [dir]
  for (let d = 0; d <= depth && level.length; d++) {
    const next: string[] = []
    for (const cur of level) {
      const entries = (await readdir(cur, { withFileTypes: true }).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name))
      for (const e of entries) {
        if (e.isFile()) {
          if (re.test(e.name)) out.push({ path: join(cur, e.name), name: e.name })
          continue
        }
        if (!e.isDirectory()) continue
        const full = join(cur, e.name)
        if (opts.folderFile && re.test(e.name)) {
          const inside = await readdir(full).catch(() => [] as string[])
          if (inside.length === 1 && inside[0] === opts.folderFile) {
            out.push({ path: join(full, opts.folderFile), name: e.name })
            continue
          }
        }
        next.push(full)
      }
    }
    level = next
  }
  return out
}

export function md5File(p: string): Promise<string> {
  return new Promise((res, rej) => {
    const h = createHash('md5')
    const s = createReadStream(p)
    s.on('data', (d) => h.update(d))
    s.on('error', rej)
    s.on('end', () => res(h.digest('hex')))
  })
}

/** Run `fn` over `items` with at most `limit` in flight. Results keep input order. `fn` should catch its own errors (one rejection rejects the whole call). */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i] as T, i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Characters RetroArch/libretro-thumbnails replace with "_" in file names. */
export function thumbnailSafeName(name: string): string {
  return name.replace(/[&*/:`"<>?\\|]/g, '_')
}

/** File-system safe name for media files (thumbnail substitution + Windows trailing dot/space rules). */
export function mediaFileName(name: string): string {
  const s = thumbnailSafeName(name)
    // oxlint-disable-next-line no-control-regex -- control characters are exactly what must not reach a file name
    .replace(/[\x00-\x1f]/g, '_')
    .replace(/[. ]+$/, '')
    .slice(0, 180)
  return s || '_'
}
