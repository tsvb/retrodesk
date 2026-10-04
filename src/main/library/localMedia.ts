import { copyFile, mkdir, readdir } from 'fs/promises'
import { homedir } from 'os'
import { basename, dirname, extname, join } from 'path'
import type { Game, MediaKind } from '../../shared/types'
import { matchFolderToSystem } from '../systems'
import { dirExists, fileExists, mediaFileName } from './util'

/**
 * Artwork that already exists on disk:
 *  - an image next to the ROM with the same base name (found by the scanner),
 *  - ES-DE style `downloaded_media/<system>/{covers,screenshots,titlescreens}/<rom name>.<png|jpg>`.
 * Files outside the folders the media protocol may serve are copied into <media>/<systemId>/<kind>/.
 */

const ESDE_KIND_DIRS: Record<MediaKind, string[]> = {
  boxart: ['covers', 'box2dfront', 'boxart'],
  snap: ['screenshots', 'snaps'],
  title: ['titlescreens', 'titles']
}
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

/** Candidate ES-DE downloaded_media folders for the given ROM roots. */
export async function findEsDeMediaRoots(romRoots: string[]): Promise<string[]> {
  const cands = new Set<string>()
  for (const r of romRoots) {
    cands.add(join(r, 'downloaded_media'))
    cands.add(join(dirname(r), 'downloaded_media'))
    cands.add(join(dirname(r), 'ES-DE', 'downloaded_media'))
    cands.add(join(dirname(dirname(r)), 'ES-DE', 'downloaded_media'))
  }
  cands.add(join(homedir(), 'ES-DE', 'downloaded_media'))
  cands.add(join(homedir(), '.emulationstation', 'downloaded_media'))
  const out: string[] = []
  for (const c of cands) if (await dirExists(c)) out.push(c)
  return out
}

/** systemId -> kind -> lower-case stem -> file */
type EsDeIndex = Map<string, Map<MediaKind, Map<string, string>>>

async function indexEsDeRoot(root: string, wantedSystems: Set<string>, idx: EsDeIndex): Promise<void> {
  let sysDirs: string[]
  try {
    sysDirs = (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return
  }
  for (const sd of sysDirs) {
    const sys = matchFolderToSystem(sd)
    if (!sys || !wantedSystems.has(sys.id)) continue
    const perKind = idx.get(sys.id) ?? new Map<MediaKind, Map<string, string>>()
    idx.set(sys.id, perKind)
    for (const kind of Object.keys(ESDE_KIND_DIRS) as MediaKind[]) {
      const files = perKind.get(kind) ?? new Map<string, string>()
      perKind.set(kind, files)
      for (const kd of ESDE_KIND_DIRS[kind]) {
        try {
          for (const f of await readdir(join(root, sd, kd))) {
            if (!IMAGE_EXTS.has(extname(f).toLowerCase())) continue
            const stem = basename(f, extname(f)).toLowerCase()
            if (!files.has(stem)) files.set(stem, join(root, sd, kd, f))
          }
        } catch {
          /* kind folder missing */
        }
      }
    }
  }
}

export interface LocalMediaOptions {
  romRoots: string[]
  mediaDir: string
  /** Whether the renderer's media protocol may serve this path directly. */
  isServable: (p: string) => boolean
  /** Extra downloaded_media roots (tests). */
  esdeRoots?: string[]
}

/**
 * Fill missing media kinds of `games` from ES-DE folders. Returns only games whose media changed.
 * Existing media (that still exists on disk) is never replaced.
 */
export async function applyEsDeMedia(games: Game[], opts: LocalMediaOptions): Promise<Map<string, Game['media']>> {
  const out = new Map<string, Game['media']>()
  const roots = opts.esdeRoots ?? (await findEsDeMediaRoots(opts.romRoots))
  if (!roots.length || !games.length) return out
  const wanted = new Set(games.map((g) => g.systemId))
  const idx: EsDeIndex = new Map()
  for (const r of roots) await indexEsDeRoot(r, wanted, idx)
  for (const g of games) {
    const perKind = idx.get(g.systemId)
    if (!perKind) continue
    let media: Game['media'] | undefined
    for (const kind of Object.keys(ESDE_KIND_DIRS) as MediaKind[]) {
      const cur = g.media[kind]
      if (cur && (await fileExists(cur))) continue
      const src = perKind.get(kind)?.get(g.rawName.toLowerCase())
      if (!src) continue
      let dest = src
      if (!opts.isServable(src)) {
        dest = join(opts.mediaDir, g.systemId, kind, `${mediaFileName(g.rawName)}${extname(src).toLowerCase()}`)
        try {
          await mkdir(dirname(dest), { recursive: true })
          await copyFile(src, dest)
        } catch {
          continue
        }
      }
      media = { ...(media ?? g.media), [kind]: dest }
    }
    if (media) out.set(g.id, media)
  }
  return out
}
