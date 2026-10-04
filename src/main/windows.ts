import { app, BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'
import { sendEvent } from './events'
import { getSettings } from './settings'

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let overlayActive = false
const overlayListeners = new Set<(active: boolean) => void>()

/** The windows only ever show the bundled UI: no navigating away, no new windows; http(s) links open in the browser. */
function lockDown(win: BrowserWindow): void {
  win.webContents.on('will-navigate', (e, url) => {
    if (url.split('#')[0] !== win.webContents.getURL().split('#')[0]) e.preventDefault()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
}

function loadRenderer(win: BrowserWindow, hash = ''): void {
  // The dev-server override is for `electron-vite dev` only; an installed build always loads its own files.
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}${hash ? `#${hash}` : ''}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  }
}

const preload = () => join(__dirname, '../preload/index.js')

export function createMainWindow(): BrowserWindow {
  const s = getSettings()
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b0b12',
    title: 'RetroDesk',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#c9c9d6', height: 36 },
    fullscreen: s.ui.startFullscreen,
    webPreferences: { preload: preload(), backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  lockDown(mainWindow)
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  loadRenderer(mainWindow)
  return mainWindow
}

export const getMainWindow = (): BrowserWindow | null => mainWindow

/** Bring the frontend back to the foreground, e.g. after a game exits. */
export function focusMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/**
 * The overlay is a transparent, always-on-top, click-through window covering the display while a game runs.
 * Its renderer (route #/overlay) polls gamepads for the quick-menu combo and renders the quick menu.
 */
export function showOverlay(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    overlayWindow = new BrowserWindow({
      ...display.bounds,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      show: false,
      alwaysOnTop: true,
      webPreferences: { preload: preload(), backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }
    })
    overlayWindow.setAlwaysOnTop(true, 'screen-saver')
    overlayWindow.setIgnoreMouseEvents(true)
    lockDown(overlayWindow)
    overlayWindow.on('closed', () => {
      overlayWindow = null
    })
    loadRenderer(overlayWindow, '/overlay')
    overlayWindow.once('ready-to-show', () => overlayWindow?.showInactive())
  } else {
    overlayWindow.showInactive()
  }
}

export function hideOverlay(): void {
  setOverlayActive(false)
  overlayWindow?.hide()
}

export function destroyOverlay(): void {
  overlayActive = false
  overlayWindow?.destroy()
  overlayWindow = null
}

export function setOverlayActive(active: boolean): void {
  const win = overlayWindow
  if (!win || win.isDestroyed()) return
  if (active === overlayActive) {
    if (active) win.focus()
    return
  }
  overlayActive = active
  if (active) {
    win.setIgnoreMouseEvents(false)
    win.setFocusable(true)
    win.showInactive()
    win.setAlwaysOnTop(true, 'screen-saver')
    win.focus()
  } else {
    win.setIgnoreMouseEvents(true)
    win.setFocusable(false)
    win.blur()
  }
  sendEvent(win, 'overlay', active)
  for (const l of overlayListeners) l(active)
}

export const isOverlayActive = (): boolean => overlayActive

/** Launcher subscribes to pause/resume RetroArch and restore emulator focus. */
export function onOverlayActiveChanged(cb: (active: boolean) => void): () => void {
  overlayListeners.add(cb)
  return () => overlayListeners.delete(cb)
}
