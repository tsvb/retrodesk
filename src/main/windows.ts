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

// While the quick menu is closed the overlay is parked: still shown, but shrunk and moved off every display.
// Hiding it would stop the gamepad polling (Chromium only gives gamepad data to visible pages, and with occlusion
// tracking disabled a shown off-screen window still counts as visible). Leaving it over the game would keep a
// layered window on top of a fullscreen emulator, which knocks the game out of independent flip (extra latency, no VRR).
/** Let the menu's fade-out finish before the window jumps away. */
const PARK_DELAY_MS = 300
/** Distance from the displays; Windows enforces a minimum window size of a few dozen pixels, so 1x1 isn't kept. */
const PARK_MARGIN = 200
/** The display the overlay opens on (picked when the session starts, like the game's). */
let overlayDisplayId: number | undefined
let parkTimer: NodeJS.Timeout | undefined
let displayListeners = false

/** Up and to the left of the union of all displays (which may have negative coordinates; the primary one is at 0,0). Never -32000 (minimized). */
function parkedBounds(): Electron.Rectangle {
  const displays = screen.getAllDisplays()
  const away = (v: number) => (v === -32000 ? v - PARK_MARGIN : v)
  return {
    x: away(Math.min(0, ...displays.map((d) => d.bounds.x)) - PARK_MARGIN),
    y: away(Math.min(0, ...displays.map((d) => d.bounds.y)) - PARK_MARGIN),
    width: 1,
    height: 1
  }
}

function overlayDisplayBounds(): Electron.Rectangle {
  const display = screen.getAllDisplays().find((d) => d.id === overlayDisplayId) ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  overlayDisplayId = display.id
  return display.bounds
}

/** setBounds, once more if the first try was resized on the way (moving between displays with different scaling). */
function moveOverlay(win: BrowserWindow, bounds: Electron.Rectangle): void {
  win.setBounds(bounds)
  const b = win.getBounds()
  if (Math.abs(b.x - bounds.x) > 2 || Math.abs(b.y - bounds.y) > 2 || (bounds.width > 1 && Math.abs(b.width - bounds.width) > 2)) win.setBounds(bounds)
}

function parkOverlay(win: BrowserWindow): void {
  clearTimeout(parkTimer)
  parkTimer = undefined
  if (!win.isDestroyed()) moveOverlay(win, parkedBounds())
}

/** Re-place the overlay when monitors are added, removed or rearranged. */
function followDisplayChanges(): void {
  if (displayListeners) return
  displayListeners = true
  const replace = () => {
    const win = overlayWindow
    if (!win || win.isDestroyed()) return
    if (overlayActive) moveOverlay(win, overlayDisplayBounds())
    else parkOverlay(win)
  }
  screen.on('display-added', replace)
  screen.on('display-removed', replace)
  screen.on('display-metrics-changed', replace)
}

/**
 * The overlay is a transparent, always-on-top, click-through window shown while a game runs. Its renderer
 * (route #/overlay) polls gamepads for the quick-menu combo and renders the quick menu; it only covers the
 * display while the menu is open and is parked off-screen otherwise (see above).
 */
export function showOverlay(): void {
  followDisplayChanges()
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    overlayDisplayId = display.id
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
    const win = overlayWindow
    win.on('closed', () => {
      if (overlayWindow === win) overlayWindow = null
    })
    loadRenderer(win, '/overlay')
    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return
      if (!overlayActive) parkOverlay(win)
      win.showInactive()
    })
  } else {
    if (!overlayActive) parkOverlay(overlayWindow)
    overlayWindow.showInactive()
  }
}

export function hideOverlay(): void {
  setOverlayActive(false)
  overlayWindow?.hide()
}

export function destroyOverlay(): void {
  overlayActive = false
  clearTimeout(parkTimer)
  parkTimer = undefined
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
    // Cover the display before the 'overlay' event goes out, so the menu opens at full size.
    clearTimeout(parkTimer)
    parkTimer = undefined
    moveOverlay(win, overlayDisplayBounds())
    win.setIgnoreMouseEvents(false)
    win.setFocusable(true)
    win.showInactive()
    win.setAlwaysOnTop(true, 'screen-saver')
    win.focus()
  } else {
    win.setIgnoreMouseEvents(true)
    win.setFocusable(false)
    win.blur()
    clearTimeout(parkTimer)
    parkTimer = setTimeout(() => {
      if (!overlayActive) parkOverlay(win)
    }, PARK_DELAY_MS)
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
