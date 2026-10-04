import { copyFile, cp, mkdir, readdir, stat } from 'fs/promises'
import { basename, dirname, join } from 'path'
import type { BiosDef, BiosStatus, SystemDef } from '../../shared/types'
import { errMsg, md5File } from './util'

/**
 * BIOS / firmware checks against getPaths().bios. See systems.ts for the `file` conventions
 * (plain relative path, "dir/" for a required folder, "*" globs in the last segment).
 */

const MAX_HASH_BYTES = 64 * 1024 * 1024
const md5Cache = new Map<string, { mtimeMs: number; size: number; md5: string }>()

/** md5 of a file, cached by path + mtime + size. Undefined if missing/unreadable or too big to be a known BIOS. */
export async function cachedMd5(p: string): Promise<string | undefined> {
  try {
    const s = await stat(p)
    if (!s.isFile() || s.size > MAX_HASH_BYTES) return undefined
    const key = p.toLowerCase()
    const c = md5Cache.get(key)
    if (c && c.mtimeMs === s.mtimeMs && c.size === s.size) return c.md5
    const md5 = await md5File(p)
    md5Cache.set(key, { mtimeMs: s.mtimeMs, size: s.size, md5 })
    return md5
  } catch {
    return undefined
  }
}

export function globToRegExp(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${esc}$`, 'i')
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name)
  } catch {
    return []
  }
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
    const re = globToRegExp(basename(rel))
    const dir = join(biosDir, dirname(rel))
    const matches = (await listFiles(dir)).filter((f) => re.test(f))
    if (!matches.length) return { present: false, valid: false }
    if (!def.md5) return { present: true, valid: true }
    for (const m of matches) if ((await cachedMd5(join(dir, m))) === def.md5) return { present: true, valid: true }
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

export async function checkBios(systems: SystemDef[], biosDir: string, extraFiles: string[] = []): Promise<BiosStatus[]> {
  const out: BiosStatus[] = []
  for (const s of systems) {
    for (const b of s.bios) {
      const r = await checkEntry(b, biosDir, extraFiles)
      out.push({ systemId: s.id, file: b.file, description: b.description, required: b.required, present: r.present, valid: r.valid })
    }
  }
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
 * first segment of a BIOS entry ("Machines", "Databases", "PPSSPP") are copied recursively.
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
        await put(src, join(dirname(byGlob.file), name).replace(/\\/g, '/'))
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
