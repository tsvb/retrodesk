import { create } from 'zustand'

interface UiState {
  /** Colour tinting the ambient background (focused system/game). */
  ambient: string | null
  fullscreen: boolean
  setAmbient(c: string | null): void
  setFullscreen(f: boolean): void
}

export const useUi = create<UiState>((set, get) => ({
  ambient: null,
  fullscreen: false,
  setAmbient(c) {
    if (get().ambient !== c) set({ ambient: c })
  },
  setFullscreen(f) {
    if (get().fullscreen !== f) set({ fullscreen: f })
  }
}))
