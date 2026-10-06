// Where controller state comes from: the Gamepad API, or on macOS the main process, which reads controllers natively
// because Chromium misses common ones there (see src/main/gamepads.ts). Native pads are adapted to the Gamepad
// shape (standard mapping), so input code reads both the same way.
import type { NativePad } from '@shared/types'
import { api, isElectron } from '../api'
import { isMac } from '../lib/platform'

/** Null until (unless) the main process says it reads controllers itself. */
let native: Gamepad[] | null = null
const changeListeners = new Set<() => void>()

function toGamepad(p: NativePad): Gamepad {
  return {
    index: p.index,
    id: p.id,
    connected: true,
    mapping: 'standard',
    timestamp: performance.now(),
    axes: p.axes,
    buttons: p.buttons.map((value) => ({ pressed: value > 0.5, touched: value > 0, value })),
    vibrationActuator: null,
    hapticActuators: []
  } as unknown as Gamepad
}

function applyNative(pads: NativePad[] | null): void {
  const before = native?.map((g) => g.id).join('\n')
  native = pads ? pads.map(toGamepad) : null
  if (native?.map((g) => g.id).join('\n') !== before) for (const l of changeListeners) l()
}

if (isElectron && isMac) {
  api.on.gamepads((p) => applyNative(p))
  void api.system
    .getGamepads()
    .then((p) => native === null && applyNative(p))
    .catch(() => undefined)
}

/** Connected controllers, like navigator.getGamepads(). */
export function getPads(): readonly (Gamepad | null)[] {
  if (native) return native
  try {
    return navigator.getGamepads()
  } catch {
    return []
  }
}

/** Natively read controllers are in use (rumble goes through the main process). */
export const padsAreNative = (): boolean => native !== null

/** A controller was connected or disconnected (Gamepad API events, or a change in the native list). */
export function onPadsChanged(cb: () => void): () => void {
  changeListeners.add(cb)
  window.addEventListener('gamepadconnected', cb)
  window.addEventListener('gamepaddisconnected', cb)
  return () => {
    changeListeners.delete(cb)
    window.removeEventListener('gamepadconnected', cb)
    window.removeEventListener('gamepaddisconnected', cb)
  }
}
