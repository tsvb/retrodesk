// Emulator key helpers. Formats:
//  - settings / Game.emulatorOverride / SessionInfo.emulatorId: `retroarch:<core>` | `standalone:<id>`
//  - EmulatorStatus.id (emulators.list/install): 'retroarch' | `core:<core>` | `<standaloneId>`
import type { EmulatorRef, Game, Settings, SystemDef } from '../../shared/types'
import { getStandaloneDef } from './standalone'

export type EmuRef = { type: 'retroarch'; core: string } | { type: 'standalone'; id: string }

export function parseEmulatorKey(key: string | undefined | null): EmuRef | undefined {
  if (!key) return undefined
  const i = key.indexOf(':')
  if (i >= 0) {
    const kind = key.slice(0, i)
    const id = key.slice(i + 1)
    if (!id) return undefined
    if (kind === 'retroarch' || kind === 'core') return { type: 'retroarch', core: id }
    if (kind === 'standalone') return { type: 'standalone', id }
    return undefined
  }
  if (getStandaloneDef(key)) return { type: 'standalone', id: key }
  if (key.endsWith('_libretro')) return { type: 'retroarch', core: key }
  return undefined
}

export const refKey = (r: EmuRef | EmulatorRef): string => (r.type === 'retroarch' ? `retroarch:${r.core}` : `standalone:${r.id}`)
export const refStatusId = (r: EmuRef | EmulatorRef): string => (r.type === 'retroarch' ? `core:${r.core}` : r.id)

export function systemDefaultRef(sys: SystemDef): EmuRef | undefined {
  const r = sys.emulators.find((e) => e.default) ?? sys.emulators[0]
  return r ? (r.type === 'retroarch' ? { type: 'retroarch', core: r.core } : { type: 'standalone', id: r.id }) : undefined
}

/** Settings.systemEmulator override, else the system default. */
export function systemChosenRef(sys: SystemDef, settings: Pick<Settings, 'systemEmulator'>): EmuRef | undefined {
  return parseEmulatorKey(settings.systemEmulator?.[sys.id]) ?? systemDefaultRef(sys)
}

/** game.emulatorOverride -> Settings.systemEmulator[systemId] -> system default. */
export function resolveGameRef(game: Pick<Game, 'emulatorOverride'>, sys: SystemDef, settings: Pick<Settings, 'systemEmulator'>): EmuRef | undefined {
  return parseEmulatorKey(game.emulatorOverride) ?? systemChosenRef(sys, settings)
}

export function allRefs(sys: SystemDef): EmuRef[] {
  return sys.emulators.map((r) => (r.type === 'retroarch' ? { type: 'retroarch', core: r.core } : { type: 'standalone', id: r.id }))
}
