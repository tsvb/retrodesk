// Controller reading through SDL, run in the gamepads utility process (gamepads-worker.ts), never in the main process:
// SDL opens a controller synchronously, and a Switch Pro Controller's handshake can block for a second or more per
// attempt (and SDL retries a pad that fails it for as long as it stays connected), which froze every window.
//
// SDL is loaded with the dummy video driver: its Cocoa driver would pump native events and repeat keystrokes.
// Controller input is allowed while RetroDesk is in the background, which it always is while a game runs (the overlay
// watches for the quick-menu combo), and Nintendo pads report positions, not labels, like every other pad does in the
// standard layout. RetroArch reads the same controller alongside SDL without trouble.
import type { NativePad } from '../shared/types'

/** The subset of @kmamal/sdl used here. */
export interface SdlDevice {
  id: number
  name: string | null
  path: string | null
}
export interface SdlControllerInstance {
  device: SdlDevice
  buttons: Record<string, boolean>
  axes: Record<string, number>
  closed: boolean
  on(event: 'buttonDown' | 'buttonUp' | 'axisMotion' | 'close', cb: () => void): void
  rumble(low?: number, high?: number, durationMs?: number): void
  close(): void
}
export interface SdlModule {
  controller: {
    devices: SdlDevice[]
    openDevice(device: SdlDevice): SdlControllerInstance
    on(event: 'deviceAdd', cb: (e: { device: SdlDevice }) => void): void
    on(event: 'deviceRemove', cb: (e: { device: SdlDevice }) => void): void
  }
}

/** Utility process -> main. */
export type GamepadsWorkerMessage = { type: 'pads'; pads: NativePad[] }
/** Main -> utility process. */
export type GamepadsMainMessage = { type: 'rumble'; light: number; heavy: number; durationMs: number }

/** SDL button names by W3C Standard Gamepad index (16 = Guide / Home). */
export const STANDARD_BUTTONS = [
  'a',
  'b',
  'x',
  'y',
  'leftShoulder',
  'rightShoulder',
  'leftTrigger',
  'rightTrigger',
  'back',
  'start',
  'leftStick',
  'rightStick',
  'dpadUp',
  'dpadDown',
  'dpadLeft',
  'dpadRight',
  'guide'
] as const
const STANDARD_AXES = ['leftStickX', 'leftStickY', 'rightStickX', 'rightStickY'] as const

/** One controller's state in the standard layout. SDL triggers are axes (0..1); the standard layout has them as buttons 6 and 7. */
export function toStandard(index: number, name: string, buttons: Record<string, boolean>, axes: Record<string, number>): NativePad {
  return {
    index,
    id: name,
    buttons: STANDARD_BUTTONS.map((b) => (b === 'leftTrigger' || b === 'rightTrigger' ? Math.max(0, Math.min(1, axes[b] ?? 0)) : buttons[b] ? 1 : 0)),
    axes: STANDARD_AXES.map((a) => axes[a] ?? 0)
  }
}

/** Snapshots go out at most this often; a moving stick sends hundreds of SDL events a second. */
const FLUSH_MS = 8

/**
 * Opening a Switch Pro Controller runs a handshake that can time out (while the pad is still waking up, or after the
 * Mac wakes with it connected). A failed open makes SDL drop the pad and add it again half a second later; opening it
 * straight away every time floods its Bluetooth link with handshakes, which can keep it from ever answering in time.
 * So a pad that fails is retried after a delay that doubles each time, from OPEN_RETRY_MS up to OPEN_RETRY_MAX_MS.
 */
const OPEN_RETRY_MS = 1000
const OPEN_RETRY_MAX_MS = 30_000

export interface SdlGamepads {
  rumble(light: number, heavy: number, durationMs: number): void
}

/** Load SDL and start reading controllers, posting every change. Null when SDL is not available. `load` is for tests. */
export function startSdlGamepads(post: (m: GamepadsWorkerMessage) => void, load = (): SdlModule => require('@kmamal/sdl') as SdlModule): SdlGamepads | null {
  process.env['SDL_VIDEODRIVER'] = 'dummy'
  process.env['SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS'] = '1'
  process.env['SDL_GAMECONTROLLER_USE_BUTTON_LABELS'] = '0'
  let sdl: SdlModule
  try {
    // An optional dependency with a native binding: required at run time, never bundled.
    sdl = load()
  } catch (e) {
    console.warn('[gamepads] SDL is not available; falling back to the Gamepad API', e)
    return null
  }

  const open = new Map<number, SdlControllerInstance>()
  let flushTimer: NodeJS.Timeout | undefined
  const snapshot = (): NativePad[] => [...open.values()].map((c, i) => toStandard(i, c.device.name ?? 'Controller', c.buttons, c.axes))
  const scheduleFlush = (): void => {
    flushTimer ??= setTimeout(() => {
      flushTimer = undefined
      post({ type: 'pads', pads: snapshot() })
    }, FLUSH_MS)
  }

  /** Pads waiting out a failed open, by deviceKey. SDL gives a pad a new id each time it adds it again. */
  const backoff = new Map<string, { delayMs: number; timer?: NodeJS.Timeout }>()
  const deviceKey = (d: SdlDevice): string => d.path ?? d.name ?? String(d.id)

  const openDevice = (device: SdlDevice): void => {
    const key = deviceKey(device)
    const waiting = backoff.get(key)
    if (open.has(device.id) || waiting?.timer) return
    try {
      const c = sdl.controller.openDevice(device)
      backoff.delete(key)
      open.set(device.id, c)
      c.on('buttonDown', scheduleFlush)
      c.on('buttonUp', scheduleFlush)
      c.on('axisMotion', scheduleFlush)
      c.on('close', () => {
        open.delete(device.id)
        scheduleFlush()
      })
      scheduleFlush()
    } catch (e) {
      const delayMs = waiting ? Math.min(waiting.delayMs * 2, OPEN_RETRY_MAX_MS) : OPEN_RETRY_MS
      if (delayMs !== waiting?.delayMs) console.warn(`[gamepads] could not open ${device.name ?? 'a controller'}; retrying in ${delayMs / 1000}s`, e)
      const entry: { delayMs: number; timer?: NodeJS.Timeout } = { delayMs }
      entry.timer = setTimeout(() => {
        entry.timer = undefined
        const again = sdl.controller.devices.find((d) => deviceKey(d) === key)
        // Gone for good: the next time it connects starts afresh.
        if (again) openDevice(again)
        else backoff.delete(key)
      }, delayMs)
      backoff.set(key, entry)
    }
  }

  sdl.controller.on('deviceAdd', (e) => openDevice(e.device))
  sdl.controller.on('deviceRemove', (e) => {
    const c = open.get(e.device.id)
    if (c && !c.closed) c.close()
    open.delete(e.device.id)
    scheduleFlush()
  })
  for (const d of sdl.controller.devices) openDevice(d)
  scheduleFlush()

  return {
    rumble(light, heavy, durationMs) {
      for (const c of open.values()) {
        try {
          c.rumble(heavy, light, durationMs)
        } catch {
          /* no rumble on this controller */
        }
      }
    }
  }
}
