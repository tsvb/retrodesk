// Where controller state comes from: the Gamepad API, or on macOS the main process, which reads controllers natively
// because Chromium misses common ones there (see src/main/gamepads.ts). Native pads are adapted to the Gamepad
// shape (standard mapping), so input code reads both the same way.
import type { NativePad } from '@shared/types'
import { api, isElectron } from '../api'
import { isMac } from '../lib/platform'

/**
 * Null when the renderer reads the Gamepad API itself. On macOS the main process reads controllers from the start
 * (unless it reports it can't), and the Gamepad API stays untouched: the first call or `gamepadconnected` listener
 * starts Chromium's own Switch Pro driver, which then handshakes with the same controllers as SDL.
 */
let native: Gamepad[] | null = isElectron && isMac ? [] : null
const changeListeners = new Set<() => void>()
const notifyChange = () => {
  for (const l of changeListeners) l()
}

let gamepadApiEvents = false
function listenToGamepadApi(): void {
  if (gamepadApiEvents) return
  gamepadApiEvents = true
  window.addEventListener('gamepadconnected', notifyChange)
  window.addEventListener('gamepaddisconnected', notifyChange)
}

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
  if (!native) listenToGamepadApi()
  if (native?.map((g) => g.id).join('\n') !== before) notifyChange()
}

if (native) {
  let heard = false
  api.on.gamepads((p) => {
    heard = true
    applyNative(p)
  })
  void api.system
    .getGamepads()
    .then((p) => heard || applyNative(p))
    .catch(() => undefined)
} else listenToGamepadApi()

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
  return () => {
    changeListeners.delete(cb)
  }
}
