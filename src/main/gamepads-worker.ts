// Entry point of the gamepads utility process (see gamepads.ts and gamepads-sdl.ts).
import { startSdlGamepads, type GamepadsMainMessage } from './gamepads-sdl'

const port = process.parentPort
const pads = startSdlGamepads((m) => port.postMessage(m))
// Exiting tells the main process to fall back to the Gamepad API.
if (!pads) process.exit(0)
else port.on('message', (e: { data: GamepadsMainMessage }) => pads.rumble(e.data.light, e.data.heavy, e.data.durationMs))
