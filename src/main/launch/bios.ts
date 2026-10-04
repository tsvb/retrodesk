// Pre-launch BIOS checks. BiosDef.file conventions (relative to the BIOS dir, see src/main/systems.ts):
//  - "scph5501.bin" / "dc/dc_boot.bin": that file
//  - "Machines/": a non-empty directory
//  - "ps2/*.bin": any file in that directory matching the glob
import { existsSync, readdirSync, statSync } from 'fs'
import { dirname, join } from 'path'
import type { BiosDef, SystemDef } from '../../shared/types'
import type { EmuRef } from '../emulators/keys'
import { CORE_SYSTEM_ASSETS, coreFileBase } from '../emulators/retroarch'
import { STANDALONE_DEFS } from '../emulators/standalone'

/** Required files that can be substituted by another file of the same family (other regions / models). */
const ALTERNATIVES: Record<string, string[]> = {
  'bios_cd_u.bin': ['bios_CD_E.bin', 'bios_CD_J.bin'],
  'mpr-17933.bin': ['sega_101.bin', 'mpr-17941.bin', 'mpr-17940.bin'],
  'scph5501.bin': ['scph5500.bin', 'scph5502.bin', 'scph1001.bin', 'scph7001.bin', 'scph101.bin', 'ps1_rom.bin'],
  'panafz10.bin': ['panafz1.bin', 'panafz1j.bin', 'goldstar.bin', 'sanyotry.bin']
}

/** Cores/emulators that run without the system's "required" BIOS (HLE). */
const BIOS_OPTIONAL: string[] = ['retroarch:pcsx_rearmed_libretro']

/** Standalone emulators whose firmware is validated/provisioned by provisionStandalone() instead. */
export const PROVISIONED_STANDALONES = new Set(STANDALONE_DEFS.filter((d) => d.firmware?.length).map((d) => d.id))

/** BIOS entries that are really core asset packs (auto-downloaded) mapped to the core that needs them. */
function assetCoreFor(file: string): string | undefined {
  const f = file.toLowerCase()
  if (f.startsWith('ppsspp/')) return 'ppsspp_libretro'
  if (f === 'machines/' || f === 'databases/') return 'bluemsx_libretro'
  return undefined
}

export function biosEntryPresent(biosDir: string, file: string): boolean {
  if (file.endsWith('/')) {
    const dir = join(biosDir, file)
    try {
      return statSync(dir).isDirectory() && readdirSync(dir).length > 0
    } catch {
      return false
    }
  }
  if (file.includes('*')) {
    const dir = join(biosDir, dirname(file))
    const pattern = file.split('/').pop()!
    const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i')
    try {
      return readdirSync(dir, { withFileTypes: true }).some((e) => e.isFile() && re.test(e.name))
    } catch {
      return false
    }
  }
  return existsSync(join(biosDir, file))
}

export interface BiosCheckInput {
  system: SystemDef
  ref: EmuRef
  biosDir: string
  /** ROM path (neogeo.zip may sit next to the game). */
  romPath?: string
}

/** Required BIOS entries missing for this system + emulator. */
export function missingBios({ system, ref, biosDir, romPath }: BiosCheckInput): BiosDef[] {
  const key = ref.type === 'retroarch' ? `retroarch:${coreFileBase(ref.core)}` : `standalone:${ref.id}`
  if (BIOS_OPTIONAL.includes(key)) return []
  if (ref.type === 'standalone' && PROVISIONED_STANDALONES.has(ref.id)) return []
  const missing: BiosDef[] = []
  for (const b of system.bios) {
    if (!b.required) continue
    const assetCore = assetCoreFor(b.file)
    if (assetCore) {
      // Only relevant to the core that uses the pack (the standalone PPSSPP ships its own assets).
      if (ref.type !== 'retroarch' || coreFileBase(ref.core) !== assetCore) continue
      if (!biosEntryPresent(biosDir, b.file)) missing.push(b)
      continue
    }
    if (biosEntryPresent(biosDir, b.file)) continue
    const alts = ALTERNATIVES[b.file.toLowerCase()] ?? []
    if (alts.some((a) => biosEntryPresent(biosDir, a))) continue
    if (b.file.toLowerCase() === 'neogeo.zip' && romPath) {
      const dir = dirname(romPath)
      if (existsSync(join(dir, 'neogeo.zip')) || existsSync(join(biosDir, 'fbneo', 'neogeo.zip'))) continue
    }
    missing.push(b)
  }
  return missing
}

/** Core asset packs that can be fetched automatically before the check. */
export function autoFetchableCore(ref: EmuRef): string | undefined {
  if (ref.type !== 'retroarch') return undefined
  const base = coreFileBase(ref.core)
  return CORE_SYSTEM_ASSETS[base] ? base : undefined
}

export function describeMissing(systemName: string, missing: BiosDef[], biosDir: string): string {
  const list = missing.map((m) => `${m.file} (${m.description})`).join(', ')
  return `${systemName} needs ${list}. Add ${missing.length > 1 ? 'them' : 'it'} to ${biosDir} or import from Settings > BIOS.`
}
