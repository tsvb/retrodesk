import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { resolve } from 'path'

/** Case- and diacritic-insensitive folding used for search and fuzzy matching. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** Normalised absolute path used for ids and comparisons (Windows paths are case-insensitive). */
export function normPath(p: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) return p.toLowerCase() // URLs such as steam://rungameid/123
  return resolve(p)
    .replace(/[\\/]+$/, '')
    .toLowerCase()
}

/** Game.id: first 16 hex chars of sha1(normalised lower-case absolute path). */
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
