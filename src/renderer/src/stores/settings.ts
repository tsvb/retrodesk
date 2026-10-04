import { create } from 'zustand'
import type { DeepPartial } from '@shared/api'
import { deepMerge as merge } from '@shared/merge'
import type { Settings } from '@shared/types'
import { api } from '../api'
import { hexToRgb } from '../lib/color'
import { setHapticsEnabled } from '../lib/feedback'
import { setSoundPalette, setSoundsEnabled } from '../lib/sound'

interface SettingsState {
  settings: Settings | null
  load(): Promise<Settings>
  /** Optimistically merges locally, then persists and adopts the backend's result. */
  update(patch: DeepPartial<Settings>): Promise<void>
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: null,
  async load() {
    const s = await api.settings.get()
    set({ settings: s })
    applyAppearance(s)
    return s
  },
  async update(patch) {
    const cur = get().settings
    if (cur) {
      const next = merge(cur, patch)
      set({ settings: next })
      applyAppearance(next)
    }
    try {
      const saved = await api.settings.set(patch)
      set({ settings: saved })
      applyAppearance(saved)
    } catch (e) {
      console.error('settings.set failed', e)
      if (cur) {
        set({ settings: cur })
        applyAppearance(cur)
      }
      throw e
    }
  }
}))

export function applyAppearance(s: Settings): void {
  const root = document.documentElement
  root.dataset.theme = s.ui.theme
  root.dataset.density = s.ui.density
  const [r, g, b] = hexToRgb(s.ui.accent)
  root.style.setProperty('--accent', s.ui.accent)
  root.style.setProperty('--accent-rgb', `${r} ${g} ${b}`)
  setSoundsEnabled(s.ui.sounds)
  // The dot-matrix theme sounds like the handheld it looks like.
  setSoundPalette(s.ui.theme === 'retro' ? 'chip' : 'soft')
  setHapticsEnabled(s.ui.haptics)
}

/** Follow settings changes made by any window (main or overlay). Returns the unsubscribe function. */
export function followSettingsChanges(): () => void {
  return api.on.settingsChanged((next) => {
    useSettings.setState({ settings: next })
    applyAppearance(next)
  })
}

/** Convenience selector: settings are always loaded before the app renders. */
export function useSettingsValue(): Settings {
  const s = useSettings((st) => st.settings)
  if (!s) throw new Error('Settings not loaded')
  return s
}
