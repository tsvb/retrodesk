// Shared data contract between the main process and the renderer.
// Everything that crosses the IPC boundary is defined here and must stay JSON-serialisable.

import type { SettingValue } from './settingsSchema'

export type SystemId = string

export type EmulatorRef =
  | { type: 'retroarch'; core: string; default?: boolean }
  | { type: 'standalone'; id: string; default?: boolean }

export interface BiosDef {
  file: string
  md5: string
  required: boolean
  description: string
}

export interface SystemDef {
  id: SystemId
  name: string
  shortName?: string
  manufacturer: string
  year: number
  generation?: number
  /** Lower-case, with leading dot. */
  extensions: string[]
  /** libretro-thumbnails folder name, e.g. "Nintendo - Super Nintendo Entertainment System". */
  thumbnailsFolder?: string
  emulators: EmulatorRef[]
  bios: BiosDef[]
  /** Folder names (lower-case) that should be recognised as this system when scanning, e.g. ["snes", "sfc", "super nintendo"]. */
  folderAliases?: string[]
  /** Accent colour used by the UI (hex). */
  color?: string
}

/** A system plus live library information. */
export interface SystemSummary extends SystemDef {
  gameCount: number
  /** True if at least one emulator for this system is installed. */
  playable: boolean
}

export type MediaKind = 'boxart' | 'snap' | 'title'

export interface Game {
  /** Stable id: sha1 of the normalised absolute path, first 16 hex chars. */
  id: string
  systemId: SystemId
  /** Absolute path of the ROM (or .cue/.m3u/.chd entry point). */
  path: string
  fileName: string
  /** Cleaned display title, e.g. "Super Mario World". */
  title: string
  /** Name without extension, untouched (used for thumbnail matching). */
  rawName: string
  /** Parsed from No-Intro / Redump tags, e.g. ["USA"], ["Europe","Japan"]. */
  regions: string[]
  /** Remaining tags e.g. ["Rev 1"], ["Proto"]. */
  tags: string[]
  sizeBytes: number
  addedAt: number
  lastPlayedAt?: number
  playTimeSec: number
  playCount: number
  favorite: boolean
  hidden: boolean
  /** Absolute file paths of downloaded/local media. Served to the renderer via the `rdmedia://` protocol. */
  media: Partial<Record<MediaKind, string>>
  /** Emulator id override for this game: `retroarch:<core>` or `standalone:<id>`. */
  emulatorOverride?: string
}

export type SortKey = 'title' | 'lastPlayed' | 'playTime' | 'added' | 'system'

export interface GameQuery {
  systemId?: SystemId
  favoritesOnly?: boolean
  includeHidden?: boolean
  search?: string
  sort?: SortKey
  limit?: number
}

export interface RomFolder {
  path: string
  /** If set, every ROM under this folder belongs to this system. Otherwise sub-folder names are matched to systems. */
  systemId?: SystemId
}

export type PerformanceMode = SettingValue<'performance.inGameMode'>

/** Choices and switches are declared in settingsSchema.ts; their types, defaults and validation come from there. */
export interface Settings {
  /** First-run wizard completed. */
  onboarded: boolean
  /** Root data directory for emulators, saves, bios, media. Default: %USERPROFILE%\RetroDesk */
  dataRoot: string
  romFolders: RomFolder[]
  /** Per-system default emulator: `retroarch:<core>` or `standalone:<id>`. */
  systemEmulator: Record<SystemId, string>
  ui: {
    theme: SettingValue<'ui.theme'>
    accent: string
    /** Show the per-game cover grid as large tiles (10-foot) or compact. */
    density: SettingValue<'ui.density'>
    sounds: boolean
    /** Rumble the controller on UI feedback. */
    haptics: boolean
    startFullscreen: boolean
    /** Show only systems that have games. */
    hideEmptySystems: boolean
    /** Gamepad face-button layout: 'xbox' => A confirms (bottom), 'nintendo' => swap A/B. */
    buttonLayout: SettingValue<'ui.buttonLayout'>
  }
  retroarch: {
    shader: SettingValue<'retroarch.shader'>
    autoSaveState: boolean
    autoLoadState: boolean
    showFps: boolean
    runAhead: boolean
    rewind: boolean
    integerScale: boolean
    aspect: SettingValue<'retroarch.aspect'>
    videoDriver: SettingValue<'retroarch.videoDriver'>
  }
  retroAchievements: {
    enabled: boolean
    username: string
    /** Stored token or password (retroarch accepts either). */
    password: string
    hardcore: boolean
  }
  hotkeys: {
    /** Electron accelerator for the in-game quick menu. */
    quickMenu: string
    /** Gamepad combo (Gamepad API standard indices) held to open the quick menu. Default Back+Start = [8, 9]. */
    quickMenuCombo: number[]
  }
  performance: {
    /** Windows power plan to apply while a game is running. */
    inGameMode: PerformanceMode
  }
  scraping: {
    autoFetchArtwork: boolean
    preferredRegion: SettingValue<'scraping.preferredRegion'>
  }
}

export type EmulatorKind = 'retroarch' | 'core' | 'standalone'

export interface EmulatorStatus {
  /** 'retroarch', 'core:<core_basename>' or standalone id e.g. 'dolphin'. */
  id: string
  kind: EmulatorKind
  name: string
  /** Systems this emulator serves. */
  systems: SystemId[]
  installed: boolean
  version?: string
  installPath?: string
  sizeBytes?: number
}

export type TaskState = 'running' | 'done' | 'error' | 'cancelled'

/** Long-running background job (download, scan, scrape) reported to the UI. */
export interface TaskSubject {
  kind: 'emulator' | 'system' | 'scan' | 'artwork' | 'import' | 'bios'
  /** Emulator id (EmulatorStatus.id) or system id. */
  id?: string
}

export interface TaskProgress {
  id: string
  label: string
  subject?: TaskSubject
  /** 0..1, or -1 for indeterminate. */
  progress: number
  detail?: string
  state: TaskState
  error?: string
}

export interface BiosStatus {
  systemId: SystemId
  file: string
  description: string
  required: boolean
  present: boolean
  /** True when present and md5 matches (or md5 unknown). */
  valid: boolean
}

export interface SessionInfo {
  gameId: string
  title: string
  systemId: SystemId
  emulatorId: string
  /** True when the emulator is RetroArch, i.e. network commands (save state, etc.) are available. */
  supportsCommands: boolean
  startedAt: number
  pid?: number
  stateSlot: number
  /** RetroArch only. */
  fastForward?: boolean
  paused?: boolean
}

export type QuickAction =
  | 'resume'
  | 'save_state'
  | 'load_state'
  | 'slot_next'
  | 'slot_prev'
  | 'screenshot'
  | 'fast_forward'
  | 'pause_toggle'
  | 'reset'
  | 'retroarch_menu'
  | 'quit'

export interface SystemStats {
  cpuPercent: number
  memUsedBytes: number
  memTotalBytes: number
  gpu?: { name: string; utilPercent: number; tempC: number; memUsedMB: number; memTotalMB: number }
  /** Present on laptops. */
  battery?: { percent: number; charging: boolean }
  powerPlan?: string
}

export interface ScanResult {
  added: number
  removed: number
  total: number
  durationMs: number
}

export type LaunchResult = { ok: true; session: SessionInfo } | { ok: false; error: string; needs?: 'emulator' | 'bios'; emulatorId?: string }
