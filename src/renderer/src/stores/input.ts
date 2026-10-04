import { create } from 'zustand'
import type { InputSource, PadFamily } from '../input/types'

export interface PadInfo {
  index: number
  id: string
  family: PadFamily
}

interface InputState {
  source: InputSource
  pads: PadInfo[]
  setSource(s: InputSource): void
  setPads(p: PadInfo[]): void
}

export const useInputStore = create<InputState>((set, get) => ({
  source: 'keyboard',
  pads: [],
  setSource(s) {
    if (get().source !== s) {
      set({ source: s })
      document.documentElement.dataset.input = s
    }
  },
  setPads(p) {
    const cur = get().pads
    if (cur.length === p.length && cur.every((c, i) => c.id === p[i]?.id && c.index === p[i]?.index)) return
    set({ pads: p })
  }
}))

export function padFamily(id: string): PadFamily {
  const s = id.toLowerCase()
  if (s.includes('054c') || s.includes('dualsense') || s.includes('dualshock') || s.includes('wireless controller') || s.includes('playstation')) return 'playstation'
  if (s.includes('057e') || s.includes('pro controller') || s.includes('joy-con') || s.includes('nintendo')) return 'nintendo'
  if (s.includes('xinput') || s.includes('xbox') || s.includes('045e') || s.includes('standard gamepad')) return 'xbox'
  return 'generic'
}

/** Which glyph set the hint bar should use. */
export function useGlyphFamily(): PadFamily | 'keyboard' {
  return useInputStore((s) => {
    const pad = s.pads[0]
    if (!pad || s.source === 'keyboard') return 'keyboard'
    return pad.family
  })
}
