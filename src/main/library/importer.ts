import { copyFile, cp, mkdir, readdir, stat } from 'fs/promises'
import { basename, dirname, extname, join, relative } from 'path'
import { ENTRY_POINT_EXTENSIONS } from '../systems'
import { referencedFiles } from './formats'
import { detectDirectoryGame, detectFileSystem } from './scanner'
import { errMsg, isUnder, normPath } from './util'

/**
 * Import ROMs picked by the user (file picker / drag & drop): detect the system of each file and copy it,
 * with its companion files (cue -> bins, m3u -> discs, gdi -> tracks, ccd -> img/sub), into <roms>/<systemId>/.
 * Directory-format games (PS3, Wii U) are copied as folders. Unknown files are skipped.
 */

export interface RomImportResult {
  copied: string[]
  /** Already in place (same size) or not a recognised game file. */
  skipped: string[]
  errors: string[]
}

async function expand(paths: string[], depth = 0): Promise<{ files: string[]; dirGames: { dir: string; systemId: string }[] }> {
  const files: string[] = []
  const dirGames: { dir: string; systemId: string }[] = []
  for (const p of paths) {
    let st
    try {
      st = await stat(p)
    } catch {
      continue
    }
    if (st.isFile()) files.push(p)
    else if (st.isDirectory()) {
      const dg = await detectDirectoryGame(p)
      if (dg) {
        dirGames.push({ dir: p, systemId: dg.systemId })
        continue
      }
      if (depth >= 4) continue
      let names: string[] = []
      try {
        names = await readdir(p)
      } catch {
        continue
      }
      const sub = await expand(
        names.filter((n) => !n.startsWith('.')).map((n) => join(p, n)),
        depth + 1
      )
      files.push(...sub.files)
      dirGames.push(...sub.dirGames)
    }
  }
  return { files, dirGames }
}

/** Entry point + every file it (transitively) references. */
async function withCompanions(entry: string): Promise<string[]> {
  const out = [entry]
  const seen = new Set([normPath(entry)])
  const queue = [entry]
  while (queue.length) {
    const cur = queue.shift() as string
    if (!ENTRY_POINT_EXTENSIONS.has(extname(cur).toLowerCase())) continue
    for (const r of await referencedFiles(cur)) {
      const k = normPath(r)
      if (seen.has(k)) continue
      seen.add(k)
      try {
        if ((await stat(r)).isFile()) {
          out.push(r)
          queue.push(r)
        }
      } catch {
        /* missing companion: copy what exists */
      }
    }
  }
  return out
}

async function sameSizeExists(dest: string, size: number): Promise<boolean> {
  try {
    return (await stat(dest)).size === size
  } catch {
    return false
  }
}

export async function importRomFiles(paths: string[], romsDir: string, onProgress?: (done: number, total: number, name: string) => void): Promise<RomImportResult> {
  const res: RomImportResult = { copied: [], skipped: [], errors: [] }
  const { files, dirGames } = await expand(paths)

  // Files referenced by another selected entry point are copied as its companions, not on their own.
  const companionOf = new Set<string>()
  for (const f of files) {
    if (!ENTRY_POINT_EXTENSIONS.has(extname(f).toLowerCase())) continue
    for (const c of (await withCompanions(f)).slice(1)) companionOf.add(normPath(c))
  }
  const entries = files.filter((f) => !companionOf.has(normPath(f)))
  const total = entries.length + dirGames.length
  let done = 0

  for (const g of dirGames) {
    try {
      const destDir = join(romsDir, g.systemId, basename(g.dir))
      if (isUnder(g.dir, join(romsDir, g.systemId))) res.skipped.push(g.dir)
      else {
        await mkdir(dirname(destDir), { recursive: true })
        await cp(g.dir, destDir, { recursive: true, force: false, errorOnExist: false })
        res.copied.push(destDir)
      }
    } catch (e) {
      res.errors.push(`${g.dir}: ${errMsg(e)}`)
    }
    onProgress?.(++done, total, basename(g.dir))
  }

  for (const f of entries) {
    try {
      const systemId = await detectFileSystem(f)
      if (!systemId) {
        res.skipped.push(f)
        continue
      }
      const sysDir = join(romsDir, systemId)
      if (isUnder(f, sysDir)) {
        res.skipped.push(f)
        continue
      }
      const baseDir = dirname(f)
      for (const src of await withCompanions(f)) {
        const rel = isUnder(src, baseDir) ? relative(baseDir, src) : basename(src)
        const dest = join(sysDir, rel)
        const { size } = await stat(src)
        if (await sameSizeExists(dest, size)) {
          res.skipped.push(src)
          continue
        }
        await mkdir(dirname(dest), { recursive: true })
        await copyFile(src, dest)
        res.copied.push(dest)
      }
    } catch (e) {
      res.errors.push(`${f}: ${errMsg(e)}`)
    } finally {
      onProgress?.(++done, total, basename(f))
    }
  }
  return res
}
