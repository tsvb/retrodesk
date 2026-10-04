import { app, dialog, ipcMain, net, protocol, shell, BrowserWindow } from 'electron'
import { isAbsolute, resolve } from 'path'
import { pathToFileURL } from 'url'
import { API_SHAPE, type RetroDeskApi } from '../shared/api'
import { MEDIA_SCHEME, pathFromMediaUrl } from '../shared/media'
import { getSettings, updateSettings } from './settings'
import { getPaths } from './paths'
import { createMainWindow, focusMainWindow, getMainWindow, setOverlayActive } from './windows'
import { initLibrary, libraryHandlers, biosHandlers } from './library'
import { initEmulators, emulatorsHandlers } from './emulators'
import { initLaunch, gameHandlers } from './launch'
import { getStats, setPerformanceMode } from './system'

// Keep the frontend + overlay "visible" to Chromium while a fullscreen emulator covers them,
// otherwise Windows occlusion tracking hides the page and gamepad polling / timers stop.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.setAppUserModelId('com.retrodesk.app')
// Test/portable hook: isolate all app state (settings, library DB) in a given folder.
if (process.env['RETRODESK_USER_DATA']) app.setPath('userData', process.env['RETRODESK_USER_DATA'])

protocol.registerSchemesAsPrivileged([
  { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

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
    await shell.openPath(p)
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

function registerIpc(): void {
  for (const [ns, methods] of Object.entries(API_SHAPE)) {
    const group = handlers[ns as keyof typeof handlers] as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>
    for (const m of methods) {
      const fn = group[m]
      if (typeof fn !== 'function') throw new Error(`IPC handler missing: ${ns}:${m}`)
      ipcMain.handle(`${ns}:${m}`, async (_e, ...args) => {
        try {
          return await fn.apply(group, args)
        } catch (err) {
          console.error(`[ipc] ${ns}:${m} failed`, err)
          throw err
        }
      })
    }
  }
}

/** Only serve files from the data root or configured ROM folders. */
function isAllowedMediaPath(p: string): boolean {
  if (!isAbsolute(p)) return false
  const full = resolve(p).toLowerCase()
  const s = getSettings()
  const roots = [s.dataRoot, ...s.romFolders.map((f) => f.path)].map((r) => resolve(r).toLowerCase())
  return roots.some((r) => full === r || full.startsWith(r.endsWith('\\') ? r : `${r}\\`))
}

function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (req) => {
    const p = pathFromMediaUrl(req.url)
    if (!isAllowedMediaPath(p)) return new Response('Forbidden', { status: 403 })
    try {
      return await net.fetch(pathToFileURL(p).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => focusMainWindow())

  app.whenReady().then(async () => {
    getPaths()
    registerMediaProtocol()
    registerIpc()
    await initLibrary()
    await initEmulators()
    initLaunch()
    createMainWindow()
  })

  app.on('window-all-closed', () => app.quit())
}
