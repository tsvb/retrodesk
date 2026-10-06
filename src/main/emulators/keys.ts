// Emulator key resolution for the main process. The formats and pure helpers live in shared/emulators.ts;
// this adds the parts that need the standalone catalog and settings.
import { parseEmulatorKey as parseKey, systemDefaultRef, type EmuRef } from '../../shared/emulators'
import type { Game, Settings, SystemDef } from '../../shared/types'
import { getStandaloneDef } from './standalone'

export { allRefs, refKey, refStatusId, systemDefaultRef, type EmuRef } from '../../shared/emulators'

/** A bare id only counts as a standalone emulator when the catalog knows it. */
export function parseEmulatorKey(key: string | undefined | null): EmuRef | undefined {
  return parseKey(key, (id) => !!getStandaloneDef(id))
}

/** Settings.systemEmulator override, else the system default. */
export function systemChosenRef(sys: SystemDef, settings: Pick<Settings, 'systemEmulator'>): EmuRef | undefined {
  return parseEmulatorKey(settings.systemEmulator?.[sys.id]) ?? systemDefaultRef(sys)
}

/** game.emulatorOverride -> Settings.systemEmulator[systemId] -> system default. */
export function resolveGameRef(game: Pick<Game, 'emulatorOverride'>, sys: SystemDef, settings: Pick<Settings, 'systemEmulator'>): EmuRef | undefined {
  return parseEmulatorKey(game.emulatorOverride) ?? systemChosenRef(sys, settings)
}
