import type {
  BiosStatus,
  EmulatorStatus,
  Game,
  GameQuery,
  LaunchResult,
  PerformanceMode,
  QuickAction,
  ScanResult,
  SessionInfo,
  Settings,
  SystemStats,
  SystemSummary,
  TaskProgress
} from './types'

/**
 * The API exposed to the renderer as `window.retrodesk` (see src/preload/index.ts).
 * Every request method maps 1:1 to an ipcMain.handle channel named `<namespace>:<method>`
 * (e.g. `library:getGames`). Events are pushed from main on channel `event:<name>`.
 */
export interface RetroDeskApi {
  library: {
    getSystems(): Promise<SystemSummary[]>
    getGames(query?: GameQuery): Promise<Game[]>
    getGame(id: string): Promise<Game | null>
    getRecent(limit?: number): Promise<Game[]>
    /** Rescan all ROM folders (+ Steam). Progress reported via onTask. */
    scan(): Promise<ScanResult>
    setFavorite(id: string, favorite: boolean): Promise<Game>
    setHidden(id: string, hidden: boolean): Promise<Game>
    setEmulatorOverride(id: string, emulator: string | null): Promise<Game>
    /** Download artwork for the given games, or all games missing artwork. Progress via onTask. */
    fetchArtwork(gameIds?: string[]): Promise<void>
    /** Import ROM files (e.g. from drag and drop / file picker): copies into <dataRoot>/roms/<system>/ and rescans. */
    importFiles(paths: string[]): Promise<ScanResult>
  }
  emulators: {
    list(): Promise<EmulatorStatus[]>
    /** id: 'retroarch' | 'core:<core_basename>' | standalone id. Progress via onTask. */
    install(id: string): Promise<EmulatorStatus>
    uninstall(id: string): Promise<void>
    /** Install everything needed to play the given system (RetroArch + default core, or standalone). */
    installForSystem(systemId: string): Promise<void>
    /** Open the emulator's own UI/settings (e.g. RetroArch menu, Dolphin GUI). */
    openEmulatorUi(id: string): Promise<void>
  }
  bios: {
    check(): Promise<BiosStatus[]>
    /** Copy user-picked files into the BIOS dir (validates md5 where known). */
    importFiles(paths: string[]): Promise<BiosStatus[]>
  }
  game: {
    launch(gameId: string): Promise<LaunchResult>
    getSession(): Promise<SessionInfo | null>
    quickAction(action: QuickAction): Promise<void>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: DeepPartial<Settings>): Promise<Settings>
  }
  system: {
    getStats(): Promise<SystemStats>
    setPerformanceMode(mode: PerformanceMode): Promise<void>
    /** Native folder picker. Returns null on cancel. */
    pickFolder(title?: string): Promise<string | null>
    /** Native file picker. */
    pickFiles(opts?: { title?: string; extensions?: string[] }): Promise<string[]>
    openPath(path: string): Promise<void>
    openExternal(url: string): Promise<void>
    getPaths(): Promise<{ dataRoot: string; roms: string; bios: string; saves: string; states: string; screenshots: string; emulators: string; media: string }>
    getVersion(): Promise<string>
  }
  window: {
    toggleFullscreen(): Promise<boolean>
    isFullscreen(): Promise<boolean>
    minimize(): Promise<void>
    quit(): Promise<void>
    /**
     * Overlay window only. The overlay window stays shown, transparent and click-through while a game runs
     * (so it can keep polling gamepads for the quick-menu combo). active=true makes it interactive + focused
     * and pauses RetroArch; active=false makes it click-through again and returns focus to the game.
     */
    setOverlayActive(active: boolean): Promise<void>
  }
  /** Event subscriptions. Each returns an unsubscribe function. */
  on: { [K in EventName]: (cb: (payload: ApiEvents[K]) => void) => () => void }
}

/** Events pushed from main -> renderer, and the payload each carries. The single source for both ends. */
export interface ApiEvents {
  task: TaskProgress
  session: SessionInfo | null
  libraryChanged: void
  /** Overlay window: main asks the overlay to show (true) or hide (false). */
  overlay: boolean
  /** Settings changed (from any window). */
  settingsChanged: Settings
}

export type EventName = keyof ApiEvents

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] }

/** Fails to compile, naming the stragglers, when a list below leaves out part of the interface it mirrors. */
type AssertAllListed<Missing extends never> = Missing

/** Event names, used by preload to build `on` generically. */
export const EVENT_NAMES = ['task', 'session', 'libraryChanged', 'overlay', 'settingsChanged'] as const satisfies readonly EventName[]
export type AllEventsListed = AssertAllListed<Exclude<EventName, (typeof EVENT_NAMES)[number]>>

/** Channel an event is pushed on via webContents.send. */
export const eventChannel = (name: EventName): string => `event:${name}`

/** Request namespaces/methods, used by preload to build the API proxy generically. */
export const API_SHAPE = {
  library: ['getSystems', 'getGames', 'getGame', 'getRecent', 'scan', 'setFavorite', 'setHidden', 'setEmulatorOverride', 'fetchArtwork', 'importFiles'],
  emulators: ['list', 'install', 'uninstall', 'installForSystem', 'openEmulatorUi'],
  bios: ['check', 'importFiles'],
  game: ['launch', 'getSession', 'quickAction'],
  settings: ['get', 'set'],
  system: ['getStats', 'setPerformanceMode', 'pickFolder', 'pickFiles', 'openPath', 'openExternal', 'getPaths', 'getVersion'],
  window: ['toggleFullscreen', 'isFullscreen', 'minimize', 'quit', 'setOverlayActive']
} as const satisfies { [K in Exclude<keyof RetroDeskApi, 'on'>]: readonly (keyof RetroDeskApi[K])[] }

export type ApiNamespace = keyof typeof API_SHAPE
export type AllMethodsListed = AssertAllListed<{ [K in ApiNamespace]: Exclude<keyof RetroDeskApi[K], (typeof API_SHAPE)[K][number]> }[ApiNamespace]>
