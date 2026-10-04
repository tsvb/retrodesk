// Full play-session E2E: installs RetroArch + a core through the app, launches a freely licensed homebrew ROM
// (pinobatch's 240p Test Suite for Game Boy, zlib licence), drives the Game Assist overlay and RetroArch network
// commands, then quits and checks play time was recorded.
// Usage: npm run build && node scripts/e2e-play.mjs <workDir>   (workDir is reused so the RetroArch download is cached)
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { join, resolve } from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
// Not under out/: electron-builder packages that folder, and this one holds a downloaded RetroArch.
const work = resolve(process.argv[2] ?? join(root, '.e2e', 'play'))
const shots = join(work, 'shots')
const roms = join(work, 'roms', 'gb')
mkdirSync(shots, { recursive: true })
mkdirSync(roms, { recursive: true })

const log = (...a) => console.log('[e2e]', ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function ensureRom() {
  const rom = join(roms, 'gb240p.gb')
  if (existsSync(rom)) return
  log('downloading test ROM gb240p.gb')
  const res = await fetch('https://github.com/pinobatch/240p-test-mini/releases/download/v0.23/gb240p.gb')
  writeFileSync(rom, Buffer.from(await res.arrayBuffer()))
}

/** Capture the whole primary screen (to verify the transparent overlay really composites over the game). */
function screenGrab(file) {
  const ps = `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();' -Name U -Namespace W; [W.U]::SetProcessDPIAware() | Out-Null; Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('${file}'); $g.Dispose(); $bmp.Dispose()`
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps])
}

await ensureRom()
const errors = []
const app = await electron.launch({
  executablePath: require('electron'),
  args: [root],
  env: { ...process.env, RETRODESK_USER_DATA: join(work, 'userdata'), RETRODESK_DATA_ROOT: join(work, 'data') }
})
app.process().stderr?.on('data', (d) => /error|fail|exception/i.test(String(d)) && errors.push(`[main] ${String(d).trim()}`))
const win = await app.firstWindow()
win.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
win.on('console', (m) => m.type() === 'error' && errors.push(`[renderer] ${m.text()}`))
await win.waitForLoadState('domcontentloaded')

const api = (fn, arg) => win.evaluate(fn, arg)
await api((dir) => window.retrodesk.settings.set({ onboarded: true, romFolders: [{ path: dir }] }), join(work, 'roms'))
const scan = await api(() => window.retrodesk.library.scan())
log('scan', JSON.stringify(scan))
const [game] = await api(() => window.retrodesk.library.getGames({ systemId: 'gb' }))
if (!game) throw new Error('test ROM not found by scanner')
log('game', game.title, game.path)

let t = Date.now()
await api(() => window.retrodesk.emulators.installForSystem('gb'))
log(`installForSystem(gb) done in ${((Date.now() - t) / 1000).toFixed(1)}s`)
const installed = (await api(() => window.retrodesk.emulators.list())).filter((e) => e.installed).map((e) => `${e.id}@${e.version ?? '?'}`)
log('installed', installed.join(', '))

const launch = await api((id) => window.retrodesk.game.launch(id), game.id)
log('launch', JSON.stringify(launch))
if (!launch.ok) throw new Error(`launch failed: ${launch.error}`)
await sleep(5000)

const overlay = app.windows().find((w) => w.url().includes('overlay'))
log('overlay window present:', !!overlay)
await win.screenshot({ path: join(shots, '10-main-now-playing.png') })

await api(() => window.retrodesk.game.quickAction('save_state'))
await sleep(1500)
const statesDir = join(work, 'data', 'states')
const findStates = (d) => (existsSync(d) ? readdirSync(d, { recursive: true }).map(String).filter((f) => /\.state\d*$/.test(f)) : [])
log('state files', findStates(statesDir).join(', ') || '(none)')

if (overlay) {
  await overlay.evaluate(() => window.retrodesk.window.setOverlayActive(true))
  await sleep(1200)
  log('session while overlay active', JSON.stringify(await api(() => window.retrodesk.game.getSession())))
  await overlay.screenshot({ path: join(shots, '11-overlay-page.png') })
  screenGrab(join(shots, '12-desktop-overlay-over-game.png'))
  await overlay.evaluate(() => window.retrodesk.window.setOverlayActive(false))
  await sleep(800)
  log('session after resume', JSON.stringify(await api(() => window.retrodesk.game.getSession())))
  screenGrab(join(shots, '13-desktop-game-resumed.png'))
}

await api(() => window.retrodesk.game.quickAction('quit'))
for (let i = 0; i < 20; i++) {
  if (!(await api(() => window.retrodesk.game.getSession()))) break
  await sleep(500)
}
const after = await api((id) => window.retrodesk.library.getGame(id), game.id)
log('after quit: session', JSON.stringify(await api(() => window.retrodesk.game.getSession())), 'playTimeSec', after?.playTimeSec, 'playCount', after?.playCount)
await sleep(1000)
await win.screenshot({ path: join(shots, '14-main-after-quit.png') })
await app.close()
log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'No errors captured')
