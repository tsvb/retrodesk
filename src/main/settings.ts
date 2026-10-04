import { app } from 'electron'
import { homedir } from 'os'
import { join } from 'path'
import { mkdirSync } from 'fs'
import type { DeepPartial } from '../shared/api'
import type { Settings } from '../shared/types'
import { readJson, writeJsonAtomic } from './util/json'
import { broadcast } from './events'
import { EVENTS } from '../shared/api'

export function defaultSettings(): Settings {
  return {
    onboarded: false,
    dataRoot: process.env['RETRODESK_DATA_ROOT'] || join(homedir(), 'RetroDesk'),
    romFolders: [],
    systemEmulator: {},
    ui: {
      theme: 'midnight',
      accent: '#7c5cff',
      density: 'comfortable',
      sounds: true,
      startFullscreen: false,
      hideEmptySystems: true,
      buttonLayout: 'xbox'
    },
    retroarch: {
      shader: 'none',
      autoSaveState: true,
      autoLoadState: true,
      showFps: false,
      runAhead: false,
      rewind: false,
      integerScale: false,
      aspect: 'core',
      videoDriver: 'vulkan'
    },
    retroAchievements: { enabled: false, username: '', password: '', hardcore: false },
    hotkeys: { quickMenu: 'Control+Alt+Home', quickMenuCombo: [8, 9] },
    performance: { inGameMode: 'unchanged' },
    scraping: { autoFetchArtwork: true, preferredRegion: 'USA' }
  }
}

const file = () => join(app.getPath('userData'), 'settings.json')
let current: Settings | null = null
const listeners = new Set<(s: Settings, prev: Settings) => void>()

function merge<T>(base: T, patch: unknown): T {
  if (patch === undefined) return base
  if (Array.isArray(patch) || patch === null || typeof patch !== 'object' || typeof base !== 'object' || base === null || Array.isArray(base)) {
    return patch as T
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    // Record<string, x> maps (e.g. systemEmulator) are replaced key-by-key, which merge() does naturally.
    out[k] = merge(out[k], v)
  }
  return out as T
}

export function getSettings(): Settings {
  if (!current) {
    current = merge(defaultSettings(), readJson<Partial<Settings>>(file(), {}))
    mkdirSync(current.dataRoot, { recursive: true })
  }
  return current
}

export function updateSettings(patch: DeepPartial<Settings>): Settings {
  const prev = getSettings()
  current = merge(prev, patch)
  writeJsonAtomic(file(), current)
  broadcast(EVENTS.settingsChanged, current)
  for (const l of listeners) {
    try {
      l(current, prev)
    } catch (e) {
      console.error('settings listener failed', e)
    }
  }
  return current
}

export function onSettingsChanged(cb: (s: Settings, prev: Settings) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
