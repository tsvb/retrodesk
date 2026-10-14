// Native controller input for macOS. Chromium's Gamepad API misses common controllers there (a Bluetooth Switch Pro
// Controller never reaches a page), so on a Mac a utility process reads controllers through SDL (gamepads-sdl.ts) and
// this pushes their state to both windows in the W3C Standard Gamepad layout; the renderer reads that instead of
// navigator.getGamepads(). SDL stays out of the main process because opening a controller can block for seconds.
import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'path'
import type { NativePad } from '../shared/types'
import { broadcast } from './events'
import type { GamepadsMainMessage, GamepadsWorkerMessage } from './gamepads-sdl'
import { hostOs } from './platform'

/** Undefined until started; null once it has exited (or never could run). */
let worker: UtilityProcess | null | undefined
/** Latest snapshot, or null when the renderer should use the Gamepad API itself. */
let pads: NativePad[] | null = null

/** Start reading controllers in the gamepads utility process (macOS only; elsewhere the Gamepad API works). Never throws. */
export function initNativeGamepads(): void {
  if (worker !== undefined || hostOs() !== 'macos') return
  try {
    worker = utilityProcess.fork(join(__dirname, 'gamepads-worker.js'), [], { serviceName: 'RetroDesk Controllers' })
  } catch (e) {
    console.warn('[gamepads] could not start the controller process; falling back to the Gamepad API', e)
    worker = null
    return
  }
  pads = []
  worker.on('message', (m: GamepadsWorkerMessage) => {
    pads = m.pads
    broadcast('gamepads', pads)
  })
  worker.on('exit', (code) => {
    // SDL is missing, or the process died: hand controllers back to the renderer's Gamepad API.
    if (code !== 0) console.warn(`[gamepads] controller process exited with code ${code}; falling back to the Gamepad API`)
    worker = null
    pads = null
    broadcast('gamepads', null)
  })
}

/** Current controllers, or null when the renderer should use the Gamepad API. */
export function getNativeGamepads(): NativePad[] | null {
  return pads
}

/** Rumble every open controller (0..1 each). Controllers without motors ignore it. */
export function rumbleNativeGamepads(light: number, heavy: number, durationMs: number): void {
  worker?.postMessage({ type: 'rumble', light, heavy, durationMs } satisfies GamepadsMainMessage)
}
