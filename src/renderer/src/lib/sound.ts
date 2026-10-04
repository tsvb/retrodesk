/**
 * Synthesised UI sounds (WebAudio). Nothing is loaded from disk: every sound is a couple of short
 * enveloped oscillators so the UI feels tactile without shipping assets.
 */
export type UiSound = 'move' | 'confirm' | 'back' | 'toggle' | 'error' | 'open' | 'launch'

/** One enveloped oscillator: frequency (optionally gliding to `glideTo`), start offset and length in seconds. */
interface Blip {
  freq: number
  at?: number
  dur: number
  type: OscillatorType
  peak: number
  glideTo?: number
}

/** A full set of sounds. Themes pick one, so a theme can sound like it looks. */
export type SoundPalette = 'soft' | 'chip'

const VOICES: Record<SoundPalette, Record<UiSound, Blip[]>> = {
  // Rounded sines and triangles.
  soft: {
    move: [{ freq: 2100, dur: 0.035, type: 'sine', peak: 0.05, glideTo: 1800 }],
    confirm: [
      { freq: 660, dur: 0.07, type: 'triangle', peak: 0.12 },
      { freq: 990, at: 0.055, dur: 0.11, type: 'triangle', peak: 0.1 }
    ],
    back: [
      { freq: 620, dur: 0.06, type: 'triangle', peak: 0.1 },
      { freq: 415, at: 0.05, dur: 0.1, type: 'triangle', peak: 0.08 }
    ],
    toggle: [{ freq: 1250, dur: 0.05, type: 'square', peak: 0.03 }],
    open: [{ freq: 440, dur: 0.16, type: 'sine', peak: 0.09, glideTo: 880 }],
    error: [
      { freq: 180, dur: 0.12, type: 'sawtooth', peak: 0.05 },
      { freq: 150, at: 0.1, dur: 0.16, type: 'sawtooth', peak: 0.05 }
    ],
    launch: [
      { freq: 523, dur: 0.09, type: 'triangle', peak: 0.1 },
      { freq: 659, at: 0.08, dur: 0.09, type: 'triangle', peak: 0.1 },
      { freq: 784, at: 0.16, dur: 0.09, type: 'triangle', peak: 0.1 },
      { freq: 1047, at: 0.24, dur: 0.22, type: 'triangle', peak: 0.11 }
    ]
  },
  // Square-wave handheld: the same gestures as a 1989 sound chip would play them.
  chip: {
    move: [{ freq: 1568, dur: 0.03, type: 'square', peak: 0.025 }],
    confirm: [
      { freq: 784, dur: 0.05, type: 'square', peak: 0.05 },
      { freq: 1568, at: 0.05, dur: 0.09, type: 'square', peak: 0.05 }
    ],
    back: [
      { freq: 784, dur: 0.05, type: 'square', peak: 0.045 },
      { freq: 392, at: 0.05, dur: 0.09, type: 'square', peak: 0.045 }
    ],
    toggle: [{ freq: 1047, dur: 0.04, type: 'square', peak: 0.035 }],
    open: [
      { freq: 523, dur: 0.05, type: 'square', peak: 0.04 },
      { freq: 784, at: 0.05, dur: 0.05, type: 'square', peak: 0.04 },
      { freq: 1047, at: 0.1, dur: 0.08, type: 'square', peak: 0.04 }
    ],
    error: [
      { freq: 196, dur: 0.1, type: 'square', peak: 0.05 },
      { freq: 147, at: 0.1, dur: 0.18, type: 'square', peak: 0.05 }
    ],
    launch: [
      { freq: 523, dur: 0.07, type: 'square', peak: 0.045 },
      { freq: 659, at: 0.07, dur: 0.07, type: 'square', peak: 0.045 },
      { freq: 784, at: 0.14, dur: 0.07, type: 'square', peak: 0.045 },
      { freq: 1047, at: 0.21, dur: 0.07, type: 'square', peak: 0.045 },
      { freq: 1568, at: 0.28, dur: 0.2, type: 'square', peak: 0.05 }
    ]
  }
}

let ctx: AudioContext | null = null
let master: GainNode | null = null
let enabled = true
let palette: SoundPalette = 'soft'
let lastMove = 0

export function setSoundsEnabled(on: boolean): void {
  enabled = on
}

export function setSoundPalette(p: SoundPalette): void {
  palette = p
}

function audio(): { ctx: AudioContext; out: GainNode } | null {
  if (!enabled) return null
  try {
    if (!ctx) {
      ctx = new AudioContext({ latencyHint: 'interactive' })
      master = ctx.createGain()
      master.gain.value = 0.5
      master.connect(ctx.destination)
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return master ? { ctx, out: master } : null
  } catch {
    return null
  }
}

function blip({ freq, at = 0, dur, type, peak, glideTo }: Blip): void {
  const a = audio()
  if (!a) return
  const t0 = a.ctx.currentTime + at
  const osc = a.ctx.createOscillator()
  const gain = a.ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur)
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.006)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(gain).connect(a.out)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

/** Play a sound from the current palette. UI code calls feedback() (lib/feedback.ts), which also handles rumble. */
export function playSound(kind: UiSound): void {
  if (!enabled) return
  if (kind === 'move') {
    // Throttle so held-direction repeats don't turn into a buzz.
    const now = performance.now()
    if (now - lastMove < 45) return
    lastMove = now
  }
  VOICES[palette][kind].forEach(blip)
}

/** Unlock the AudioContext on the first real user gesture (autoplay policy). */
export function primeAudioOnGesture(): void {
  const unlock = () => {
    audio()
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
}
