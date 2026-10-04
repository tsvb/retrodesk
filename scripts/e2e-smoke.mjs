// End-to-end smoke test: launches the built Electron app against an isolated, throwaway data folder,
// seeds a small fake ROM library, drives the real UI and saves screenshots of every main screen.
// Usage: npm run build && node scripts/e2e-smoke.mjs [outDir]
import { _electron as electron } from 'playwright-core'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const outDir = resolve(process.argv[2] ?? join(root, 'out', 'e2e'))
const work = join(tmpdir(), `retrodesk-e2e-${Date.now()}`)
const roms = join(work, 'roms')
mkdirSync(outDir, { recursive: true })

const fake = (rel, size = 4096) => {
  const p = join(roms, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, Buffer.alloc(size, 1))
}
fake('snes/Super Mario World (USA).sfc')
fake('snes/Legend of Zelda, The - A Link to the Past (USA).sfc')
fake('snes/Super Metroid (Japan, USA) (En,Ja).sfc')
fake('Nintendo 64/Super Mario 64 (USA).z64')
fake('gba/Metroid Fusion (USA).gba')
fake('nes/Super Mario Bros. 3 (USA) (Rev 1).nes')
fake('genesis/Sonic The Hedgehog 2 (World) (Rev A).md')
fake('psx/Final Fantasy VII (USA) (Disc 1).cue', 2048)

const errors = []
const app = await electron.launch({
  executablePath: require('electron'),
  args: [root],
  env: { ...process.env, RETRODESK_USER_DATA: join(work, 'userdata'), RETRODESK_DATA_ROOT: join(work, 'data') }
})
app.process().stderr?.on('data', (d) => {
  const s = String(d)
  if (/error|fail|exception/i.test(s)) errors.push(`[main] ${s.trim()}`)
})

const win = await app.firstWindow()
win.on('console', (m) => m.type() === 'error' && errors.push(`[renderer] ${m.text()}`))
win.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
await win.setViewportSize({ width: 1600, height: 900 })
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(1500)

const shot = async (name) => {
  await win.waitForTimeout(700)
  await win.screenshot({ path: join(outDir, `${name}.png`) })
  console.log('screenshot', name)
}
const go = async (hash) => {
  await win.evaluate((h) => {
    location.hash = h
    location.reload()
  }, hash)
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1200)
}

await shot('01-onboarding')

// Configure + scan through the real IPC API.
const scan = await win.evaluate(async (romDir) => {
  await window.retrodesk.settings.set({ onboarded: true, romFolders: [{ path: romDir }], scraping: { autoFetchArtwork: true } })
  return window.retrodesk.library.scan()
}, roms)
console.log('scan', scan)
const systems = await win.evaluate(() => window.retrodesk.library.getSystems())
console.log('systems with games', systems.filter((s) => s.gameCount).map((s) => `${s.id}:${s.gameCount}:${s.playable}`).join(' '))
const games = await win.evaluate(() => window.retrodesk.library.getGames({}))
console.log('games', games.map((g) => `${g.systemId}|${g.title}|${g.regions.join(',')}`).join('\n  '))
const emus = await win.evaluate(() => window.retrodesk.emulators.list())
console.log('emulators', emus.length, 'installed:', emus.filter((e) => e.installed).map((e) => e.id).join(','))
const bios = await win.evaluate(() => window.retrodesk.bios.check())
console.log('bios entries', bios.length)
const stats = await win.evaluate(() => window.retrodesk.system.getStats())
console.log('stats', JSON.stringify(stats))

// Give artwork a moment to download.
await win.waitForTimeout(6000)
await go('#/home')
await shot('02-home')
await go('#/systems')
await shot('03-systems')
await go('#/systems/games~snes')
await shot('04-games-snes')
const snesGame = games.find((g) => g.systemId === 'snes')
if (snesGame) {
  await go(`#/systems/games~snes/game~${snesGame.id}`)
  await shot('05-game-detail')
}
await go('#/search')
await shot('06-search')
for (const tab of ['library', 'emulators', 'bios', 'controls', 'display', 'ingame', 'performance', 'achievements', 'about']) {
  await go(`#/settings~${tab}`)
  await shot(`07-settings-${tab}`)
}

// Keyboard navigation sanity check on home.
await go('#/home')
for (const k of ['ArrowDown', 'ArrowRight', 'ArrowRight', 'Enter']) {
  await win.keyboard.press(k)
  await win.waitForTimeout(150)
}
await shot('08-keyboard-nav')

await app.close()
try {
  rmSync(work, { recursive: true, force: true })
} catch {}
console.log(errors.length ? `ERRORS (${errors.length}):\n${errors.join('\n')}` : 'No errors captured')
