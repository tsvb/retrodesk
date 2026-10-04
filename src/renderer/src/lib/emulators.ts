import { keyToStatusId, parseEmulatorKey, prettifyCore, refKey, systemDefaultRef } from '@shared/emulators'
import type { EmulatorStatus, SystemDef } from '@shared/types'

export { keyToStatusId, prettifyCore, refKey, refStatusId } from '@shared/emulators'

export function keyLabel(key: string, statuses: EmulatorStatus[]): string {
  const ref = parseEmulatorKey(key)
  const st = statuses.find((s) => s.id === keyToStatusId(key))
  const name = st?.name ?? prettifyCore(ref ? (ref.type === 'retroarch' ? ref.core : ref.id) : key)
  return ref?.type === 'retroarch' ? `${name} (RetroArch)` : name
}

export function isKeyInstalled(key: string, statuses: EmulatorStatus[]): boolean {
  const st = statuses.find((s) => s.id === keyToStatusId(key))
  if (!st?.installed) return false
  if (parseEmulatorKey(key)?.type === 'retroarch') return statuses.some((s) => s.id === 'retroarch' && s.installed)
  return true
}

/** The emulator that will be used for a system: the settings override, else the def's default, else the first. */
export function defaultKeyForSystem(system: SystemDef, systemEmulator: Record<string, string>): string | undefined {
  const chosen = systemEmulator[system.id]
  if (chosen) return chosen
  const ref = systemDefaultRef(system)
  return ref ? refKey(ref) : undefined
}
