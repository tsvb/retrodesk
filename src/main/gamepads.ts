// Native controller input for macOS. Chromium's Gamepad API misses common controllers there (a Bluetooth Switch Pro
// Controller never reaches a page), so on a Mac the main process reads controllers through SDL and pushes their
// state to both windows in the W3C Standard Gamepad layout; the renderer reads that instead of navigator.getGamepads().
//
// SDL is loaded with the dummy video driver: its Cocoa driver would pump native events inside Electron's main process
// and repeat keystrokes. Controller input is allowed while RetroDesk is in the background, which it always is while a
// game runs (the overlay watches for the quick-menu combo), and Nintendo pads report positions, not labels, like every
// other pad does in the standard layout. RetroArch reads the same controller alongside SDL without trouble.
import type { NativePad } from '../shared/types'
import { broadcast } from './events'
import { hostOs } from './platform'

/** The subset of @kmamal/sdl used here. */
interface SdlDevice {
  id: number
  name: string | null
}
interface SdlControllerInstance {
  device: SdlDevice
  buttons: Record<string, boolean>
  axes: Record<string, number>
  closed: boolean
  on(event: 'buttonDown' | 'buttonUp' | 'axisMotion' | 'close', cb: () => void): void
  rumble(low?: number, high?: number, durationMs?: number): void
  close(): void
}
interface SdlModule {
  controller: {
    devices: SdlDevice[]
    openDevice(device: SdlDevice): SdlControllerInstance
    on(event: 'deviceAdd', cb: (e: { device: SdlDevice }) => void): void
    on(event: 'deviceRemove', cb: (e: { device: SdlDevice }) => void): void
  }
}

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

let sdl: SdlModule | null | undefined
const open = new Map<number, SdlControllerInstance>()
let flushTimer: NodeJS.Timeout | undefined

function snapshot(): NativePad[] {
  return [...open.values()].map((c, i) => toStandard(i, c.device.name ?? 'Controller', c.buttons, c.axes))
}

function scheduleFlush(): void {
  flushTimer ??= setTimeout(() => {
    flushTimer = undefined
    broadcast('gamepads', snapshot())
  }, FLUSH_MS)
}

/** Opening a Switch Pro Controller runs a handshake that can time out while the pad is still waking up; retry it. */
const OPEN_ATTEMPTS = 5
const OPEN_RETRY_MS = 1000

function openDevice(device: SdlDevice, attempt = 1): void {
  if (!sdl || open.has(device.id)) return
  try {
    const c = sdl.controller.openDevice(device)
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
    if (attempt >= OPEN_ATTEMPTS) {
      console.warn(`[gamepads] could not open ${device.name ?? 'a controller'}`, e)
      return
    }
    setTimeout(() => {
      if (sdl?.controller.devices.some((d) => d.id === device.id)) openDevice(device, attempt + 1)
    }, OPEN_RETRY_MS)
  }
}

/** True when controllers are read here rather than by the renderer's Gamepad API. */
export const usesNativeGamepads = (): boolean => !!sdl

/** Start reading controllers through SDL (macOS only; elsewhere the Gamepad API works). Never throws. */
export function initNativeGamepads(): void {
  if (sdl !== undefined || hostOs() !== 'macos') return
  process.env['SDL_VIDEODRIVER'] = 'dummy'
  process.env['SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS'] = '1'
  process.env['SDL_GAMECONTROLLER_USE_BUTTON_LABELS'] = '0'
  try {
    // An optional dependency with a native binding: required at run time, never bundled.
    sdl = require('@kmamal/sdl') as SdlModule
  } catch (e) {
    console.warn('[gamepads] SDL is not available; falling back to the Gamepad API', e)
    sdl = null
    return
  }
  sdl.controller.on('deviceAdd', (e) => openDevice(e.device))
  sdl.controller.on('deviceRemove', (e) => {
    const c = open.get(e.device.id)
    if (c && !c.closed) c.close()
    open.delete(e.device.id)
    scheduleFlush()
  })
  for (const d of sdl.controller.devices) openDevice(d)
}

/** Current controllers, or null when the renderer should use the Gamepad API itself. */
export function getNativeGamepads(): NativePad[] | null {
  return sdl ? snapshot() : null
}

/** Rumble every open controller (0..1 each). Controllers without motors ignore it. */
export function rumbleNativeGamepads(light: number, heavy: number, durationMs: number): void {
  for (const c of open.values()) {
    try {
      c.rumble(heavy, light, durationMs)
    } catch {
      /* no rumble on this controller */
    }
  }
}
