import { app } from 'electron'
import { homedir } from 'os'
import { isAbsolute, join } from 'path'
import type { DeepPartial } from '../shared/api'
import type { Settings } from '../shared/types'
import { readJson, writeJsonAtomic } from './util/json'
import { broadcast } from './events'
import { EVENTS } from '../shared/api'

/** Folder holding the portable exe (set by electron-builder's portable launcher), else undefined. */
export const portableDir = (): string | undefined => process.env['PORTABLE_EXECUTABLE_DIR'] || undefined

/** The portable build keeps everything in RetroDesk-data next to the exe. */
export const portableDataDir = (): string | undefined => {
  const dir = portableDir()
  return dir ? join(dir, 'RetroDesk-data') : undefined
}

export function defaultSettings(): Settings {
  return {
    onboarded: false,
    dataRoot: process.env['RETRODESK_DATA_ROOT'] || portableDataDir() || join(homedir(), 'RetroDesk'),
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

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Fields whose shape the defaults alone cannot describe (paths, arrays, free-form maps). Keyed by dotted path. */
const FIELD_CHECKS: Record<string, (v: unknown) => boolean> = {
  dataRoot: (v) => typeof v === 'string' && isAbsolute(v),
  romFolders: (v) =>
    Array.isArray(v) &&
    v.every((f) => isPlainObject(f) && typeof f['path'] === 'string' && isAbsolute(f['path']) && (f['systemId'] === undefined || typeof f['systemId'] === 'string')),
  systemEmulator: (v) => isPlainObject(v) && Object.values(v).every((x) => x === undefined || typeof x === 'string'),
  'hotkeys.quickMenuCombo': (v) => Array.isArray(v) && v.every((n) => Number.isInteger(n) && n >= 0 && n < 64)
}

/**
 * Keep only the parts of `patch` that fit the shape of the defaults: known keys holding the same kind of value.
 * Settings arrive from the renderer and from a hand-editable file, so neither is taken on trust.
 */
function conform(shape: unknown, patch: unknown, path = ''): unknown {
  const check = FIELD_CHECKS[path]
  if (check) return check(patch) ? patch : undefined
  if (!isPlainObject(shape)) return typeof patch === typeof shape ? patch : undefined
  if (!isPlainObject(patch)) return undefined
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) {
    if (!Object.hasOwn(shape, k)) continue
    const ok = conform(shape[k], v, path ? `${path}.${k}` : k)
    if (ok !== undefined) out[k] = ok
  }
  return out
}

export function getSettings(): Settings {
  if (!current) current = merge(defaultSettings(), conform(defaultSettings(), readJson<unknown>(file(), {})) ?? {})
  return current
}

export function updateSettings(patch: DeepPartial<Settings>): Settings {
  const prev = getSettings()
  current = merge(prev, conform(defaultSettings(), patch) ?? {})
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
