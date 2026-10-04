// Real end-to-end check (network + real emulators). Opt-in:
//   $env:RETRODESK_E2E='1'; $env:RETRODESK_E2E_ROOT="$env:TEMP\rd-e2e"; npx vitest run src/main/launch/e2e.test.ts
// Installs RetroArch + gambatte + PPSSPP into the throwaway data root, downloads a homebrew GB test ROM
// (pinobatch/240p-test-mini, zlib licence), launches it through gameHandlers.launch and drives RetroArch over UDP.
import { existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { Game, SessionInfo, Settings } from '../../shared/types'

const E2E = process.env['RETRODESK_E2E'] === '1'
const ROOT = process.env['RETRODESK_E2E_ROOT'] ?? join(tmpdir(), 'rd-e2e')

const h = vi.hoisted(() => ({
  sessions: [] as (SessionInfo | null)[],
  played: [] as { id: string; seconds: number }[],
  overlay: [] as string[],
  tasks: [] as string[],
  settings: null as unknown as Settings,
  game: null as unknown as Game
}))

vi.mock('electron', () => ({
  app: { getPath: () => ROOT, on: () => undefined },
  globalShortcut: { register: () => true, unregister: () => undefined },
  shell: { openExternal: async () => undefined }
}))
vi.mock('../settings', async () => {
  const actual = await vi.importActual<typeof import('../settings')>('../settings')
  return { ...actual, getSettings: () => h.settings, onSettingsChanged: () => () => undefined }
})
vi.mock('../events', () => ({
  emitSession: (s: SessionInfo | null) => h.sessions.push(s ? { ...s } : null),
  emitLibraryChanged: () => undefined,
  createTask: (label: string) => ({
    id: label,
    update: (p: number, d?: string) => h.tasks.push(`${label}: ${Math.round(p * 100)}% ${d ?? ''}`),
    done: (d?: string) => h.tasks.push(`${label}: done ${d ?? ''}`),
    fail: (e: unknown) => h.tasks.push(`${label}: FAIL ${String(e)}`)
  })
}))
vi.mock('../windows', () => ({
  showOverlay: () => h.overlay.push('show'),
  destroyOverlay: () => h.overlay.push('destroy'),
  hideOverlay: () => h.overlay.push('hide'),
  setOverlayActive: (a: boolean) => h.overlay.push(`active:${a}`),
  isOverlayActive: () => false,
  onOverlayActiveChanged: () => () => undefined,
  focusMainWindow: () => h.overlay.push('focusMain')
}))
vi.mock('../library', () => ({
  getGameById: async (id: string) => (id === h.game?.id ? h.game : null),
  recordPlaySession: async (id: string, _startedAt: number, seconds: number) => h.played.push({ id, seconds })
}))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe.skipIf(!E2E)('e2e: install + launch + UDP control', () => {
  afterAll(async () => {
    const { gameHandlers } = await import('./index')
    if (await gameHandlers.getSession()) await gameHandlers.quickAction('quit')
  })

  it(
    'installs RetroArch, a core and PPSSPP, launches a ROM and saves a state over UDP',
    async () => {
      const { defaultSettings } = await import('../settings')
      h.settings = defaultSettings()
      h.settings.dataRoot = ROOT
      h.settings.retroarch.videoDriver = 'd3d11'
      h.settings.retroarch.shader = 'lcd'
      h.settings.retroarch.autoLoadState = false

      const { getPaths } = await import('../paths')
      const { initEmulators, emulatorsHandlers, isSystemPlayable } = await import('../emulators')
      const { downloadFile } = await import('../emulators/download')
      const { gameHandlers, initLaunch } = await import('./index')
      const { RaCommandClient } = await import('./racommand')
      const paths = getPaths()
      await initEmulators()
      initLaunch()

      // 1. Install RetroArch + gambatte (skip if a previous run already did).
      const list0 = await emulatorsHandlers.list()
      if (!list0.find((e) => e.id === 'retroarch')?.installed) await emulatorsHandlers.install('retroarch')
      if (!list0.find((e) => e.id === 'core:gambatte_libretro')?.installed) await emulatorsHandlers.install('core:gambatte_libretro')
      const list = await emulatorsHandlers.list()
      const ra = list.find((e) => e.id === 'retroarch')!
      console.log('[e2e] RetroArch', ra.version, ra.installPath, ra.sizeBytes)
      expect(ra.installed).toBe(true)
      expect(list.find((e) => e.id === 'core:gambatte_libretro')?.installed).toBe(true)
      expect(isSystemPlayable('gb')).toBe(true)
      expect(isSystemPlayable('steam')).toBe(true)

      // 2. Standalone install path (PPSSPP).
      if (!list.find((e) => e.id === 'ppsspp')?.installed) await emulatorsHandlers.install('ppsspp')
      const pp = (await emulatorsHandlers.list()).find((e) => e.id === 'ppsspp')!
      console.log('[e2e] PPSSPP', pp.version, pp.installPath, pp.sizeBytes)
      expect(pp.installed).toBe(true)
      expect(existsSync(join(pp.installPath!, 'PPSSPPWindows64.exe'))).toBe(true)

      // 3. Test ROM.
      const romDir = join(paths.roms, 'gb')
      mkdirSync(romDir, { recursive: true })
      const rom = join(romDir, 'gb240p.gb')
      if (!existsSync(rom)) await downloadFile('https://github.com/pinobatch/240p-test-mini/releases/download/v0.23/gb240p.gb', rom)
      h.game = {
        id: 'e2e-gb240p',
        systemId: 'gb',
        path: rom,
        fileName: 'gb240p.gb',
        title: '240p Test Suite',
        rawName: 'gb240p',
        regions: [],
        tags: [],
        sizeBytes: statSync(rom).size,
        addedAt: Date.now(),
        playTimeSec: 0,
        playCount: 0,
        favorite: false,
        hidden: false,
        media: {}
      }

      // 4. Launch through the real launcher code path.
      const res = await gameHandlers.launch(h.game.id)
      console.log('[e2e] launch result', JSON.stringify(res))
      expect(res.ok).toBe(true)
      const client = new RaCommandClient(55355)
      const ready = await client.waitUntilReady(20_000)
      console.log('[e2e] GET_STATUS ->', JSON.stringify(ready))
      expect(ready?.state).toBe('PLAYING')
      console.log('[e2e] VERSION ->', await client.version())
      await sleep(1500)

      // 5. Save state over UDP and check the file.
      const statesBefore = new Set(readdirSync(paths.states))
      await gameHandlers.quickAction('save_state')
      let stateFile: string | undefined
      for (let i = 0; i < 20 && !stateFile; i++) {
        await sleep(250)
        stateFile = readdirSync(paths.states).find((f) => /\.state$/.test(f) && !statesBefore.has(f))
          ?? readdirSync(paths.states).find((f) => f === 'gb240p.state')
      }
      console.log('[e2e] state files:', readdirSync(paths.states))
      expect(stateFile).toBeDefined()

      // 6. Slot change + pause round trip.
      await gameHandlers.quickAction('slot_next')
      expect((await gameHandlers.getSession())?.stateSlot).toBe(1)
      await gameHandlers.quickAction('pause_toggle')
      await sleep(300)
      console.log('[e2e] after PAUSE_TOGGLE ->', JSON.stringify(await client.getStatus()))
      expect((await gameHandlers.getSession())?.paused).toBe(true)
      await gameHandlers.quickAction('pause_toggle')
      await sleep(300)
      console.log('[e2e] after 2nd PAUSE_TOGGLE ->', JSON.stringify(await client.getStatus()))
      expect((await gameHandlers.getSession())?.paused).toBe(false)
      await gameHandlers.quickAction('fast_forward')
      expect((await gameHandlers.getSession())?.fastForward).toBe(true)
      await gameHandlers.quickAction('fast_forward')

      // Foreground helper against the real RetroArch window.
      const { FocusHelper } = await import('./focus')
      const fh = new FocusHelper()
      const t0 = Date.now()
      const r1 = await fh.focus(res.ok ? res.session.pid! : 0, 15_000)
      const t1 = Date.now()
      const r2 = await fh.focus(res.ok ? res.session.pid! : 0)
      console.log(`[e2e] focus helper: ${r1} (cold ${t1 - t0}ms), ${r2} (warm ${Date.now() - t1}ms)`)
      fh.stop()
      expect(r1).toBe('OK')

      // 7. Quit and verify session teardown + play time.
      await gameHandlers.quickAction('quit')
      for (let i = 0; i < 40 && (await gameHandlers.getSession()); i++) await sleep(250)
      client.close()
      expect(await gameHandlers.getSession()).toBeNull()
      await sleep(300)
      console.log('[e2e] sessions', JSON.stringify(h.sessions.map((s) => s && { slot: s.stateSlot, pid: s.pid })))
      console.log('[e2e] played', JSON.stringify(h.played), 'overlay', h.overlay.join(','))
      expect(h.played[0]?.id).toBe('e2e-gb240p')
      expect(h.sessions.at(-1)).toBeNull()
      expect(h.overlay).toContain('show')
      expect(h.overlay).toContain('destroy')
      console.log('[e2e] state slot files after quit:', readdirSync(paths.states))
    },
    20 * 60_000
  )
})
