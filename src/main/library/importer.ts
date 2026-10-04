import { copyFile, cp, mkdir, readdir, readFile, stat } from 'fs/promises'
import { basename, dirname, extname, join, relative } from 'path'
import { ENTRY_POINT_EXTENSIONS } from '../systems'
import { referencedFiles } from './formats'
import { detectDirectoryGame, detectFileSystem } from './scanner'
import { errMsg, isUnder, normPath } from './util'

/**
 * Import ROMs picked by the user (file picker / drag & drop): detect the system of each file and copy it,
 * with its companion files (cue -> bins, m3u -> discs, gdi -> tracks, ccd -> img/sub), into <roms>/<systemId>/.
 * A multi-file game whose file names are already taken by another game goes into <roms>/<systemId>/<name>/.
 * Directory-format games (PS3, Wii U) are copied as folders. Unknown files are skipped. Nothing is overwritten.
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

interface PlannedCopy {
  src: string
  dest: string
  /** What is at `dest` now: nothing, a file of the same size, or some other file. */
  state: 'missing' | 'same' | 'different'
}

async function planCopies(sources: string[], baseDir: string, destDir: string): Promise<PlannedCopy[]> {
  const plan: PlannedCopy[] = []
  for (const src of sources) {
    const dest = join(destDir, relative(baseDir, src))
    const { size } = await stat(src)
    let state: PlannedCopy['state'] = 'missing'
    try {
      state = (await stat(dest)).size === size ? 'same' : 'different'
    } catch {
      /* nothing there yet */
    }
    plan.push({ src, dest, state })
  }
  return plan
}

/**
 * Can a multi-file game go straight into <roms>/<system>/? Only when nothing of it is there yet, or the very
 * same game is (a repeated or interrupted import). Otherwise another game owns those file names: discs
 * routinely share names like disc.gdi or track01.bin, and mixing two games' tracks corrupts both.
 */
async function fitsBesideOthers(plan: PlannedCopy[]): Promise<boolean> {
  if (plan.every((p) => p.state === 'missing')) return true
  const entry = plan[0]
  if (!entry || entry.state !== 'same' || plan.some((p) => p.state === 'different')) return false
  const [a, b] = await Promise.all([readFile(entry.src), readFile(entry.dest)])
  return a.equals(b)
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
      const sources = await withCompanions(f)
      let plan = await planCopies(sources, baseDir, sysDir)
      if (sources.length > 1 && !(await fitsBesideOthers(plan))) {
        // Give the game a folder of its own, named after its entry file.
        const own = basename(f, extname(f)).replace(/[. ]+$/, '') || 'game'
        plan = await planCopies(sources, baseDir, join(sysDir, own))
      }
      // Never overwrite a different file that is already in the library.
      const clash = plan.find((p) => p.state === 'different')
      if (clash) {
        res.errors.push(`${f}: a different file named ${basename(clash.dest)} is already in ${dirname(clash.dest)}`)
        continue
      }
      for (const p of plan) {
        if (p.state === 'same') {
          res.skipped.push(p.src)
          continue
        }
        await mkdir(dirname(p.dest), { recursive: true })
        await copyFile(p.src, p.dest)
        res.copied.push(p.dest)
      }
    } catch (e) {
      res.errors.push(`${f}: ${errMsg(e)}`)
    } finally {
      onProgress?.(++done, total, basename(f))
    }
  }
  return res
}
