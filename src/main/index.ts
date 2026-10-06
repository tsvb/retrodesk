import { app, dialog, ipcMain, net, protocol, shell, BrowserWindow } from 'electron'
import { stat } from 'fs/promises'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { API_SHAPE, type RetroDeskApi } from '../shared/api'
import { MEDIA_SCHEME, pathFromMediaUrl } from '../shared/media'
import { defaultSettings, getSettings, portableDataDir, updateSettings } from './settings'
import { getPaths, isManagedPath } from './paths'
import { createMainWindow, focusMainWindow, getMainWindow, setOverlayActive, setOverlayHold } from './windows'
import { initLibrary, libraryHandlers, biosHandlers } from './library'
import { ThumbCache, thumbWidth } from './library/thumbs'
import { initEmulators, emulatorsHandlers } from './emulators'
import { initLaunch, gameHandlers } from './launch'
import { getStats, setPerformanceMode } from './system'
import { getNativeGamepads, initNativeGamepads, rumbleNativeGamepads } from './gamepads'

// Keep the frontend + overlay "visible" to Chromium while a fullscreen emulator covers them,
// otherwise Windows (or macOS) occlusion tracking hides the page and gamepad polling / timers stop.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,MacWebContentsOcclusion')
app.commandLine.appendSwitch('disable-background-timer-throttling')
if (process.platform === 'win32') app.setAppUserModelId('com.retrodesk.app')
// Where app state (settings, library DB) lives: RETRODESK_USER_DATA is the test hook; the portable build keeps
// it next to the exe so nothing is left behind in %APPDATA%.
const portableData = portableDataDir()
if (process.env['RETRODESK_USER_DATA']) app.setPath('userData', process.env['RETRODESK_USER_DATA'])
else if (portableData) app.setPath('userData', join(portableData, 'app'))

process.on('unhandledRejection', (reason) => console.error('[main] unhandled rejection', reason))

protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])

const systemHandlers: RetroDeskApi['system'] = {
  getStats,
  setPerformanceMode,
  async pickFolder(title) {
    const win = BrowserWindow.getFocusedWindow() ?? getMainWindow()
    const opts: Electron.OpenDialogOptions = { title: title ?? 'Choose folder', properties: ['openDirectory', 'createDirectory'] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
  },
  async pickFiles(o) {
    const win = BrowserWindow.getFocusedWindow() ?? getMainWindow()
    const opts: Electron.OpenDialogOptions = {
      title: o?.title ?? 'Choose files',
      properties: ['openFile', 'multiSelections'],
      filters: o?.extensions?.length ? [{ name: 'Files', extensions: o.extensions.map((e) => e.replace(/^\./, '')) }] : undefined
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? [] : r.filePaths
  },
  async openPath(p) {
    // The UI only opens folders RetroDesk manages. Never hand the shell an arbitrary path (it would run an .exe or .app).
    if (!isManagedPath(p)) return
    const st = await stat(p).catch(() => null)
    if (st?.isDirectory()) await shell.openPath(p)
  },
  async openExternal(url) {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url)
  },
  async getPaths() {
    const { downloads: _d, ...rest } = getPaths()
    return rest
  },
  async getVersion() {
    return app.getVersion()
  },
  async getGamepads() {
    return getNativeGamepads()
  },
  async rumbleGamepads(light, heavy, durationMs) {
    rumbleNativeGamepads(light, heavy, durationMs)
  }
}

const windowHandlers: RetroDeskApi['window'] = {
  async toggleFullscreen() {
    const w = getMainWindow()
    if (!w) return false
    w.setFullScreen(!w.isFullScreen())
    return w.isFullScreen()
  },
  async isFullscreen() {
    return getMainWindow()?.isFullScreen() ?? false
  },
  async minimize() {
    getMainWindow()?.minimize()
  },
  async quit() {
    app.quit()
  },
  async setOverlayActive(active) {
    setOverlayActive(active)
  },
  async setOverlayHold(hold) {
    setOverlayHold(hold)
  }
}

const settingsHandlers: RetroDeskApi['settings'] = {
  async get() {
    return getSettings()
  },
  async set(patch) {
    return updateSettings(patch)
  }
}

const handlers: Omit<RetroDeskApi, 'on'> = {
  library: libraryHandlers,
  emulators: emulatorsHandlers,
  bios: biosHandlers,
  game: gameHandlers,
  settings: settingsHandlers,
  system: systemHandlers,
  window: windowHandlers
}

/**
 * Settled once the library, emulators and launcher are initialized. The window opens before that, so handlers
 * that need them wait for it; settings, system and window requests are answered straight away.
 */
let markReady: () => void = () => undefined
let markFailed: (e: unknown) => void = () => undefined
const ready = new Promise<void>((resolve, reject) => {
  markReady = resolve
  markFailed = reject
})
ready.catch(() => undefined) // startup failure is reported (and the app quits) below
const NEEDS_INIT: ReadonlySet<string> = new Set<keyof typeof handlers>(['library', 'emulators', 'bios', 'game'])

function registerIpc(): void {
  for (const [ns, methods] of Object.entries(API_SHAPE)) {
    const group = handlers[ns as keyof typeof handlers] as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>
    const gated = NEEDS_INIT.has(ns)
    for (const m of methods) {
      const fn = group[m]
      if (typeof fn !== 'function') throw new Error(`IPC handler missing: ${ns}:${m}`)
      ipcMain.handle(`${ns}:${m}`, async (_e, ...args) => {
        try {
          if (gated) await ready
          return await fn.apply(group, args)
        } catch (err) {
          console.error(`[ipc] ${ns}:${m} failed`, err)
          throw err
        }
      })
    }
  }
}

function registerMediaProtocol(): void {
  // Grid covers ask for ?w=<px> and get a cached downscaled copy.
  const thumbs = new ThumbCache(() => join(getPaths().media, '.thumbs'))
  protocol.handle(MEDIA_SCHEME, async (req) => {
    const p = pathFromMediaUrl(req.url)
    if (!isManagedPath(p)) return new Response('Forbidden', { status: 403 })
    try {
      const w = thumbWidth(req.url)
      return await net.fetch(pathToFileURL(w ? await thumbs.file(p, w) : p).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

/**
 * Create the data folders. The data root may be on a drive that is not connected right now, so ask instead of
 * failing with no window. Returns false when the user chooses to quit.
 */
function ensureDataRoot(): boolean {
  for (;;) {
    try {
      getPaths()
      return true
    } catch (e) {
      const choice = dialog.showMessageBoxSync({
        type: 'error',
        title: 'RetroDesk',
        message: 'The RetroDesk data folder is not available.',
        detail: `${getSettings().dataRoot}\n\n${e instanceof Error ? e.message : String(e)}`,
        buttons: ['Try again', 'Use the default folder', 'Quit'],
        defaultId: 0,
        cancelId: 2,
        noLink: true
      })
      if (choice === 2) return false
      if (choice === 1) updateSettings({ dataRoot: defaultSettings().dataRoot })
    }
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => focusMainWindow())
  // macOS: clicking the Dock icon.
  app.on('activate', () => focusMainWindow())

  app
    .whenReady()
    .then(async () => {
      if (!ensureDataRoot()) return app.quit()
      registerMediaProtocol()
      registerIpc()
      initNativeGamepads()
      // Open the window first so it paints (and loads settings) while the library loads.
      createMainWindow()
      try {
        await initLibrary()
        await initEmulators()
        initLaunch()
        markReady()
      } catch (e) {
        markFailed(e)
        throw e
      }
    })
    .catch((err: unknown) => {
      // Without this the process would sit there with no window, holding the single-instance lock.
      console.error('[main] startup failed', err)
      dialog.showErrorBox('RetroDesk could not start', err instanceof Error ? err.message : String(err))
      app.exit(1)
    })

  app.on('window-all-closed', () => app.quit())
}
