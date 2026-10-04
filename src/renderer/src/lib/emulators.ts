import type { EmulatorRef, EmulatorStatus, SystemDef } from '@shared/types'

/** Settings/override format: `retroarch:<core>` or `standalone:<id>`. */
export function refKey(ref: EmulatorRef): string {
  return ref.type === 'retroarch' ? `retroarch:${ref.core}` : `standalone:${ref.id}`
}

/** emulators.list() id for a ref: `core:<core>` or the standalone id. */
export function refStatusId(ref: EmulatorRef): string {
  return ref.type === 'retroarch' ? `core:${ref.core}` : ref.id
}

export function keyToStatusId(key: string): string {
  const [type, id] = splitKey(key)
  return type === 'retroarch' ? `core:${id}` : id
}

function splitKey(key: string): [string, string] {
  const i = key.indexOf(':')
  return i < 0 ? ['standalone', key] : [key.slice(0, i), key.slice(i + 1)]
}

export function prettifyCore(core: string): string {
  return core
    .replace(/_libretro$/, '')
    .split(/[_-]/)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

export function keyLabel(key: string, statuses: EmulatorStatus[]): string {
  const sid = keyToStatusId(key)
  const st = statuses.find((s) => s.id === sid)
  if (st) return key.startsWith('retroarch:') ? `${st.name} (RetroArch)` : st.name
  const [type, id] = splitKey(key)
  return type === 'retroarch' ? `${prettifyCore(id)} (RetroArch)` : prettifyCore(id)
}

export function isKeyInstalled(key: string, statuses: EmulatorStatus[]): boolean {
  const sid = keyToStatusId(key)
  const st = statuses.find((s) => s.id === sid)
  if (!st?.installed) return false
  if (key.startsWith('retroarch:')) return statuses.some((s) => s.id === 'retroarch' && s.installed)
  return true
}

/** The emulator that will be used for a system: the settings override, else the def's default, else the first. */
export function defaultKeyForSystem(system: SystemDef, systemEmulator: Record<string, string>): string | undefined {
  const chosen = systemEmulator[system.id]
  if (chosen) return chosen
  const ref = system.emulators.find((e) => e.default) ?? system.emulators[0]
  return ref ? refKey(ref) : undefined
}
