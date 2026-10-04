// Emulator key helpers shared by both processes. Formats:
//  - settings / Game.emulatorOverride / SessionInfo.emulatorId: `retroarch:<core>` | `standalone:<id>`
//  - EmulatorStatus.id (emulators.list/install): 'retroarch' | `core:<core>` | `<standaloneId>`
import type { EmulatorRef, SystemDef } from './types'

export type EmuRef = { type: 'retroarch'; core: string } | { type: 'standalone'; id: string }

/** Strip catalogue-only fields (`default`) from a systems.json entry. */
export const toRef = (r: EmuRef | EmulatorRef): EmuRef => (r.type === 'retroarch' ? { type: 'retroarch', core: r.core } : { type: 'standalone', id: r.id })

export const refKey = (r: EmuRef | EmulatorRef): string => (r.type === 'retroarch' ? `retroarch:${r.core}` : `standalone:${r.id}`)
export const refStatusId = (r: EmuRef | EmulatorRef): string => (r.type === 'retroarch' ? `core:${r.core}` : r.id)

/**
 * Parse either key format. A bare id is a standalone emulator when `isStandalone` says so (main passes the
 * catalogue lookup; the renderer has no catalogue and accepts any), else a core when it ends in `_libretro`.
 */
export function parseEmulatorKey(key: string | undefined | null, isStandalone: (id: string) => boolean = () => true): EmuRef | undefined {
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
  if (key.endsWith('_libretro')) return { type: 'retroarch', core: key }
  return isStandalone(key) ? { type: 'standalone', id: key } : undefined
}

/** emulators.list() id for a settings key. */
export function keyToStatusId(key: string): string {
  const ref = parseEmulatorKey(key)
  return ref ? refStatusId(ref) : key
}

export function systemDefaultRef(sys: Pick<SystemDef, 'emulators'>): EmuRef | undefined {
  const r = sys.emulators.find((e) => e.default) ?? sys.emulators[0]
  return r ? toRef(r) : undefined
}

export const allRefs = (sys: Pick<SystemDef, 'emulators'>): EmuRef[] => sys.emulators.map(toRef)

/** "mupen64plus_next_libretro" -> "Mupen64plus Next": the fallback name for a core nobody has named. */
export function prettifyCore(core: string): string {
  return core
    .replace(/_libretro$/, '')
    .split(/[_-]/)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}
