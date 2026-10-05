import { app } from 'electron'
import { homedir } from 'os'
import { isAbsolute, join } from 'path'
import type { DeepPartial } from '../shared/api'
import type { Settings } from '../shared/types'
import { deepMerge as merge } from '../shared/merge'
import { isValidSetting, settingDef, settingDefault as d } from '../shared/settingsSchema'
import { readJson, writeJsonAtomic } from './util/json'
import { broadcast } from './events'

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
      theme: d('ui.theme'),
      accent: '#7c5cff',
      density: d('ui.density'),
      sounds: d('ui.sounds'),
      haptics: d('ui.haptics'),
      startFullscreen: d('ui.startFullscreen'),
      hideEmptySystems: d('ui.hideEmptySystems'),
      buttonLayout: d('ui.buttonLayout')
    },
    retroarch: {
      shader: d('retroarch.shader'),
      autoSaveState: d('retroarch.autoSaveState'),
      autoLoadState: d('retroarch.autoLoadState'),
      showFps: d('retroarch.showFps'),
      runAhead: d('retroarch.runAhead'),
      rewind: d('retroarch.rewind'),
      integerScale: d('retroarch.integerScale'),
      aspect: d('retroarch.aspect'),
      videoDriver: d('retroarch.videoDriver')
    },
    retroAchievements: { enabled: d('retroAchievements.enabled'), username: '', password: '', hardcore: d('retroAchievements.hardcore') },
    hotkeys: { quickMenu: 'Control+Alt+Home', quickMenuCombo: [8, 9] },
    performance: { inGameMode: d('performance.inGameMode') },
    scraping: { autoFetchArtwork: d('scraping.autoFetchArtwork'), preferredRegion: d('scraping.preferredRegion') }
  }
}

const file = () => join(app.getPath('userData'), 'settings.json')
let current: Settings | null = null
const listeners = new Set<(s: Settings, prev: Settings) => void>()

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Fields whose shape the defaults alone cannot describe (paths, arrays, free-form maps). Keyed by dotted path. */
const FIELD_CHECKS: Record<string, (v: unknown) => boolean> = {
  dataRoot: (v) => typeof v === 'string' && isAbsolute(v),
  romFolders: (v) =>
    Array.isArray(v) && v.every((f) => isPlainObject(f) && typeof f['path'] === 'string' && isAbsolute(f['path']) && (f['systemId'] === undefined || typeof f['systemId'] === 'string')),
  systemEmulator: (v) => isPlainObject(v) && Object.values(v).every((x) => x === undefined || typeof x === 'string'),
  'hotkeys.quickMenuCombo': (v) => Array.isArray(v) && v.every((n) => Number.isInteger(n) && n >= 0 && n < 64),
  'ui.accent': (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
}

/**
 * Keep only the parts of `patch` that fit the shape of the defaults: known keys holding the same kind of value,
 * and for choices declared in the settings schema, one of the declared options.
 * Settings arrive from the renderer and from a hand-editable file, so neither is taken on trust.
 */
export function conform(shape: unknown, patch: unknown, path = ''): unknown {
  const check = FIELD_CHECKS[path]
  if (check) return check(patch) ? patch : undefined
  const def = settingDef(path)
  if (def) return isValidSetting(def, patch) ? patch : undefined
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
  broadcast('settingsChanged', current)
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
