import type { SystemDef } from '../shared/types'
import systemsData from './data/systems.json'

/**
 * Static system catalogue (bundled from data/systems.json).
 *
 * BIOS `file` conventions (paths are relative to getPaths().bios):
 *  - plain path, e.g. "scph5501.bin" or "dc/dc_boot.bin": that exact file.
 *  - trailing "/", e.g. "Machines/": a directory that must exist and be non-empty.
 *  - "*" in the last segment, e.g. "ps2/*.bin": any file in that directory matching the glob.
 * An empty md5 means "unknown": presence is enough.
 */
const SYSTEMS: readonly SystemDef[] = systemsData as SystemDef[]
const BY_ID = new Map<string, SystemDef>(SYSTEMS.map((s) => [s.id, s]))
const ORDER = new Map<string, number>(SYSTEMS.map((s, i) => [s.id, i]))

/**
 * Extensions that are too generic to identify a system on their own (shared, or used by unrelated
 * software like Markdown, macOS disk images or Doom WADs). Never used for the unique-extension fallback,
 * and files with these extensions under 1 KB are ignored by the scanner.
 */
// prettier-ignore
export const GENERIC_EXTENSIONS: ReadonlySet<string> = new Set([
  '.zip', '.7z', '.bin', '.iso', '.img', '.chd', '.cue', '.ccd', '.toc', '.m3u', '.mdf', '.gz', '.pkg', '.rom', '.dsk',
  '.cas', '.o', '.md', '.dmg', '.wad', '.dol', '.st', '.cso', '.pbp', '.ciso', '.gcz', '.rvz', '.wia'
])

/** Multi-file disc entry points: small text files that reference the real data files. */
export const ENTRY_POINT_EXTENSIONS: ReadonlySet<string> = new Set(['.cue', '.gdi', '.ccd', '.m3u', '.toc'])

export function getSystemDefs(): SystemDef[] {
  return SYSTEMS.slice()
}

export function getSystemDef(id: string): SystemDef | undefined {
  return BY_ID.get(id)
}

/** Position of a system in the catalogue (used for sorting by system). Unknown ids sort last. */
export function systemOrder(id: string): number {
  return ORDER.get(id) ?? SYSTEMS.length
}

/** Normalise a folder name for alias matching: lower-case, no diacritics, alphanumerics only. */
export function normaliseFolderName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9+]/g, '')
}

let aliasIndex: Map<string, string> | null = null
function getAliasIndex(): Map<string, string> {
  if (aliasIndex) return aliasIndex
  const idx = new Map<string, string>()
  const add = (alias: string, id: string): void => {
    const k = normaliseFolderName(alias)
    if (k && !idx.has(k)) idx.set(k, id)
  }
  // Explicit ids and aliases win over derived names (system name / libretro folder).
  for (const s of SYSTEMS) add(s.id, s.id)
  for (const s of SYSTEMS) for (const a of s.folderAliases ?? []) add(a, s.id)
  for (const s of SYSTEMS) {
    add(s.name, s.id)
    if (s.thumbnailsFolder) add(s.thumbnailsFolder, s.id)
  }
  aliasIndex = idx
  return idx
}

/** Map a folder name (e.g. "SNES", "Super Nintendo", "Nintendo - Super Nintendo Entertainment System") to a system. */
export function matchFolderToSystem(folderName: string): SystemDef | undefined {
  const id = getAliasIndex().get(normaliseFolderName(folderName))
  return id ? BY_ID.get(id) : undefined
}

/** All systems whose extension list contains `ext` (lower-case, with dot). */
export function systemsForExtension(ext: string): SystemDef[] {
  const e = ext.toLowerCase()
  return SYSTEMS.filter((s) => s.extensions.includes(e))
}

/** The single system that claims `ext`, if exactly one does and the extension is not generic. */
export function uniqueSystemForExtension(ext: string): SystemDef | undefined {
  const e = ext.toLowerCase()
  if (GENERIC_EXTENSIONS.has(e)) return undefined
  const list = systemsForExtension(e)
  return list.length === 1 ? list[0] : undefined
}

/** Every md5 known for any BIOS entry -> the systems/files it belongs to. */
export function biosByMd5(): Map<string, { systemId: string; file: string }[]> {
  const m = new Map<string, { systemId: string; file: string }[]>()
  for (const s of SYSTEMS) {
    for (const b of s.bios) {
      if (!b.md5) continue
      const list = m.get(b.md5) ?? []
      list.push({ systemId: s.id, file: b.file })
      m.set(b.md5, list)
    }
  }
  return m
}
