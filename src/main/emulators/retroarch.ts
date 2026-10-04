// RetroArch: portable install, nightly core install, managed append-config generation and launch args.
import { existsSync } from 'fs'
import { mkdir, readdir, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import type { Settings } from '../../shared/types'
import { coreUrl, downloadTrusted, fetchText, fileSize, lastModifiedToVersion, retroArchLatestStable, retroArchUrl, USER_AGENT } from './download'
import { extractArchive, findFile, moveMerge, singleTopFolder } from './extract'

export const RA_ID = 'retroarch'
export const RA_NETWORK_PORT = 55355

export interface RaPaths {
  bios: string
  saves: string
  states: string
  screenshots: string
  emulators: string
  downloads: string
}

export const raDir = (p: Pick<RaPaths, 'emulators'>): string => join(p.emulators, 'retroarch')
export const raExe = (p: Pick<RaPaths, 'emulators'>): string => join(raDir(p), 'retroarch.exe')
export const raCoresDir = (p: Pick<RaPaths, 'emulators'>): string => join(raDir(p), 'cores')
export const raAppendCfgPath = (p: Pick<RaPaths, 'emulators'>): string => join(raDir(p), 'retrodesk.cfg')

/** systems.json may say "snes9x_libretro" or "snes9x"; files are always "<x>_libretro.dll". */
export function coreFileBase(core: string): string {
  const c = core.replace(/\.dll$/i, '')
  return c.endsWith('_libretro') ? c : `${c}_libretro`
}

export const coreDllPath = (p: Pick<RaPaths, 'emulators'>, core: string): string => join(raCoresDir(p), `${coreFileBase(core)}.dll`)

/** Friendly names for cores (fallback: prettified basename). */
const CORE_NAMES: Record<string, string> = {
  mesen: 'Mesen',
  fceumm: 'FCEUmm',
  nestopia: 'Nestopia UE',
  snes9x: 'Snes9x',
  bsnes: 'bsnes',
  'mesen-s': 'Mesen-S',
  mupen64plus_next: 'Mupen64Plus-Next',
  parallel_n64: 'ParaLLEl N64',
  gambatte: 'Gambatte',
  sameboy: 'SameBoy',
  mgba: 'mGBA',
  vbam: 'VBA-M',
  gpsp: 'gpSP',
  melondsds: 'melonDS DS',
  desmume: 'DeSmuME',
  azahar: 'Azahar',
  mednafen_vb: 'Beetle VB',
  genesis_plus_gx: 'Genesis Plus GX',
  picodrive: 'PicoDrive',
  blastem: 'BlastEm',
  gearsystem: 'Gearsystem',
  mednafen_saturn: 'Beetle Saturn',
  ymir: 'Ymir',
  kronos: 'Kronos',
  yabasanshiro: 'YabaSanshiro',
  flycast: 'Flycast',
  mednafen_psx_hw: 'Beetle PSX HW',
  swanstation: 'SwanStation',
  pcsx_rearmed: 'PCSX ReARMed',
  pcsx2: 'LRPS2',
  ppsspp: 'PPSSPP',
  stella: 'Stella',
  prosystem: 'ProSystem',
  handy: 'Handy',
  mednafen_lynx: 'Beetle Lynx',
  mednafen_pce: 'Beetle PCE',
  mednafen_pce_fast: 'Beetle PCE Fast',
  geargrafx: 'Geargrafx',
  fbneo: 'FinalBurn Neo',
  mame2003_plus: 'MAME 2003-Plus',
  mame: 'MAME',
  mednafen_wswan: 'Beetle WonderSwan',
  mednafen_ngp: 'Beetle NeoPop',
  race: 'RACE',
  opera: 'Opera',
  gearcoleco: 'Gearcoleco',
  bluemsx: 'blueMSX',
  fmsx: 'fMSX',
  dolphin: 'Dolphin',
  cemu: 'Cemu'
}

export function coreDisplayName(core: string): string {
  const base = coreFileBase(core).replace(/_libretro$/, '')
  return (
    CORE_NAMES[base] ??
    base
      .split(/[_-]/)
      .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(' ')
  )
}

/** Asset packs some cores need inside system_directory (= our BIOS dir). */
export const CORE_SYSTEM_ASSETS: Record<string, { url: string; marker: string }> = {
  ppsspp_libretro: { url: 'https://buildbot.libretro.com/assets/system/PPSSPP.zip', marker: 'PPSSPP/ppge_atlas.zim' },
  bluemsx_libretro: { url: 'https://buildbot.libretro.com/assets/system/blueMSX.zip', marker: 'Machines' }
}

export interface ProgressSink {
  update(progress: number, detail?: string): void
}

const mb = (n: number) => `${(n / 1048576).toFixed(n > 100 * 1048576 ? 0 : 1)} MB`

export function downloadDetail(received: number, total: number): string {
  return total ? `Downloading ${mb(received)} / ${mb(total)}` : `Downloading ${mb(received)}`
}

/** Install (or update) portable RetroArch into <emulators>/retroarch, preserving cores/ and user config. */
export async function installRetroArch(paths: RaPaths, task: ProgressSink, signal?: AbortSignal): Promise<{ version: string; exePath: string }> {
  task.update(-1, 'Finding latest RetroArch')
  const version = await retroArchLatestStable(signal)
  const archive = join(paths.downloads, `RetroArch-${version}.7z`)
  await downloadTrusted(retroArchUrl(version), archive, {
    signal,
    onProgress: (r, t) => task.update(t ? (r / t) * 0.8 : -1, downloadDetail(r, t))
  })
  const staging = join(paths.emulators, `.staging-retroarch-${Date.now()}`)
  try {
    task.update(0.8, 'Extracting')
    await extractArchive(archive, staging, { signal, onProgress: (f) => task.update(0.8 + f * 0.18, `Extracting ${Math.round(f * 100)}%`) })
    const root = await singleTopFolder(staging)
    task.update(0.98, 'Installing')
    await moveMerge(root, raDir(paths))
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    await rm(archive, { force: true }).catch(() => undefined)
  }
  await mkdir(raCoresDir(paths), { recursive: true })
  const exePath = raExe(paths)
  if (!existsSync(exePath)) throw new Error('retroarch.exe not found after extraction')
  return { version, exePath }
}

/** Install a libretro core from the nightly buildbot into <retroarch>/cores (+ its .info file and system assets). */
export async function installCore(core: string, paths: RaPaths, task: ProgressSink, signal?: AbortSignal): Promise<{ version: string; exePath: string; sizeBytes: number }> {
  const base = coreFileBase(core)
  const zip = join(paths.downloads, `${base}.dll.zip`)
  let version: string | undefined
  task.update(-1, `Downloading ${base}`)
  // Last-Modified doubles as the "version" for nightly cores.
  try {
    const head = await fetch(coreUrl(base), { method: 'HEAD', headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15_000) })
    version = lastModifiedToVersion(head.headers.get('last-modified'))
  } catch {
    /* non-fatal */
  }
  await downloadTrusted(coreUrl(base), zip, { signal, onProgress: (r, t) => task.update(t ? (r / t) * 0.85 : -1, downloadDetail(r, t)) })
  const staging = join(paths.emulators, `.staging-${base}-${Date.now()}`)
  const dest = coreDllPath(paths, base)
  try {
    task.update(0.88, 'Extracting')
    await extractArchive(zip, staging, { signal })
    const dll = await findFile(staging, `${base}.dll`, 2)
    if (!dll) throw new Error(`${base}.dll not found in core archive`)
    await mkdir(raCoresDir(paths), { recursive: true })
    await rm(dest, { force: true })
    await rename(dll, dest)
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    await rm(zip, { force: true }).catch(() => undefined)
  }
  // Core info file (display name, system id for GET_STATUS, firmware list). Best effort.
  const infoDir = join(raDir(paths), 'info')
  const infoFile = join(infoDir, `${base}.info`)
  if (!existsSync(infoFile)) {
    try {
      const info = await fetchText(`https://raw.githubusercontent.com/libretro/libretro-core-info/master/${base}.info`, { signal, retries: 2 })
      await mkdir(infoDir, { recursive: true })
      await writeFile(infoFile, info)
    } catch (e) {
      console.warn(`[retroarch] no core info for ${base}`, e)
    }
  }
  await ensureCoreSystemAssets(base, paths, task, signal)
  return { version: version ?? new Date().toISOString().slice(0, 10), exePath: dest, sizeBytes: await fileSize(dest) }
}

/** Download + extract asset packs (PPSSPP.zip, blueMSX.zip) into the BIOS/system dir if missing. */
export async function ensureCoreSystemAssets(core: string, paths: Pick<RaPaths, 'bios' | 'downloads'>, task?: ProgressSink, signal?: AbortSignal): Promise<void> {
  const asset = CORE_SYSTEM_ASSETS[coreFileBase(core)]
  if (!asset || existsSync(join(paths.bios, asset.marker))) return
  const name = asset.url.split('/').pop()!
  const zip = join(paths.downloads, name)
  task?.update(-1, `Downloading ${name}`)
  try {
    await downloadTrusted(asset.url, zip, { signal, onProgress: (r, t) => task?.update(t ? r / t : -1, downloadDetail(r, t)) })
    task?.update(-1, `Extracting ${name}`)
    await extractArchive(zip, paths.bios, { signal })
  } finally {
    await rm(zip, { force: true }).catch(() => undefined)
  }
}

// ---------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------

/** Preset candidates per shader setting, best first (paths relative to the RetroArch dir). */
export const SHADER_CANDIDATES: Record<Exclude<Settings['retroarch']['shader'], 'none'>, string[]> = {
  crt: ['shaders/shaders_slang/crt/crt-geom.slangp', 'shaders/shaders_slang/crt/crt-easymode.slangp', 'shaders/shaders_slang/crt/crt-royale.slangp', 'shaders/shaders_slang/crt/crt-lottes.slangp'],
  lcd: ['shaders/shaders_slang/handheld/lcd-grid-v2.slangp', 'shaders/shaders_slang/handheld/lcd3x.slangp', 'shaders/shaders_slang/handheld/lcd1x.slangp'],
  sharp: [
    'shaders/shaders_slang/pixel-art-scaling/sharp-bilinear.slangp',
    'shaders/shaders_slang/pixel-art-scaling/sharp-bilinear-simple.slangp',
    'shaders/shaders_slang/interpolation/sharp-bilinear.slangp'
  ]
}

export function resolveShaderPreset(dir: string, shader: Settings['retroarch']['shader'], exists: (p: string) => boolean = existsSync): string | undefined {
  if (shader === 'none') return undefined
  for (const rel of SHADER_CANDIDATES[shader] ?? []) {
    const p = join(dir, ...rel.split('/'))
    if (exists(p)) return p
  }
  return undefined
}

const ASPECT_INDEX: Record<Settings['retroarch']['aspect'], string> = {
  '4:3': '0',
  '16:9': '1',
  core: '22', // ASPECT_RATIO_CORE
  stretch: '24' // ASPECT_RATIO_FULL
}

/**
 * RetroArch XInput joypad driver button indices (input/drivers_joypad/xinput_joypad.c button_index_to_bitmap_code):
 * 0=A 1=B 2=X 3=Y 4=LB 5=RB 6=Start 7=Back 8=L3 9=R3 10=Guide; axes +4=LT +5=RT.
 */
const XI = { A: '0', B: '1', X: '2', Y: '3', LB: '4', RB: '5', START: '6', BACK: '7', L3: '8', R3: '9' } as const
/** W3C Standard Gamepad indices used by Settings.hotkeys.quickMenuCombo. */
const STD = { BACK: 8, START: 9, L3: 10, R3: 11 } as const

/** RetroArch cfg strings can't escape quotes/newlines. */
function cfgValue(v: string): string {
  return v.replace(/["\r\n]/g, '')
}

export interface RaConfigInput {
  settings: Settings
  paths: Pick<RaPaths, 'bios' | 'saves' | 'states' | 'screenshots' | 'emulators'>
  /** Shader preset that will be applied with --set-shader (undefined = none). */
  shaderPath?: string
  /** UI mode (openEmulatorUi): let RetroArch persist menu changes. */
  uiMode?: boolean
}

/** Build the RetroDesk-managed append config. Pure (no I/O) so it can be unit tested. */
export function buildRetroArchConfig({ settings, paths, shaderPath, uiMode }: RaConfigInput): Record<string, string> {
  const ra = settings.retroarch
  const cheevos = settings.retroAchievements
  const dir = raDir(paths)
  const combo = settings.hotkeys.quickMenuCombo ?? []
  // Don't bind Select+Start to "quit" when the overlay uses Back+Start to open the quick menu (it'd quit instantly).
  const comboUsesBackStart = combo.includes(STD.BACK) && combo.includes(STD.START)
  const comboUsesSticks = combo.includes(STD.L3) && combo.includes(STD.R3)
  const b = (v: boolean) => (v ? 'true' : 'false')

  const cfg: Record<string, string> = {
    // Directories
    system_directory: paths.bios,
    savefile_directory: paths.saves,
    savestate_directory: paths.states,
    screenshot_directory: paths.screenshots,
    libretro_directory: join(dir, 'cores'),
    libretro_info_path: join(dir, 'info'),
    savefiles_in_content_dir: 'false',
    savestates_in_content_dir: 'false',
    systemfiles_in_content_dir: 'false',
    screenshots_in_content_dir: 'false',
    sort_savefiles_enable: 'false',
    sort_savestates_enable: 'false',
    sort_savefiles_by_content_enable: 'false',
    sort_savestates_by_content_enable: 'false',
    sort_screenshots_by_content_enable: 'false',

    // Frontend integration
    // The command port has no authentication and RetroArch binds it on every interface, so only open it for
    // game sessions. UI mode saves its config on exit and must not leave the port enabled for later runs.
    network_cmd_enable: b(!uiMode),
    network_cmd_port: String(RA_NETWORK_PORT),
    config_save_on_exit: b(!!uiMode),
    pause_nonactive: 'false',
    quit_press_twice: 'false',
    quit_on_close_content: '1',
    suspend_screensaver_enable: 'true',
    ui_menubar_enable: 'false',
    notification_show_autoconfig: 'false',
    log_to_file: 'true',
    log_to_file_timestamp: 'false',
    log_dir: join(dir, 'logs'),

    // Video: borderless fullscreen so the always-on-top overlay can draw over the game.
    video_driver: ra.videoDriver,
    video_fullscreen: 'true',
    video_windowed_fullscreen: 'true',
    video_vsync: 'true',
    video_scale_integer: b(ra.integerScale),
    aspect_ratio_index: ASPECT_INDEX[ra.aspect] ?? '22',
    video_shader_enable: b(!!shaderPath),
    video_gpu_screenshot: 'true',
    fps_show: b(ra.showFps),

    // Save states / quick resume
    savestate_auto_save: b(ra.autoSaveState),
    savestate_auto_load: b(ra.autoLoadState),
    savestate_auto_index: 'false',
    savestate_thumbnail_enable: 'true',
    state_slot: '0',

    // Latency / rewind
    run_ahead_enabled: b(ra.runAhead),
    run_ahead_frames: '1',
    run_ahead_secondary_instance: 'true',
    rewind_enable: b(ra.rewind && !(cheevos.enabled && cheevos.hardcore)),

    // Controller hotkeys (Retroid style: hold Select + button). XInput driver gives stable indices.
    input_joypad_driver: 'xinput',
    input_autodetect_enable: 'true',
    input_enable_hotkey: 'nul', // keyboard hotkeys (F1/F2/F4/Esc...) work without a modifier
    input_enable_hotkey_btn: XI.BACK,
    input_enable_hotkey_axis: 'nul',
    input_hotkey_block_delay: '5',
    input_save_state_btn: XI.RB,
    input_save_state_axis: 'nul',
    input_load_state_btn: XI.LB,
    input_load_state_axis: 'nul',
    input_toggle_fast_forward_btn: 'nul',
    input_toggle_fast_forward_axis: '+5', // RT
    input_state_slot_increase_btn: 'h0right',
    input_state_slot_decrease_btn: 'h0left',
    input_screenshot_btn: XI.Y,
    input_menu_toggle_btn: XI.X,
    input_exit_emulator_btn: comboUsesBackStart ? 'nul' : XI.START,
    input_rewind_axis: ra.rewind ? '+4' : 'nul', // LT
    input_menu_toggle_gamepad_combo: comboUsesSticks ? '0' : '2', // L3+R3 as a no-modifier fallback
    input_quit_gamepad_combo: '0',
    menu_swap_ok_cancel_buttons: b(settings.ui.buttonLayout === 'nintendo'),

    // RetroAchievements
    cheevos_enable: b(cheevos.enabled && !!cheevos.username),
    cheevos_hardcore_mode_enable: b(cheevos.enabled && cheevos.hardcore),
    cheevos_richpresence_enable: 'true',
    cheevos_badges_enable: 'true',
    cheevos_unlock_sound_enable: 'true'
  }
  if (cheevos.enabled && cheevos.username) {
    cfg.cheevos_username = cfgValue(cheevos.username)
    if (cheevos.password) cfg.cheevos_password = cfgValue(cheevos.password)
  }
  return cfg
}

export function serializeCfg(cfg: Record<string, string>): string {
  const lines = ['# Managed by RetroDesk - regenerated on every launch. Edit retroarch.cfg for your own overrides.']
  for (const [k, v] of Object.entries(cfg)) lines.push(`${k} = "${cfgValue(v)}"`)
  return `${lines.join('\r\n')}\r\n`
}

/** Minimal parser for retroarch.cfg-style files (used by tests and for reading back values). */
export function parseCfg(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line)
    if (m && !line.trimStart().startsWith('#')) out[m[1]!] = m[2]!
  }
  return out
}

/** Write <retroarch>/retrodesk.cfg from current settings. Returns the cfg path and the shader to apply. */
export async function writeAppendConfig(settings: Settings, paths: RaConfigInput['paths'], uiMode = false): Promise<{ cfgPath: string; shaderPath?: string }> {
  const dir = raDir(paths)
  const shaderPath = resolveShaderPreset(dir, settings.retroarch.shader)
  if (settings.retroarch.shader !== 'none' && !shaderPath) console.warn(`[retroarch] no preset found for shader "${settings.retroarch.shader}", running without`)
  const cfgPath = uiMode ? join(dir, 'retrodesk-ui.cfg') : raAppendCfgPath(paths)
  await mkdir(join(dir, 'logs'), { recursive: true })
  await writeFile(cfgPath, serializeCfg(buildRetroArchConfig({ settings, paths, shaderPath, uiMode })))
  return { cfgPath, shaderPath }
}

export function buildRetroArchArgs(o: { coreDll?: string; rom?: string; appendCfg: string; shaderPath?: string }): string[] {
  const args: string[] = []
  if (o.coreDll) args.push('-L', o.coreDll)
  args.push('--appendconfig', o.appendCfg)
  if (o.shaderPath) args.push('--set-shader', o.shaderPath)
  if (o.rom) args.push(o.rom)
  return args
}

/** Core basenames present in <retroarch>/cores (installed via RetroDesk or RetroArch's own updater). */
export async function listInstalledCoreFiles(paths: Pick<RaPaths, 'emulators'>): Promise<Set<string>> {
  try {
    const files = await readdir(raCoresDir(paths))
    return new Set(files.filter((f) => f.toLowerCase().endsWith('.dll')).map((f) => f.slice(0, -4).toLowerCase()))
  } catch {
    return new Set()
  }
}
