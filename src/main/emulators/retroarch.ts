// RetroArch: portable install, nightly core install, managed append-config generation and launch args.
// Windows gets the portable 7z build; macOS the universal app bundle (RetroArch.app inside <emulators>/retroarch),
// started with --config so it keeps its settings next to it like the portable build does.
import { existsSync } from 'fs'
import { mkdir, readdir, rename, rm, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { prettifyCore } from '../../shared/emulators'
import { padFamily, resolveButtonLayout } from '../../shared/pads'
import { hotkeyBindings, padBinding, type PadDriver } from '../../shared/quickActions'
import { retroArchCfgFromSettings, settingOptions } from '../../shared/settingsSchema'
import type { Settings } from '../../shared/types'
import { hostOs, type HostOs } from '../platform'
import { coreLibExt, coreUrl, downloadTrusted, fetchText, HttpError, fileSize, lastModifiedToVersion, releaseCacheDir, retroArchLatestStable, retroArchUrl } from './download'
import { extractArchive, findFile, moveMerge, singleTopFolder } from './extract'
import { createLimiter } from './limit'

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
/** The macOS app bundle. */
export const raApp = (p: Pick<RaPaths, 'emulators'>): string => join(raDir(p), 'RetroArch.app')
export const raExe = (p: Pick<RaPaths, 'emulators'>, os: HostOs = hostOs()): string => (os === 'macos' ? join(raApp(p), 'Contents', 'MacOS', 'RetroArch') : join(raDir(p), 'retroarch.exe'))
export const raCoresDir = (p: Pick<RaPaths, 'emulators'>): string => join(raDir(p), 'cores')
export const raAppendCfgPath = (p: Pick<RaPaths, 'emulators'>): string => join(raDir(p), 'retrodesk.cfg')
/** RetroArch's own config. The portable Windows build finds it next to the exe; on macOS it is passed with --config. */
export const raMainCfgPath = (p: Pick<RaPaths, 'emulators'>): string => join(raDir(p), 'retroarch.cfg')

/** systems.json may say "snes9x_libretro" or "snes9x"; files are always "<x>_libretro.dll" (".dylib" on macOS). */
export function coreFileBase(core: string): string {
  const c = core.replace(/\.(dll|dylib)$/i, '')
  return c.endsWith('_libretro') ? c : `${c}_libretro`
}

export const coreLibPath = (p: Pick<RaPaths, 'emulators'>, core: string, os: HostOs = hostOs()): string => join(raCoresDir(p), `${coreFileBase(core)}${coreLibExt(os)}`)

/** RetroArch's joypad driver: XInput on Windows, the GameController framework on macOS. */
export const padDriver = (os: HostOs = hostOs()): PadDriver => (os === 'macos' ? 'mfi' : 'xinput')

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
  return CORE_NAMES[base] ?? prettifyCore(base)
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

/** onQueued callbacks for downloadTrusted / extractArchive: say why nothing is happening yet. */
export const waitingFor = (task: ProgressSink | undefined, what: 'download' | 'extract') => (): void =>
  task?.update(-1, what === 'download' ? 'Waiting for other downloads' : 'Waiting for other installs')

/**
 * RetroArch and its cores download and extract side by side; only their moves into <retroarch> take turns, so a
 * core landing in cores/ can't race RetroArch's merge of the same folders.
 */
const raDirLock = createLimiter(1)

/** Install (or update) portable RetroArch into <emulators>/retroarch, preserving cores/ and user config. */
export async function installRetroArch(paths: RaPaths, task: ProgressSink, signal?: AbortSignal): Promise<{ version: string; exePath: string }> {
  task.update(-1, 'Finding latest RetroArch')
  const version = await retroArchLatestStable(signal, releaseCacheDir(paths.downloads))
  const archive = join(paths.downloads, `RetroArch-${version}${hostOs() === 'macos' ? '.dmg' : '.7z'}`)
  await downloadTrusted(retroArchUrl(version), archive, {
    signal,
    onQueued: waitingFor(task, 'download'),
    onProgress: (r, t) => task.update(t ? (r / t) * 0.8 : -1, downloadDetail(r, t))
  })
  const staging = join(paths.emulators, `.staging-retroarch-${Date.now()}`)
  try {
    task.update(0.8, 'Extracting')
    await extractArchive(archive, staging, {
      signal,
      onQueued: waitingFor(task, 'extract'),
      onProgress: (f) => task.update(0.8 + f * 0.18, `Extracting ${Math.round(f * 100)}%`)
    })
    const root = await singleTopFolder(staging)
    task.update(0.98, 'Installing')
    await raDirLock(async () => {
      await moveMerge(root, raDir(paths))
      await mkdir(raCoresDir(paths), { recursive: true })
    })
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    await rm(archive, { force: true }).catch(() => undefined)
  }
  const exePath = raExe(paths)
  if (!existsSync(exePath)) throw new Error(`${hostOs() === 'macos' ? 'RetroArch.app' : 'retroarch.exe'} not found after extraction`)
  return { version, exePath }
}

/** Install a libretro core from the nightly buildbot into <retroarch>/cores (+ its .info file and system assets). */
export async function installCore(core: string, paths: RaPaths, task: ProgressSink, signal?: AbortSignal): Promise<{ version: string; exePath: string; sizeBytes: number }> {
  const base = coreFileBase(core)
  const lib = `${base}${coreLibExt()}`
  const zip = join(paths.downloads, `${lib}.zip`)
  task.update(-1, `Downloading ${base}`)
  // Core info file (display name, system id for GET_STATUS, firmware list), fetched alongside the core. Best effort.
  const infoDir = join(raDir(paths), 'info')
  const infoFile = join(infoDir, `${base}.info`)
  const info = existsSync(infoFile)
    ? Promise.resolve(undefined)
    : fetchText(`https://raw.githubusercontent.com/libretro/libretro-core-info/master/${base}.info`, { signal, retries: 2 }).catch((e: unknown) => {
        console.warn(`[retroarch] no core info for ${base}`, e)
        return undefined
      })
  const dl = await downloadTrusted(coreUrl(base), zip, {
    signal,
    onQueued: waitingFor(task, 'download'),
    onProgress: (r, t) => task.update(t ? (r / t) * 0.85 : -1, downloadDetail(r, t))
  }).catch((e: unknown) => {
    // The macOS buildbot does not build every core for both architectures.
    if (e instanceof HttpError && e.status === 404 && hostOs() === 'macos') throw new Error(`${coreDisplayName(base)} is not available for this Mac (${process.arch}) yet.`)
    throw e
  })
  const staging = join(paths.emulators, `.staging-${base}-${Date.now()}`)
  const dest = coreLibPath(paths, base)
  try {
    task.update(0.88, 'Extracting')
    await extractArchive(zip, staging, { signal, onQueued: waitingFor(task, 'extract') })
    const dll = await findFile(staging, lib, 2)
    if (!dll) throw new Error(`${lib} not found in core archive`)
    await raDirLock(async () => {
      await mkdir(raCoresDir(paths), { recursive: true })
      await rm(dest, { force: true })
      await rename(dll, dest)
    })
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    await rm(zip, { force: true }).catch(() => undefined)
  }
  const infoText = await info
  if (infoText !== undefined) {
    await raDirLock(async () => {
      await mkdir(infoDir, { recursive: true })
      await writeFile(infoFile, infoText)
    }).catch((e: unknown) => console.warn(`[retroarch] could not write core info for ${base}`, e))
  }
  await ensureCoreSystemAssets(base, paths, task, signal)
  // Last-Modified doubles as the "version" for nightly cores.
  return { version: lastModifiedToVersion(dl.lastModified) ?? new Date().toISOString().slice(0, 10), exePath: dest, sizeBytes: await fileSize(dest) }
}

/** Download + extract asset packs (PPSSPP.zip, blueMSX.zip) into the BIOS/system dir if missing. */
export async function ensureCoreSystemAssets(core: string, paths: Pick<RaPaths, 'bios' | 'downloads'>, task?: ProgressSink, signal?: AbortSignal): Promise<void> {
  const asset = CORE_SYSTEM_ASSETS[coreFileBase(core)]
  if (!asset || existsSync(join(paths.bios, asset.marker))) return
  const name = asset.url.split('/').pop()!
  const zip = join(paths.downloads, name)
  task?.update(-1, `Downloading ${name}`)
  try {
    await downloadTrusted(asset.url, zip, { signal, onQueued: waitingFor(task, 'download'), onProgress: (r, t) => task?.update(t ? r / t : -1, downloadDetail(r, t)) })
    task?.update(-1, `Extracting ${name}`)
    await extractArchive(zip, paths.bios, { signal, onQueued: waitingFor(task, 'extract') })
  } finally {
    await rm(zip, { force: true }).catch(() => undefined)
  }
}

// ---------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------

/** First preset for `shader` found in any of `dirs` (the RetroArch dir first). */
export function resolveShaderPreset(dirs: string | string[], shader: Settings['retroarch']['shader'], exists: (p: string) => boolean = existsSync): string | undefined {
  if (shader === 'none') return undefined
  // Candidates are declared with the shader setting's options, best first.
  for (const rel of settingOptions('retroarch.shader').find((o) => o.value === shader)?.presets ?? []) {
    for (const dir of typeof dirs === 'string' ? [dirs] : dirs) {
      const p = join(dir, ...rel.split('/'))
      if (exists(p)) return p
    }
  }
  return undefined
}

/**
 * Where shader presets may be. On macOS, RetroArch keeps them in its app bundle's resources or, once its online
 * updater has fetched them, in its Application Support folder.
 */
export function shaderDirs(p: Pick<RaPaths, 'emulators'>, os: HostOs = hostOs()): string[] {
  if (os !== 'macos') return [raDir(p)]
  return [raDir(p), join(raApp(p), 'Contents', 'Resources'), join(homedir(), 'Library', 'Application Support', 'RetroArch')]
}

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
  /** Defaults to the host. */
  os?: HostOs
  /** Name of the controller in use, if known: resolves the "Automatic" button layout. */
  padName?: string
}

/** Build the RetroDesk-managed append config. Pure (no I/O) so it can be unit tested. */
export function buildRetroArchConfig({ settings, paths, shaderPath, uiMode, os = hostOs(), padName }: RaConfigInput): Record<string, string> {
  const ra = settings.retroarch
  const driver = padDriver(os)
  const rewind = padBinding(driver, 'LT')
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

    // Everything the In-game settings map to directly (video driver, aspect, scaling, FPS, quick resume, run-ahead).
    ...retroArchCfgFromSettings(settings, os),

    // Video: borderless fullscreen so the always-on-top overlay can draw over the game.
    video_fullscreen: 'true',
    video_windowed_fullscreen: 'true',
    video_vsync: 'true',
    video_shader_enable: b(!!shaderPath),
    video_gpu_screenshot: 'true',

    // Save states / quick resume
    savestate_auto_index: 'false',
    savestate_thumbnail_enable: 'true',
    state_slot: '0',

    // Latency / rewind
    run_ahead_frames: '1',
    run_ahead_secondary_instance: 'true',
    rewind_enable: b(ra.rewind && !(cheevos.enabled && cheevos.hardcore)),

    // Controller hotkeys (Retroid style: hold Select + button). XInput (Windows) and mFi (macOS) give stable indices.
    input_joypad_driver: driver,
    input_autodetect_enable: 'true',
    input_enable_hotkey: 'nul', // keyboard hotkeys (F1/F2/F4/Esc...) work without a modifier
    input_enable_hotkey_btn: padBinding(driver, 'BACK').btn,
    input_enable_hotkey_axis: 'nul',
    input_hotkey_block_delay: '5',
    ...hotkeyBindings(driver),
    input_exit_emulator_btn: comboUsesBackStart ? 'nul' : padBinding(driver, 'START').btn,
    input_rewind_btn: ra.rewind ? rewind.btn : 'nul',
    input_rewind_axis: ra.rewind ? rewind.axis : 'nul',
    input_menu_toggle_gamepad_combo: comboUsesSticks ? '0' : '2', // L3+R3 as a no-modifier fallback
    input_quit_gamepad_combo: '0',
    menu_swap_ok_cancel_buttons: b(resolveButtonLayout(settings.ui.buttonLayout, padName ? padFamily(padName) : undefined) === 'nintendo'),

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
export async function writeAppendConfig(settings: Settings, paths: RaConfigInput['paths'], uiMode = false, padName?: string): Promise<{ cfgPath: string; shaderPath?: string; mainCfg?: string }> {
  const dir = raDir(paths)
  const shaderPath = resolveShaderPreset(shaderDirs(paths), settings.retroarch.shader)
  if (settings.retroarch.shader !== 'none' && !shaderPath) console.warn(`[retroarch] no preset found for shader "${settings.retroarch.shader}", running without`)
  const cfgPath = uiMode ? join(dir, 'retrodesk-ui.cfg') : raAppendCfgPath(paths)
  await mkdir(join(dir, 'logs'), { recursive: true })
  await writeFile(cfgPath, serializeCfg(buildRetroArchConfig({ settings, paths, shaderPath, uiMode, padName })))
  if (hostOs() !== 'macos') return { cfgPath, shaderPath }
  // Its own config next to it, not the one in ~/Library a separately installed RetroArch uses.
  const mainCfg = raMainCfgPath(paths)
  if (!existsSync(mainCfg)) await writeFile(mainCfg, '', { flag: 'wx' }).catch(() => undefined)
  return { cfgPath, shaderPath, mainCfg }
}

export function buildRetroArchArgs(o: { coreDll?: string; rom?: string; appendCfg: string; shaderPath?: string; mainCfg?: string }): string[] {
  const args: string[] = []
  if (o.mainCfg) args.push('--config', o.mainCfg)
  if (o.coreDll) args.push('-L', o.coreDll)
  args.push('--appendconfig', o.appendCfg)
  if (o.shaderPath) args.push('--set-shader', o.shaderPath)
  if (o.rom) args.push(o.rom)
  return args
}

/** Core basenames among the files of a cores folder (only libraries this OS can load). */
export function coreBasenames(files: string[], os: HostOs = hostOs()): Set<string> {
  const ext = coreLibExt(os)
  return new Set(files.filter((f) => f.toLowerCase().endsWith(ext)).map((f) => f.slice(0, -ext.length).toLowerCase()))
}

/** Core basenames present in <retroarch>/cores (installed via RetroDesk or RetroArch's own updater). */
export async function listInstalledCoreFiles(paths: Pick<RaPaths, 'emulators'>): Promise<Set<string>> {
  try {
    return coreBasenames(await readdir(raCoresDir(paths)))
  } catch {
    return new Set()
  }
}
