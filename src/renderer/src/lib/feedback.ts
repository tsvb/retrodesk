/**
 * What the UI does back when you do something: one table from event to sound and controller rumble.
 * Every screen calls feedback(event); nothing else plays a sound or shakes a pad.
 */
import { api } from '../api'
import { padsAreNative } from '../input/pads'
import { useInputStore } from '../stores/input'
import { playSound, type UiSound } from './sound'

export type FeedbackEvent = UiSound

/** A dual-rumble pulse: length in ms, then the light (high-frequency) and heavy (low-frequency) motor strengths, 0..1. */
interface Rumble {
  ms: number
  light: number
  heavy: number
}

const FEEDBACK: Record<FeedbackEvent, { sound: UiSound; rumble?: Rumble }> = {
  // Moving focus stays silent in the hands: it fires many times a second while a direction is held.
  move: { sound: 'move' },
  confirm: { sound: 'confirm', rumble: { ms: 35, light: 0.45, heavy: 0 } },
  back: { sound: 'back', rumble: { ms: 25, light: 0.3, heavy: 0 } },
  toggle: { sound: 'toggle', rumble: { ms: 20, light: 0.35, heavy: 0 } },
  open: { sound: 'open', rumble: { ms: 50, light: 0.4, heavy: 0.15 } },
  error: { sound: 'error', rumble: { ms: 180, light: 0.2, heavy: 0.75 } },
  launch: { sound: 'launch', rumble: { ms: 260, light: 0.6, heavy: 0.85 } }
}

let haptics = true

export function setHapticsEnabled(on: boolean): void {
  haptics = on
}

function rumble(r: Rumble): void {
  // Only when a pad is what the player is holding: a controller buzzing on the sofa during mouse use is a bug.
  if (!haptics || useInputStore.getState().source !== 'pad') return
  if (padsAreNative()) {
    void api.system.rumbleGamepads(r.light, r.heavy, r.ms).catch(() => undefined)
    return
  }
  try {
    for (const pad of navigator.getGamepads()) {
      // Not every pad or driver has an actuator; those that don't simply stay still.
      void pad?.vibrationActuator?.playEffect('dual-rumble', { duration: r.ms, weakMagnitude: r.light, strongMagnitude: r.heavy })?.catch(() => undefined)
    }
  } catch {
    /* Gamepad API unavailable */
  }
}

export function feedback(event: FeedbackEvent): void {
  const f = FEEDBACK[event]
  playSound(f.sound)
  if (f.rumble) rumble(f.rumble)
}
