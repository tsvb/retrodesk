import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

import { defaultSettings } from '../settings'
import type { Settings } from '../../shared/types'
import { buildRetroArchArgs, buildRetroArchConfig, coreDisplayName, coreFileBase, parseCfg, resolveShaderPreset, serializeCfg } from './retroarch'

const paths = { bios: 'C:\\RD\\bios', saves: 'C:\\RD\\saves', states: 'C:\\RD\\states', screenshots: 'C:\\RD\\screenshots', emulators: 'C:\\RD\\emulators' }

function settings(patch: (s: Settings) => void = () => undefined): Settings {
  const s = defaultSettings()
  patch(s)
  return s
}

describe('buildRetroArchConfig', () => {
  it('sets frontend-critical keys', () => {
    const cfg = buildRetroArchConfig({ settings: settings(), paths })
    expect(cfg).toMatchObject({
      system_directory: paths.bios,
      savefile_directory: paths.saves,
      savestate_directory: paths.states,
      screenshot_directory: paths.screenshots,
      network_cmd_enable: 'true',
      network_cmd_port: '55355',
      video_fullscreen: 'true',
      video_windowed_fullscreen: 'true',
      pause_nonactive: 'false',
      config_save_on_exit: 'false',
      quit_press_twice: 'false',
      video_driver: 'vulkan',
      savestate_auto_save: 'true',
      savestate_auto_load: 'true',
      aspect_ratio_index: '22',
      video_shader_enable: 'false',
      cheevos_enable: 'false',
      input_enable_hotkey_btn: '7',
      input_save_state_btn: '5',
      input_load_state_btn: '4',
      input_toggle_fast_forward_axis: '+5'
    })
    expect(cfg.libretro_directory).toBe(join(paths.emulators, 'retroarch', 'cores'))
  })

  it('maps display + gameplay settings', () => {
    const cfg = buildRetroArchConfig({
      settings: settings((s) => {
        Object.assign(s.retroarch, { showFps: true, runAhead: true, rewind: true, integerScale: true, aspect: '4:3', videoDriver: 'd3d11', autoSaveState: false, autoLoadState: false })
        s.ui.buttonLayout = 'nintendo'
      }),
      paths,
      shaderPath: 'C:\\x.slangp'
    })
    expect(cfg).toMatchObject({
      fps_show: 'true',
      run_ahead_enabled: 'true',
      rewind_enable: 'true',
      input_rewind_axis: '+4',
      video_scale_integer: 'true',
      aspect_ratio_index: '0',
      video_driver: 'd3d11',
      savestate_auto_save: 'false',
      savestate_auto_load: 'false',
      video_shader_enable: 'true',
      menu_swap_ok_cancel_buttons: 'true'
    })
    expect(buildRetroArchConfig({ settings: settings((s) => (s.retroarch.aspect = 'stretch')), paths }).aspect_ratio_index).toBe('24')
    expect(buildRetroArchConfig({ settings: settings((s) => (s.retroarch.aspect = '16:9')), paths }).aspect_ratio_index).toBe('1')
  })

  it('does not bind Select+Start to quit when the overlay combo is Back+Start', () => {
    expect(buildRetroArchConfig({ settings: settings(), paths }).input_exit_emulator_btn).toBe('nul')
    const other = buildRetroArchConfig({ settings: settings((s) => (s.hotkeys.quickMenuCombo = [16])), paths })
    expect(other.input_exit_emulator_btn).toBe('6')
  })

  it('writes RetroAchievements credentials and hardcore disables rewind', () => {
    const cfg = buildRetroArchConfig({
      settings: settings((s) => {
        s.retroAchievements = { enabled: true, username: 'tim', password: 'p"w', hardcore: true }
        s.retroarch.rewind = true
      }),
      paths
    })
    expect(cfg).toMatchObject({ cheevos_enable: 'true', cheevos_username: 'tim', cheevos_password: 'pw', cheevos_hardcore_mode_enable: 'true', rewind_enable: 'false' })
  })

  it('serialises to quoted cfg lines that parse back', () => {
    const cfg = buildRetroArchConfig({ settings: settings(), paths })
    const text = serializeCfg(cfg)
    expect(text).toContain('network_cmd_enable = "true"')
    expect(text).toContain(`system_directory = "${paths.bios}"`)
    expect(parseCfg(text)).toEqual(cfg)
  })

  it('UI mode lets RetroArch persist menu changes', () => {
    expect(buildRetroArchConfig({ settings: settings(), paths, uiMode: true }).config_save_on_exit).toBe('true')
  })

  it('UI mode does not leave the command port enabled in the saved config', () => {
    expect(buildRetroArchConfig({ settings: settings(), paths, uiMode: true }).network_cmd_enable).toBe('false')
    expect(buildRetroArchConfig({ settings: settings(), paths }).network_cmd_enable).toBe('true')
  })
})

describe('launch args', () => {
  it('builds -L core rom --appendconfig', () => {
    expect(buildRetroArchArgs({ coreDll: 'C:\\ra\\cores\\snes9x_libretro.dll', rom: 'D:\\roms\\a b.sfc', appendCfg: 'C:\\ra\\retrodesk.cfg' })).toEqual([
      '-L',
      'C:\\ra\\cores\\snes9x_libretro.dll',
      '--appendconfig',
      'C:\\ra\\retrodesk.cfg',
      'D:\\roms\\a b.sfc'
    ])
    expect(buildRetroArchArgs({ appendCfg: 'x.cfg', shaderPath: 's.slangp' })).toEqual(['--appendconfig', 'x.cfg', '--set-shader', 's.slangp'])
  })

  it('normalises core names', () => {
    expect(coreFileBase('snes9x')).toBe('snes9x_libretro')
    expect(coreFileBase('snes9x_libretro')).toBe('snes9x_libretro')
    expect(coreFileBase('mesen-s_libretro.dll')).toBe('mesen-s_libretro')
    expect(coreDisplayName('mednafen_psx_hw_libretro')).toBe('Beetle PSX HW')
    expect(coreDisplayName('some_new_core_libretro')).toBe('Some NEW Core')
  })
})

describe('shader presets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rd-shader-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('picks the first existing candidate and falls back gracefully', () => {
    expect(resolveShaderPreset(dir, 'crt')).toBeUndefined()
    expect(resolveShaderPreset(dir, 'none')).toBeUndefined()
    mkdirSync(join(dir, 'shaders', 'shaders_slang', 'crt'), { recursive: true })
    writeFileSync(join(dir, 'shaders', 'shaders_slang', 'crt', 'crt-royale.slangp'), '')
    expect(resolveShaderPreset(dir, 'crt')).toBe(join(dir, 'shaders', 'shaders_slang', 'crt', 'crt-royale.slangp'))
    writeFileSync(join(dir, 'shaders', 'shaders_slang', 'crt', 'crt-geom.slangp'), '')
    expect(resolveShaderPreset(dir, 'crt')).toBe(join(dir, 'shaders', 'shaders_slang', 'crt', 'crt-geom.slangp'))
  })
})
