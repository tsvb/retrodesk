import type { Dirent } from 'fs'
import { readdir, stat } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import type { MediaKind } from '../../shared/types'
import {
  ENTRY_POINT_EXTENSIONS,
  GENERIC_EXTENSIONS,
  getSystemDef,
  matchFolderToSystem,
  systemsForExtension,
  uniqueSystemForExtension
} from '../systems'
import { readParamSfoTitle, readWiiUTitle, referencedFiles } from './formats'
import { looksLikeText, sniffSystem } from './sniff'
import { parseRomName } from './titles'
import { errMsg, mapLimit, normPath } from './util'

/**
 * ROM folder scanner. Pure file-system logic (no Electron), so it is unit-testable.
 *
 * Path conventions for directory-format games (Game.path):
 *  - PS3: the game FOLDER (the one containing PS3_GAME/ or USRDIR/, or a folder named "*.ps3").
 *    RPCS3 boots a folder passed on the command line (`rpcs3 --no-gui <folder>`).
 *  - Wii U (loose/extracted "code/content/meta" layout): the .rpx FILE inside code/ (Cemu `-g` needs a file).
 *    Title comes from meta/meta.xml, rawName is the game folder name.
 *  - Vita: .vpk / .zip files, or an extracted game FOLDER containing sce_sys/param.sfo + eboot.bin.
 */

export interface ScanRoot {
  path: string
  systemId?: string
}

export interface ScannedGame {
  path: string
  systemId: string
  fileName: string
  rawName: string
  title: string
  regions: string[]
  tags: string[]
  sizeBytes: number
  /** Images found next to the game (same basename) or inside a directory-format game. */
  localMedia: Partial<Record<MediaKind, string>>
}

/**
 * A game already in the library. Its size saves measuring it again, and its system saves sniffing the disc
 * header of an ambiguous file (.iso/.bin in a folder named after no system) as long as the size still matches.
 */
export interface KnownGame {
  sizeBytes: number
  systemId: string
}

export interface ScanProgress {
  phase: 'walk' | 'process'
  dirs: number
  files: number
  done?: number
  total?: number
}

export interface ScanOptions {
  roots: ScanRoot[]
  /** Absolute directories never entered (bios, saves, media, emulators...). */
  excludeDirs?: string[]
  /** What earlier scans found, by normPath of the game path. See KnownGame. */
  known?: Map<string, KnownGame>
  /**
   * Take the sizes in `known` as they are instead of measuring those files again (one stat per file, slow on
   * USB/NAS). A file whose size changed keeps its old size until a scan without this flag.
   * Directory-format games always reuse a known size: measuring one walks the whole folder.
   */
  trustKnownSizes?: boolean
  /** Arcade zip short name (lower-case) -> full description, e.g. mslug -> "Metal Slug - Super Vehicle-001". */
  arcadeNames?: Map<string, string>
  onProgress?: (p: ScanProgress) => void
  /** Max nesting below a root (default 12). */
  maxDepth?: number
}

export interface ScanOutput {
  games: ScannedGame[]
  /** Roots that could not be read (offline drive etc.): callers should keep their games. */
  unreachableRoots: string[]
  /** Sub-folders that could not be read this time (permissions, a network hiccup): their games are not "gone" either. */
  unreadableDirs: string[]
  /** Arcade BIOS zips seen in ROM folders (neogeo.zip etc.), absolute paths. */
  biosFiles: string[]
  errors: string[]
}

/** Folder names never entered. */
const ALWAYS_SKIP = new Set([
  'system volume information', '$recycle.bin', 'recycler', 'downloaded_media', 'media', 'images', 'videos', 'manuals',
  'snaps', 'boxart', 'boxarts', 'covers', 'thumbnails', 'screenshots', 'saves', 'savestates', 'states', 'cheats',
  'shaders', 'overlays', 'node_modules', 'bios'
])
/** Folder names skipped while we don't yet know which system we're in (emulator installs, OS folders). */
const UNKNOWN_SKIP = new Set([
  'emulators', 'retroarch', 'system', 'tools', 'storage', 'windows', 'program files', 'program files (x86)', 'programdata',
  'appdata', 'steamapps', 'steamlibrary', 'es-de', 'emulationstation', 'launchbox', 'playnite'
])

/** Arcade BIOS / device sets that are not games. */
export const ARCADE_BIOS_ZIPS = new Set([
  'neogeo', 'pgm', 'skns', 'decocass', 'isgsm', 'nmk004', 'cchip', 'qsound', 'bubsys', 'midssio', 'megatech', 'megaplay',
  'stvbios', 'hng64', 'naomi', 'naomi2', 'awbios', 'cpzn1', 'cpzn2', 'coh1000c', 'coh1000t', 'coh3002c', 'konamigx',
  'ym2608', 'ym2413', 'namcoc69', 'namcoc70', 'namcoc75', 'n64', 'pgm2', 'triforce', 'chihiro', 'f355bios', 'hod2bios',
  'kof2000n', 'neocdz', 'sp1', 'segasp', 'atomiswave', 'galaxian', 'spectrum', 'msx', 'channelf', 'fdsbios'
])

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp']
const SNIFFABLE = new Set(['.iso', '.bin', '.img', '.chd', '.gcm'])

interface DirJob {
  path: string
  systemId?: string
  depth: number
}

interface Candidate {
  path: string
  /** Undefined until resolved by sniffing. */
  systemId?: string
  /** Systems allowed when sniffing (ambiguous extension in an unknown folder). */
  sniffAmong?: string[]
  localMedia: Partial<Record<MediaKind, string>>
}

interface DirGame {
  path: string
  folder: string
  systemId: string
  rawName: string
  title?: string
  localMedia: Partial<Record<MediaKind, string>>
}

const lower = (s: string): string => s.toLowerCase()

function isHiddenName(name: string): boolean {
  return name.startsWith('.') || name.startsWith('$') || name.startsWith('~')
}

async function direntIsDir(dirPath: string, e: Dirent): Promise<boolean> {
  if (e.isDirectory()) return true
  if (!e.isSymbolicLink()) return false
  try {
    return (await stat(join(dirPath, e.name))).isDirectory()
  } catch {
    return false
  }
}

async function direntIsFile(dirPath: string, e: Dirent): Promise<boolean> {
  if (e.isFile()) return true
  if (!e.isSymbolicLink()) return false
  try {
    return (await stat(join(dirPath, e.name))).isFile()
  } catch {
    return false
  }
}

function findName(names: string[], wanted: string): string | undefined {
  const w = wanted.toLowerCase()
  return names.find((n) => n.toLowerCase() === w)
}

/** Detect a PS3 / Vita / Wii U directory-format game in `dir`. */
async function detectDirGame(dir: string, dirNames: string[], fileNames: string[], systemId: string | undefined): Promise<DirGame | undefined> {
  const folder = basename(dir)
  if (!systemId || systemId === 'ps3') {
    const ps3Game = findName(dirNames, 'PS3_GAME')
    const usrdir = findName(dirNames, 'USRDIR')
    const isPs3Suffix = /\.ps3$/i.test(folder)
    if (ps3Game || (usrdir && findName(fileNames, 'PARAM.SFO')) || isPs3Suffix) {
      const sfo = ps3Game ? join(dir, ps3Game, 'PARAM.SFO') : join(dir, 'PARAM.SFO')
      const { title } = await readParamSfoTitle(sfo)
      const mediaDir = ps3Game ? join(dir, ps3Game) : dir
      let mediaNames: string[] = []
      try {
        mediaNames = await readdir(mediaDir)
      } catch {
        /* ignore */
      }
      const localMedia: Partial<Record<MediaKind, string>> = {}
      const pic1 = findName(mediaNames, 'PIC1.PNG')
      const icon0 = findName(mediaNames, 'ICON0.PNG')
      if (pic1) localMedia.snap = join(mediaDir, pic1)
      if (icon0) localMedia.title = join(mediaDir, icon0)
      return { path: dir, folder: dir, systemId: 'ps3', rawName: folder.replace(/\.ps3$/i, ''), title, localMedia }
    }
  }
  if (!systemId || systemId === 'vita') {
    // Extracted/installed Vita game: <folder>/sce_sys/param.sfo + eboot.bin. The launcher reads TITLE_ID from it.
    const sceSys = findName(dirNames, 'sce_sys')
    if (sceSys && findName(fileNames, 'eboot.bin')) {
      const { title } = await readParamSfoTitle(join(dir, sceSys, 'param.sfo'))
      return { path: dir, folder: dir, systemId: 'vita', rawName: folder, title, localMedia: {} }
    }
  }
  if (!systemId || systemId === 'wiiu') {
    const code = findName(dirNames, 'code')
    if (code && (findName(dirNames, 'content') || findName(dirNames, 'meta'))) {
      let codeFiles: string[] = []
      try {
        codeFiles = await readdir(join(dir, code))
      } catch {
        return undefined
      }
      const rpx = codeFiles.find((n) => n.toLowerCase().endsWith('.rpx'))
      if (!rpx) return undefined
      const meta = findName(dirNames, 'meta')
      const title = meta ? await readWiiUTitle(join(dir, meta, 'meta.xml')) : undefined
      return { path: join(dir, code, rpx), folder: dir, systemId: 'wiiu', rawName: folder, title, localMedia: {} }
    }
  }
  return undefined
}

/** Total size of a directory tree (bounded). */
async function dirSize(dir: string, budget = { entries: 50_000 }): Promise<number> {
  let total = 0
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  const subdirs: string[] = []
  const files: string[] = []
  for (const e of entries) {
    if (--budget.entries < 0) break
    if (e.isDirectory()) subdirs.push(join(dir, e.name))
    else if (e.isFile()) files.push(join(dir, e.name))
  }
  const sizes = await mapLimit(files, 32, async (f) => {
    try {
      return (await stat(f)).size
    } catch {
      return 0
    }
  })
  for (const s of sizes) total += s
  for (const d of subdirs) total += await dirSize(d, budget)
  return total
}

/** Arcade short name -> display title (via the FBNeo DAT map when available). */
function titleFor(rawName: string, systemId: string, arcadeNames?: Map<string, string>): ReturnType<typeof parseRomName> {
  if ((systemId === 'arcade' || systemId === 'neogeo') && arcadeNames) {
    const desc = arcadeNames.get(rawName.toLowerCase())
    if (desc) return parseRomName(desc)
  }
  return parseRomName(rawName)
}

export async function scanFolders(opts: ScanOptions): Promise<ScanOutput> {
  const maxDepth = opts.maxDepth ?? 12
  const errors: string[] = []
  const unreachableRoots: string[] = []
  const unreadableDirs: string[] = []
  const biosFiles: string[] = []
  const excluded = new Set((opts.excludeDirs ?? []).map(normPath))

  // Dedupe roots; deeper roots own their subtree (a shallower root skips them while walking).
  const rootMap = new Map<string, ScanRoot>()
  for (const r of opts.roots) {
    const k = normPath(r.path)
    const prev = rootMap.get(k)
    if (!prev || (!prev.systemId && r.systemId)) rootMap.set(k, r)
  }
  const roots = [...rootMap.values()]
  const rootKeys = new Set(rootMap.keys())

  const candidates: Candidate[] = []
  const dirGames: DirGame[] = []
  const referenced = new Set<string>()
  const refsByEntry = new Map<string, string[]>()
  let dirsSeen = 0
  let filesSeen = 0
  const report = (): void => opts.onProgress?.({ phase: 'walk', dirs: dirsSeen, files: filesSeen })

  const processDir = async (job: DirJob, isRoot: boolean): Promise<DirJob[]> => {
    let entries: Dirent[]
    try {
      entries = await readdir(job.path, { withFileTypes: true })
    } catch (e) {
      if (isRoot) unreachableRoots.push(job.path)
      else {
        unreadableDirs.push(job.path)
        errors.push(`${job.path}: ${errMsg(e)}`)
      }
      return []
    }
    dirsSeen++
    const dirNames: string[] = []
    const fileNames: string[] = []
    for (const e of entries) {
      if (await direntIsDir(job.path, e)) dirNames.push(e.name)
      else if (await direntIsFile(job.path, e)) fileNames.push(e.name)
    }
    filesSeen += fileNames.length
    if (dirsSeen % 50 === 0) report()

    const dirGame = await detectDirGame(job.path, dirNames, fileNames, job.systemId)
    if (dirGame) {
      dirGames.push(dirGame)
      return []
    }

    // Files in this directory.
    const images = new Map<string, string>()
    for (const f of fileNames) {
      const ext = extname(f).toLowerCase()
      if (IMAGE_EXTS.includes(ext)) {
        const stem = lower(basename(f, extname(f)))
        if (!images.has(stem)) images.set(stem, join(job.path, f))
      }
    }
    const sys = job.systemId ? getSystemDef(job.systemId) : undefined
    const entryPoints: string[] = []
    for (const f of fileNames) {
      if (isHiddenName(f)) continue
      const ext = extname(f).toLowerCase()
      if (!ext) continue
      const full = join(job.path, f)
      const stem = basename(f, extname(f))
      const img = images.get(lower(stem))
      const localMedia: Partial<Record<MediaKind, string>> = img ? { boxart: img } : {}
      let cand: Candidate | undefined
      if (sys) {
        if (sys.extensions.includes(ext)) cand = { path: full, systemId: sys.id, localMedia }
      } else {
        const uniq = uniqueSystemForExtension(ext)
        if (uniq) cand = { path: full, systemId: uniq.id, localMedia }
        else if (SNIFFABLE.has(ext) || ENTRY_POINT_EXTENSIONS.has(ext)) {
          const among = systemsForExtension(ext).map((s) => s.id)
          if (among.length) cand = { path: full, sniffAmong: among, localMedia }
        }
      }
      if ((cand?.systemId === 'arcade' || cand?.systemId === 'neogeo') && ARCADE_BIOS_ZIPS.has(lower(stem))) {
        biosFiles.push(full)
        continue
      }
      if (ENTRY_POINT_EXTENSIONS.has(ext) && (cand || !sys)) entryPoints.push(full)
      if (cand) candidates.push(cand)
    }
    // A disc folder can hold hundreds of .cue files: read them a few at a time, not one after another.
    await mapLimit(entryPoints, 8, async (full) => {
      try {
        const refs = await referencedFiles(full)
        refsByEntry.set(normPath(full), refs)
        for (const r of refs) referenced.add(normPath(r))
      } catch (e) {
        errors.push(`${full}: ${errMsg(e)}`)
      }
    })

    // Sub-directories.
    if (job.depth >= maxDepth) return []
    const next: DirJob[] = []
    for (const d of dirNames) {
      const full = join(job.path, d)
      const k = normPath(full)
      const dl = lower(d)
      if (isHiddenName(d) || ALWAYS_SKIP.has(dl) || excluded.has(k) || rootKeys.has(k)) continue
      if (!job.systemId && UNKNOWN_SKIP.has(dl)) continue
      const systemId = job.systemId ?? matchFolderToSystem(d)?.id
      next.push({ path: full, systemId, depth: job.depth + 1 })
    }
    return next
  }

  // Breadth-first walk with bounded concurrency.
  const initial: { job: DirJob; root: boolean }[] = roots
    .filter((r) => !excluded.has(normPath(r.path)))
    .map((r) => ({ job: { path: r.path, systemId: r.systemId ?? matchFolderToSystem(basename(r.path))?.id, depth: 0 }, root: true }))
  const queue = initial
  let active = 0
  await new Promise<void>((resolveWalk) => {
    const pump = (): void => {
      while (active < 16 && queue.length) {
        const item = queue.shift()
        if (!item) break
        active++
        processDir(item.job, item.root)
          .then((more) => {
            for (const j of more) queue.push({ job: j, root: false })
          })
          .catch((e: unknown) => errors.push(`${item.job.path}: ${errMsg(e)}`))
          .finally(() => {
            active--
            if (!queue.length && active === 0) resolveWalk()
            else pump()
          })
      }
      if (!queue.length && active === 0) resolveWalk()
    }
    pump()
  })
  report()

  // Drop files referenced by an entry point (bins of a cue, discs of an m3u...).
  const live = candidates.filter((c) => !referenced.has(normPath(c.path)))
  const total = live.length + dirGames.length
  let done = 0
  const tick = (): void => {
    done++
    if (done % 200 === 0) opts.onProgress?.({ phase: 'process', dirs: dirsSeen, files: filesSeen, done, total })
  }

  // Sizes of everything (entry points sum their references, as the library records them).
  const sizeCache = new Map<string, Promise<number>>()
  const sizeOf = (p: string, depth = 0): Promise<number> => {
    const k = normPath(p)
    let pr = sizeCache.get(k)
    const known = depth === 0 && opts.trustKnownSizes ? opts.known?.get(k) : undefined
    if (!pr && known) {
      pr = Promise.resolve(known.sizeBytes)
      sizeCache.set(k, pr)
    }
    if (!pr) {
      pr = (async () => {
        let own = 0
        try {
          own = (await stat(p)).size
        } catch {
          return -1
        }
        const refs = depth < 3 ? (refsByEntry.get(k) ?? (ENTRY_POINT_EXTENSIONS.has(extname(p).toLowerCase()) ? await referencedFiles(p) : [])) : []
        let sum = own
        for (const r of refs) {
          const s = await sizeOf(r, depth + 1)
          if (s > 0) sum += s
        }
        return sum
      })()
      sizeCache.set(k, pr)
    }
    return pr
  }

  const resolveSystem = async (c: Candidate): Promise<string | undefined> => {
    if (c.systemId) return c.systemId
    const among = c.sniffAmong ?? []
    // Sniffed on an earlier scan and not changed since (same size): no need to read the header again.
    const known = opts.known?.get(normPath(c.path))
    if (known && among.includes(known.systemId) && (await sizeOf(c.path)) === known.sizeBytes) return known.systemId
    const ext = extname(c.path).toLowerCase()
    if (ENTRY_POINT_EXTENSIONS.has(ext)) {
      if (ext === '.gdi') return 'dreamcast'
      const refs = refsByEntry.get(normPath(c.path)) ?? []
      const first = refs[0]
      if (!first) return undefined
      const refExt = extname(first).toLowerCase()
      const uniq = uniqueSystemForExtension(refExt)
      if (uniq) return among.includes(uniq.id) ? uniq.id : undefined
      if (ENTRY_POINT_EXTENSIONS.has(refExt)) {
        // m3u -> cue -> bin
        const inner = (await referencedFiles(first).catch(() => []))[0]
        return inner ? sniffSystem(inner, among) : undefined
      }
      return sniffSystem(first, among)
    }
    return sniffSystem(c.path, among)
  }

  const games: ScannedGame[] = []
  await mapLimit(live, 32, async (c) => {
    try {
      const systemId = await resolveSystem(c)
      if (!systemId) return
      const ext = extname(c.path).toLowerCase()
      const size = await sizeOf(c.path)
      if (size < 0) return
      const ownSize = refsByEntry.has(normPath(c.path)) ? 0 : size
      if (ownSize > 0 && ownSize < 1024 && GENERIC_EXTENSIONS.has(ext) && !ENTRY_POINT_EXTENSIONS.has(ext)) return
      if (ext === '.md' && (await looksLikeText(c.path))) return
      const fileName = basename(c.path)
      const rawName = basename(c.path, extname(c.path))
      const parsed = titleFor(rawName, systemId, opts.arcadeNames)
      games.push({ path: c.path, systemId, fileName, rawName, title: parsed.title, regions: parsed.regions, tags: parsed.tags, sizeBytes: size, localMedia: c.localMedia })
    } catch (e) {
      errors.push(`${c.path}: ${errMsg(e)}`)
    } finally {
      tick()
    }
  })

  await mapLimit(dirGames, 4, async (g) => {
    try {
      const known = opts.known?.get(normPath(g.path))?.sizeBytes
      const size = known ?? (await dirSize(g.folder))
      const parsed = parseRomName(g.rawName)
      games.push({
        path: g.path,
        systemId: g.systemId,
        fileName: g.path === g.folder ? basename(g.folder) : basename(g.path),
        rawName: g.rawName,
        title: g.title ?? parsed.title,
        regions: parsed.regions,
        tags: parsed.tags,
        sizeBytes: size,
        localMedia: g.localMedia
      })
    } catch (e) {
      errors.push(`${g.path}: ${errMsg(e)}`)
    } finally {
      tick()
    }
  })

  games.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { games, unreachableRoots, unreadableDirs, biosFiles, errors }
}

/**
 * Work out the system for a single file outside the scan (importer). Uses, in order: unique extension,
 * the names of the parent folders, disc-header sniffing. Returns undefined when unknown or ambiguous.
 */
export async function detectFileSystem(path: string): Promise<string | undefined> {
  const ext = extname(path).toLowerCase()
  const among = systemsForExtension(ext).map((s) => s.id)
  if (!among.length && ext !== '.cue' && ext !== '.gdi') return undefined
  const uniq = uniqueSystemForExtension(ext)
  if (uniq) return uniq.id
  if (among.length === 1 && ext !== '.md') return among[0]
  // Parent folder names, nearest first (e.g. D:\Games\PSX\Crash\Crash.cue).
  let dir = dirname(path)
  for (let i = 0; i < 4; i++) {
    const m = matchFolderToSystem(basename(dir))
    if (m && among.includes(m.id)) return m.id
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  if (ext === '.gdi') return 'dreamcast'
  if (ENTRY_POINT_EXTENSIONS.has(ext)) {
    const refs = await referencedFiles(path).catch(() => [])
    const first = refs[0]
    if (!first) return undefined
    const refUniq = uniqueSystemForExtension(extname(first))
    if (refUniq && among.includes(refUniq.id)) return refUniq.id
    if (ENTRY_POINT_EXTENSIONS.has(extname(first).toLowerCase())) {
      const inner = (await referencedFiles(first).catch(() => []))[0]
      return inner ? sniffSystem(inner, among) : undefined
    }
    return sniffSystem(first, among)
  }
  return sniffSystem(path, among)
}


/** If `dir` is a directory-format game (PS3 folder, Wii U loose files), return its system and launch path. */
export async function detectDirectoryGame(dir: string): Promise<{ systemId: string; path: string } | undefined> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return undefined
  }
  const dirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  const fileNames = entries.filter((e) => e.isFile()).map((e) => e.name)
  const g = await detectDirGame(dir, dirNames, fileNames, undefined)
  return g ? { systemId: g.systemId, path: g.path } : undefined
}
