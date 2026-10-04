/**
 * Synthesised UI sounds (WebAudio). Nothing is loaded from disk: every sound is a couple of short
 * enveloped oscillators so the UI feels tactile without shipping assets.
 */
export type UiSound = 'move' | 'confirm' | 'back' | 'toggle' | 'error' | 'open'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let enabled = true
let lastMove = 0

export function setSoundsEnabled(on: boolean): void {
  enabled = on
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

function blip(freq: number, start: number, dur: number, type: OscillatorType, peak: number, glideTo?: number): void {
  const a = audio()
  if (!a) return
  const t0 = a.ctx.currentTime + start
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

export function playSound(kind: UiSound): void {
  if (!enabled) return
  switch (kind) {
    case 'move': {
      // Throttle so held-direction repeats don't turn into a buzz.
      const now = performance.now()
      if (now - lastMove < 45) return
      lastMove = now
      blip(2100, 0, 0.035, 'sine', 0.05, 1800)
      break
    }
    case 'confirm':
      blip(660, 0, 0.07, 'triangle', 0.12)
      blip(990, 0.055, 0.11, 'triangle', 0.1)
      break
    case 'back':
      blip(620, 0, 0.06, 'triangle', 0.1)
      blip(415, 0.05, 0.1, 'triangle', 0.08)
      break
    case 'toggle':
      blip(1250, 0, 0.05, 'square', 0.03)
      break
    case 'open':
      blip(440, 0, 0.16, 'sine', 0.09, 880)
      break
    case 'error':
      blip(180, 0, 0.12, 'sawtooth', 0.05)
      blip(150, 0.1, 0.16, 'sawtooth', 0.05)
      break
  }
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
