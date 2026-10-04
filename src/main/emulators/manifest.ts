// Install manifest: <emulators>/manifest.json records what RetroDesk installed and where the executable is.
import { existsSync } from 'fs'
import { isAbsolute, join, relative } from 'path'
import { getPaths } from '../paths'
import { readJson, writeJsonAtomic } from '../util/json'

export interface ManifestEntry {
  /** 'retroarch', 'core:<core>' or standalone id. */
  id: string
  version: string
  installedAt: number
  /**
   * Executable (or core .dll) path. Stored relative to the emulators directory so the data root can be moved;
   * use resolveExePath() to get an absolute path.
   */
  exePath: string
  sizeBytes: number
}

interface ManifestFile {
  version: 1
  emulators: Record<string, ManifestEntry>
}

let cache: { root: string; data: ManifestFile } | null = null

export const manifestPath = (): string => join(getPaths().emulators, 'manifest.json')

export function loadManifest(force = false): ManifestFile {
  const root = getPaths().emulators
  if (!force && cache && cache.root === root) return cache.data
  const raw = readJson<Partial<ManifestFile>>(join(root, 'manifest.json'), {})
  const data: ManifestFile = { version: 1, emulators: raw && typeof raw.emulators === 'object' && raw.emulators ? raw.emulators : {} }
  cache = { root, data }
  return data
}

function save(data: ManifestFile): void {
  writeJsonAtomic(manifestPath(), data)
}

export function resolveExePath(entry: Pick<ManifestEntry, 'exePath'>): string {
  return isAbsolute(entry.exePath) ? entry.exePath : join(getPaths().emulators, entry.exePath)
}

/** Manifest entry if recorded AND its executable still exists on disk. */
export function getInstalled(id: string): (ManifestEntry & { absExePath: string }) | undefined {
  const e = loadManifest().emulators[id]
  if (!e) return undefined
  const abs = resolveExePath(e)
  return existsSync(abs) ? { ...e, absExePath: abs } : undefined
}

export function getEntry(id: string): ManifestEntry | undefined {
  return loadManifest().emulators[id]
}

export function recordInstall(entry: Omit<ManifestEntry, 'exePath'> & { exePath: string }): ManifestEntry {
  const data = loadManifest()
  const root = getPaths().emulators
  const rel = isAbsolute(entry.exePath) ? relative(root, entry.exePath) : entry.exePath
  // Keep absolute if the exe lives outside the emulators root (relative would start with "..").
  const stored: ManifestEntry = { ...entry, exePath: rel.startsWith('..') ? entry.exePath : rel }
  data.emulators[entry.id] = stored
  save(data)
  return stored
}

export function removeEntry(id: string): void {
  const data = loadManifest()
  if (data.emulators[id]) {
    delete data.emulators[id]
    save(data)
  }
}

/** Test hook. */
export function resetManifestCache(): void {
  cache = null
}
