import { copyFile, cp, mkdir, readdir, readFile, rename, stat, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import type { BiosDef, BiosStatus, SystemDef } from '../../shared/types'
import { errMsg, findMatching, mapLimit, md5File, type MatchedFile } from './util'

/**
 * BIOS / firmware checks against getPaths().bios. See systems.ts for the `file` conventions
 * (plain relative path, "dir/" for a required folder, "*" globs in the last segment, "**" for sub folders too).
 */

/** Switch firmware dumps store each NCA either as a file or as a folder holding the single file "00". */
const NCA_FOLDER_FILE = '00'

const MAX_HASH_BYTES = 64 * 1024 * 1024
/** BIOS entries checked at once (each may hash a file). */
const CHECK_CONCURRENCY = 4
/** Entries kept in the persisted md5 cache (oldest dropped first). */
const MAX_CACHED = 5000

interface Md5Entry {
  mtimeMs: number
  size: number
  md5: string
}
const md5Cache = new Map<string, Md5Entry>()
const hashing = new Map<string, Promise<string>>()
let cacheFile: string | undefined
let cacheLoad: Promise<void> = Promise.resolve()
let cacheDirty = false

/** Where checkBios keeps md5s between runs: with the other caches in the data root (biosDir is <data root>/bios). */
export function defaultMd5CacheFile(biosDir: string): string {
  return join(dirname(biosDir), 'media', '_index', 'bios-md5.json')
}

/** Merge the md5s saved in `file` into the in-memory cache (once per file). */
function loadMd5Cache(file: string): Promise<void> {
  if (cacheFile === file) return cacheLoad
  cacheFile = file
  cacheLoad = readFile(file, 'utf8')
    .then((txt) => {
      for (const [k, e] of Object.entries(JSON.parse(txt) as Record<string, Md5Entry>)) {
        if (!md5Cache.has(k) && typeof e?.md5 === 'string' && typeof e.mtimeMs === 'number' && typeof e.size === 'number') md5Cache.set(k, { mtimeMs: e.mtimeMs, size: e.size, md5: e.md5 })
      }
    })
    .catch(() => undefined)
  return cacheLoad
}

async function saveMd5Cache(): Promise<void> {
  if (!cacheDirty || !cacheFile) return
  cacheDirty = false
  for (const k of md5Cache.keys()) {
    if (md5Cache.size <= MAX_CACHED) break
    md5Cache.delete(k)
  }
  await mkdir(dirname(cacheFile), { recursive: true })
  const tmp = `${cacheFile}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  await writeFile(tmp, JSON.stringify(Object.fromEntries(md5Cache)))
  await rename(tmp, cacheFile)
}

/** md5 of a file, cached by path + mtime + size. Undefined if missing/unreadable or too big to be a known BIOS. */
export async function cachedMd5(p: string): Promise<string | undefined> {
  try {
    const s = await stat(p)
    if (!s.isFile() || s.size > MAX_HASH_BYTES) return undefined
    const key = p.toLowerCase()
    const c = md5Cache.get(key)
    if (c && c.mtimeMs === s.mtimeMs && c.size === s.size) return c.md5
    // The same file can back several entries (e.g. an arcade set): hash it once.
    const job = `${key}|${s.size}|${s.mtimeMs}`
    let pending = hashing.get(job)
    if (!pending) {
      pending = md5File(p).finally(() => hashing.delete(job))
      hashing.set(job, pending)
    }
    const md5 = await pending
    md5Cache.delete(key) // re-insert as the newest entry
    md5Cache.set(key, { mtimeMs: s.mtimeMs, size: s.size, md5 })
    cacheDirty = true
    return md5
  } catch {
    return undefined
  }
}

export function globToRegExp(glob: string): RegExp {
  const esc = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${esc}$`, 'i')
}

/** The files a glob entry ("ps2/*.bin", "switch/firmware/**\/*.nca") matches under the BIOS dir. */
export function globEntryMatches(biosDir: string, rel: string): Promise<MatchedFile[]> {
  const recursive = rel.includes('**/')
  const dir = join(biosDir, dirname(rel.replace('**/', '')))
  return findMatching(dir, globToRegExp(basename(rel)), { recursive, folderFile: recursive ? NCA_FOLDER_FILE : undefined })
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function checkEntry(def: BiosDef, biosDir: string, extraFiles: string[]): Promise<{ present: boolean; valid: boolean }> {
  const rel = def.file.replace(/\\/g, '/')
  if (rel.endsWith('/')) {
    try {
      const n = (await readdir(join(biosDir, rel))).length
      return { present: n > 0, valid: n > 0 }
    } catch {
      return { present: false, valid: false }
    }
  }
  if (rel.includes('*')) {
    const matches = await globEntryMatches(biosDir, rel)
    if (!matches.length) return { present: false, valid: false }
    if (!def.md5) return { present: true, valid: true }
    for (const m of matches) if ((await cachedMd5(m.path)) === def.md5.toLowerCase()) return { present: true, valid: true }
    return { present: true, valid: false }
  }
  const candidates = [join(biosDir, rel)]
  // Arcade BIOS sets also work from system/fbneo/ or next to the ROMs.
  if (rel.toLowerCase().endsWith('.zip')) {
    candidates.push(join(biosDir, 'fbneo', basename(rel)))
    for (const f of extraFiles) if (basename(f).toLowerCase() === basename(rel).toLowerCase()) candidates.push(f)
  }
  let present = false
  for (const c of candidates) {
    if (!(await exists(c))) continue
    present = true
    if (!def.md5) return { present: true, valid: true }
    if ((await cachedMd5(c)) === def.md5.toLowerCase()) return { present: true, valid: true }
  }
  return { present, valid: false }
}

/** Status of every BIOS entry, in system order. md5s are cached in `cacheFile` so unchanged files are not re-hashed. */
export async function checkBios(systems: SystemDef[], biosDir: string, extraFiles: string[] = [], cacheFile = defaultMd5CacheFile(biosDir)): Promise<BiosStatus[]> {
  await loadMd5Cache(cacheFile)
  const entries = systems.flatMap((s) => s.bios.map((b) => ({ s, b })))
  const out = await mapLimit(entries, CHECK_CONCURRENCY, async ({ s, b }): Promise<BiosStatus> => {
    const r = await checkEntry(b, biosDir, extraFiles)
    return { systemId: s.id, file: b.file, description: b.description, required: b.required, present: r.present, valid: r.valid }
  })
  // Losing the cache only costs re-hashing next time.
  await saveMd5Cache().catch(() => undefined)
  return out
}

export interface BiosImportResult {
  /** Relative destinations written. */
  imported: string[]
  /** Source files that matched nothing. */
  skipped: string[]
  errors: string[]
}

const PS2_BIOS_SIZE = 4 * 1024 * 1024

/**
 * Copy user-picked files into the BIOS dir. Matching order per file: known md5 -> exact file name ->
 * glob entry ("ps2/*.bin") -> heuristics (4 MiB PS2 dumps, Switch .nca firmware). Folders whose name is the
 * first segment of a BIOS entry ("Machines", "Databases", "PPSSPP") are copied recursively, and so is a folder
 * of Switch firmware (one holding .nca files or <id>.nca folders), into switch/firmware/.
 */
export async function importBiosFiles(paths: string[], systems: SystemDef[], biosDir: string): Promise<BiosImportResult> {
  const res: BiosImportResult = { imported: [], skipped: [], errors: [] }
  const defs = systems.flatMap((s) => s.bios)
  const put = async (src: string, rel: string): Promise<void> => {
    const dest = join(biosDir, rel)
    await mkdir(dirname(dest), { recursive: true })
    if (src.toLowerCase() !== dest.toLowerCase()) await copyFile(src, dest)
    if (!res.imported.includes(rel)) res.imported.push(rel)
  }
  for (const src of paths) {
    try {
      const st = await stat(src)
      const name = basename(src)
      const lname = name.toLowerCase()
      if (st.isDirectory()) {
        const seg = defs
          .map((d) => d.file.replace(/\\/g, '/'))
          .filter((f) => f.includes('/'))
          .map((f) => f.split('/')[0] ?? '')
          .find((s) => s && s.toLowerCase() === lname)
        if (seg) {
          await cp(src, join(biosDir, seg), { recursive: true, force: true })
          res.imported.push(`${seg}/`)
        } else if ((await readdir(src).catch(() => [] as string[])).some((f) => f.toLowerCase().endsWith('.nca'))) {
          const rel = `switch/firmware/${name}`
          await cp(src, join(biosDir, rel), { recursive: true, force: true })
          res.imported.push(`${rel}/`)
        } else res.skipped.push(src)
        continue
      }
      if (!st.isFile()) {
        res.skipped.push(src)
        continue
      }
      const md5 = await cachedMd5(src)
      const byMd5 = md5 ? defs.filter((d) => d.md5 && d.md5.toLowerCase() === md5 && !d.file.includes('*') && !d.file.endsWith('/')) : []
      if (byMd5.length) {
        for (const d of byMd5) await put(src, d.file)
        continue
      }
      const byName = defs.filter((d) => !d.file.includes('*') && !d.file.endsWith('/') && basename(d.file).toLowerCase() === lname)
      if (byName.length) {
        for (const d of byName) await put(src, d.file)
        continue
      }
      const byGlob = defs.find((d) => d.file.includes('*') && globToRegExp(basename(d.file)).test(name))
      if (byGlob) {
        await put(src, join(dirname(byGlob.file.replace('**/', '')), name).replace(/\\/g, '/'))
        continue
      }
      if (st.size === PS2_BIOS_SIZE && /scph|ps2|bios/i.test(name)) {
        await put(src, `ps2/${name}`)
        continue
      }
      if (lname.endsWith('.nca')) {
        await put(src, `switch/firmware/${name}`)
        continue
      }
      res.skipped.push(src)
    } catch (e) {
      res.errors.push(`${src}: ${errMsg(e)}`)
    }
  }
  return res
}
