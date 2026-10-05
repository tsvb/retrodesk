import { create } from 'zustand'
import { padFamily, resolveButtonLayout } from '@shared/pads'
import type { InputSource, PadFamily } from '../input/types'
import { useSettings } from './settings'

export { padFamily }

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

/** Which button confirms right now: the setting, with "Automatic" following the first connected controller. */
export function currentButtonLayout(): 'xbox' | 'nintendo' {
  return resolveButtonLayout(useSettings.getState().settings?.ui.buttonLayout ?? 'auto', useInputStore.getState().pads[0]?.family)
}

/** currentButtonLayout as a hook. */
export function useButtonLayout(): 'xbox' | 'nintendo' {
  const setting = useSettings((s) => s.settings?.ui.buttonLayout ?? 'auto')
  const family = useInputStore((s) => s.pads[0]?.family)
  return resolveButtonLayout(setting, family)
}

/** Which glyph set the hint bar should use. */
export function useGlyphFamily(): PadFamily | 'keyboard' {
  return useInputStore((s) => {
    const pad = s.pads[0]
    if (!pad || s.source === 'keyboard') return 'keyboard'
    return pad.family
  })
}
