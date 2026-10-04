import { create } from 'zustand'
import type { DeepPartial } from '@shared/api'
import type { Settings } from '@shared/types'
import { api } from '../api'
import { hexToRgb } from '../lib/color'
import { setSoundsEnabled } from '../lib/sound'

interface SettingsState {
  settings: Settings | null
  load(): Promise<Settings>
  /** Optimistically merges locally, then persists and adopts the backend's result. */
  update(patch: DeepPartial<Settings>): Promise<void>
}

function merge<T>(base: T, patch: unknown): T {
  if (patch === undefined) return base
  if (Array.isArray(patch) || patch === null || typeof patch !== 'object' || typeof base !== 'object' || base === null || Array.isArray(base)) return patch as T
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) out[k] = merge(out[k], v)
  return out as T
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
