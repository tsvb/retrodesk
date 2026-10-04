import type { ScanResult } from '@shared/types'
import { api } from '../api'
import { useSettings } from '../stores/settings'
import { toast } from '../stores/session'
import { formatNumber, plural } from './format'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Pick a folder and add it to settings.romFolders. Returns the path, or null on cancel/duplicate. */
export async function addRomFolder(systemId?: string): Promise<string | null> {
  const path = await api.system.pickFolder('Choose a ROM folder')
  if (!path) return null
  const s = useSettings.getState().settings
  const folders = s?.romFolders ?? []
  if (folders.some((f) => f.path.toLowerCase() === path.toLowerCase())) {
    toast('That folder is already in your library', 'info')
    return null
  }
  await useSettings.getState().update({ romFolders: [...folders, systemId ? { path, systemId } : { path }] })
  toast(`Added ${path}`, 'success')
  return path
}

export function describeScan(r: ScanResult): string {
  const parts = [`${plural(r.total, 'game')} in your library`]
  if (r.added && r.added < r.total) parts.unshift(`${formatNumber(r.added)} new`)
  if (r.removed) parts.push(`${formatNumber(r.removed)} removed`)
  return parts.join(', ')
}

export async function rescan(): Promise<ScanResult | null> {
  try {
    const r = await api.library.scan()
    toast(`Scan finished: ${describeScan(r)}`, 'success')
    return r
  } catch (e) {
    toast(`Scan failed: ${errText(e)}`, 'error')
    return null
  }
}

export async function importPaths(paths: string[]): Promise<void> {
  if (!paths.length) return
  try {
    const r = await api.library.importFiles(paths)
    toast(r.added ? `Imported ${plural(r.added, 'game')}` : 'No new games were found in those files', r.added ? 'success' : 'info')
  } catch (e) {
    toast(`Import failed: ${errText(e)}`, 'error')
  }
}

export async function importRomFiles(): Promise<void> {
  const paths = await api.system.pickFiles({ title: 'Import ROM files' })
  await importPaths(paths)
}

export async function fetchArtwork(): Promise<void> {
  try {
    await api.library.fetchArtwork()
    toast('Artwork updated', 'success')
  } catch (e) {
    toast(`Artwork download failed: ${errText(e)}`, 'error')
  }
}
