import { tmpdir } from 'os'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() }, BrowserWindow: { getAllWindows: () => [] } }))

import { SETTINGS_SCHEMA, getSetting, isValidSetting, retroArchCfgFromSettings, type SettingPath } from '../shared/settingsSchema'
import { conform, defaultSettings } from './settings'

describe('settings schema', () => {
  it('declares a default that is one of its own options, at a path that exists in the defaults', () => {
    const defaults = defaultSettings()
    for (const path of Object.keys(SETTINGS_SCHEMA) as SettingPath[]) {
      const def = SETTINGS_SCHEMA[path]
      expect(isValidSetting(def, def.default), path).toBe(true)
      expect(getSetting(defaults, path), path).toBe(def.default)
    }
  })

  it('maps retroarch settings to config through the schema', () => {
    const s = defaultSettings()
    s.retroarch.aspect = 'stretch'
    s.retroarch.integerScale = true
    expect(retroArchCfgFromSettings(s)).toMatchObject({ aspect_ratio_index: '24', video_scale_integer: 'true', video_driver: 'vulkan', savestate_auto_save: 'true' })
  })
})

describe('conform', () => {
  const shape = defaultSettings()
  it('keeps declared options and drops anything else', () => {
    expect(conform(shape, { retroarch: { shader: 'crt', videoDriver: 'banana', showFps: 'yes' }, ui: { theme: 'retro', density: 7 } })).toEqual({
      retroarch: { shader: 'crt' },
      ui: { theme: 'retro' }
    })
  })
  it('drops unknown keys and wrongly shaped fields', () => {
    expect(conform(shape, { nope: 1, dataRoot: 'relative\\path', ui: { accent: 'red' }, hotkeys: { quickMenuCombo: [8, 'x'] } })).toEqual({ ui: {}, hotkeys: {} })
    expect(conform(shape, { ui: { accent: '#ff8a3d' } })).toEqual({ ui: { accent: '#ff8a3d' } })
  })
})
