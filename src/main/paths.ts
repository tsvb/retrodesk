import { mkdirSync } from 'fs'
import { join } from 'path'
import { getSettings } from './settings'

export interface DataPaths {
  dataRoot: string
  /** Default ROM folder: roms/<systemId>/ */
  roms: string
  /** RetroArch system_directory; standalone emulators get BIOS copied/linked from here. */
  bios: string
  saves: string
  states: string
  screenshots: string
  /** emulators/retroarch, emulators/<standaloneId> */
  emulators: string
  /** media/<systemId>/<kind>/<rawName>.png */
  media: string
  /** Download cache. */
  downloads: string
}

export function getPaths(): DataPaths {
  const root = getSettings().dataRoot
  const p: DataPaths = {
    dataRoot: root,
    roms: join(root, 'roms'),
    bios: join(root, 'bios'),
    saves: join(root, 'saves'),
    states: join(root, 'states'),
    screenshots: join(root, 'screenshots'),
    emulators: join(root, 'emulators'),
    media: join(root, 'media'),
    downloads: join(root, 'downloads')
  }
  for (const dir of Object.values(p)) mkdirSync(dir, { recursive: true })
  return p
}
