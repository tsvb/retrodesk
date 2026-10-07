import type { DeepPartial, RetroDeskApi } from '@shared/api'
import { deepMerge } from '@shared/merge'
import { QUICK_ACTIONS } from '@shared/quickActions'
import type {
  BiosStatus,
  EmulatorStatus,
  Game,
  GameQuery,
  LaunchResult,
  NativePad,
  PerformanceMode,
  QuickAction,
  ScanResult,
  SessionInfo,
  Settings,
  SystemDef,
  SystemStats,
  SystemSummary,
  TaskProgress,
  TaskSubject
} from '@shared/types'
import { MOCK_EMULATORS, MOCK_GAMES, MOCK_SYSTEMS, SYNTH_A, SYNTH_B } from './data'

/**
 * In-memory implementation of the full RetroDeskApi so the renderer can be developed and previewed in
 * a normal browser. URL flags (query string, before the #):
 *   ?onboarding     start with settings.onboarded = false
 *   ?empty          start with an empty library
 *   ?session        start with a game running (Now Playing screen)
 *   ?mockGames=N    add N synthetic games to SNES for performance testing
 */

const REGION_WORDS = new Set(['USA', 'Europe', 'Japan', 'World', 'Australia', 'Korea', 'Brazil', 'France', 'Germany', 'Spain', 'Italy'])

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function parseRaw(raw: string): { title: string; regions: string[]; tags: string[] } {
  const groups = [...raw.matchAll(/\(([^)]*)\)/g)].map((m) => m[1] ?? '')
  const title = raw
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/ - /g, ': ')
    .trim()
  const regions: string[] = []
  const tags: string[] = []
  for (const g of groups) {
    const parts = g.split(',').map((p) => p.trim())
    if (parts.every((p) => REGION_WORDS.has(p))) regions.push(...parts)
    else if (!/^(En|Ja|Fr|De|Es|It)(,|$)/.test(g)) tags.push(g)
  }
  return { title, regions, tags }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const ROOT = 'C:\\Users\\you\\RetroDesk'

export function createMockApi(): RetroDeskApi {
  const params = new URLSearchParams(location.search)
  const isOverlay = location.hash.startsWith('#/overlay')
  const now = Date.now()
  const rand = rng(42)

  const listeners = {
    task: new Set<(t: TaskProgress) => void>(),
    session: new Set<(s: SessionInfo | null) => void>(),
    libraryChanged: new Set<() => void>(),
    overlay: new Set<(v: boolean) => void>(),
    settingsChanged: new Set<(s: Settings) => void>(),
    gamepads: new Set<(p: NativePad[]) => void>()
  }
  const sub = <T>(set: Set<T>, cb: T) => {
    set.add(cb)
    return () => {
      set.delete(cb)
    }
  }

  let settings: Settings = {
    onboarded: !params.has('onboarding'),
    dataRoot: ROOT,
    romFolders: params.has('empty') || params.has('onboarding') ? [] : [{ path: 'D:\\Games\\ROMs' }, { path: 'E:\\Arcade', systemId: 'arcade' }],
    systemEmulator: {},
    ui: { theme: 'midnight', accent: '#7c5cff', density: 'comfortable', sounds: true, haptics: true, startFullscreen: false, hideEmptySystems: true, buttonLayout: 'auto' },
    retroarch: { shader: 'none', autoSaveState: true, autoLoadState: true, showFps: false, runAhead: false, rewind: false, integerScale: false, aspect: 'core', videoDriver: 'vulkan' },
    retroAchievements: { enabled: false, username: '', password: '', hardcore: false },
    hotkeys: { quickMenu: 'Control+Alt+Home', quickMenuCombo: [8, 9] },
    performance: { inGameMode: 'unchanged' },
    scraping: { autoFetchArtwork: true, preferredRegion: 'USA' }
  }

  const emulators: EmulatorStatus[] = MOCK_EMULATORS.map((e) => ({ ...e }))
  const systems: SystemDef[] = MOCK_SYSTEMS
  const presentBios = new Set<string>(['dc/dc_boot.bin', 'scph5502.bin'])

  let games: Game[] = []
  const buildLibrary = () => {
    const out: Game[] = []
    for (const [systemId, list] of Object.entries(MOCK_GAMES)) {
      for (const raw of list) out.push(makeGame(systemId, raw))
    }
    const extra = Number(params.get('mockGames') ?? 0)
    for (let i = 0; i < extra; i++) {
      const a = SYNTH_A[Math.floor(rand() * SYNTH_A.length)]
      const b = SYNTH_B[Math.floor(rand() * SYNTH_B.length)]
      out.push(makeGame('snes', `${a} ${b} ${i + 1} (USA)`))
    }
    return out
  }
  function makeGame(systemId: string, raw: string): Game {
    const { title, regions, tags } = parseRaw(raw)
    const played = rand() < 0.35
    const id = `${systemId}-${raw}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 48)
    const ext = systems.find((s) => s.id === systemId)?.extensions[0] ?? '.bin'
    return {
      id,
      systemId,
      path: `D:\\Games\\ROMs\\${systemId}\\${raw}${ext}`,
      fileName: `${raw}${ext}`,
      title,
      rawName: raw,
      regions,
      tags,
      sizeBytes: Math.round(200_000 + rand() * 600_000_000),
      addedAt: now - Math.floor(rand() * 90) * 86_400_000,
      lastPlayedAt: played ? now - Math.floor(rand() * 40 * 86_400_000) : undefined,
      playTimeSec: played ? Math.floor(rand() * 60 * 3600) : 0,
      playCount: played ? 1 + Math.floor(rand() * 30) : 0,
      favorite: rand() < 0.14,
      hidden: false,
      media: {}
    }
  }
  if (!params.has('empty') && !params.has('onboarding')) games = buildLibrary()

  const isInstalled = (id: string) => emulators.some((e) => e.id === id && e.installed)
  const systemPlayable = (s: SystemDef) => s.emulators.some((ref) => (ref.type === 'retroarch' ? isInstalled('retroarch') && isInstalled(`core:${ref.core}`) : isInstalled(ref.id)))

  const summaries = (): SystemSummary[] => systems.map((s) => ({ ...s, gameCount: games.filter((g) => g.systemId === s.id && !g.hidden).length, playable: systemPlayable(s) }))

  let taskSeq = 0
  async function runTask(label: string, ms: number, details: string[] = [], subject?: TaskSubject): Promise<void> {
    const task: TaskProgress = { id: `mock-${++taskSeq}`, label, subject, progress: 0, state: 'running' }
    const emit = () => listeners.task.forEach((l) => l({ ...task }))
    emit()
    const steps = Math.max(6, Math.round(ms / 120))
    for (let i = 1; i <= steps; i++) {
      await sleep(ms / steps)
      task.progress = i / steps
      if (details.length) task.detail = details[Math.min(details.length - 1, Math.floor((i / steps) * details.length))]
      emit()
    }
    task.state = 'done'
    task.progress = 1
    emit()
  }

  let session: SessionInfo | null = null
  const emitSession = () => listeners.session.forEach((l) => l(session ? { ...session } : null))
  const startSession = (g: Game): SessionInfo => {
    const sys = systems.find((s) => s.id === g.systemId)
    const ref = sys?.emulators[0]
    session = {
      gameId: g.id,
      title: g.title,
      systemId: g.systemId,
      emulatorId: ref ? (ref.type === 'retroarch' ? `retroarch:${ref.core}` : `standalone:${ref.id}`) : 'unknown',
      supportsCommands: ref?.type === 'retroarch',
      startedAt: Date.now(),
      pid: 4242,
      stateSlot: 0,
      fastForward: false,
      paused: false
    }
    return session
  }
  if ((params.has('session') || isOverlay) && games.length) {
    const g = games.find((x) => x.systemId === 'snes') ?? games[0]
    if (g) startSession(g).startedAt = Date.now() - 23 * 60_000
  }

  let stats: SystemStats = {
    cpuPercent: 18,
    memUsedBytes: 9.4e9,
    memTotalBytes: 32e9,
    gpu: { name: 'NVIDIA GeForce RTX 4070', utilPercent: 34, tempC: 56, memUsedMB: 2310, memTotalMB: 12282 },
    battery: { percent: 76, charging: false },
    powerPlan: 'Balanced'
  }
  const walk = (v: number, lo: number, hi: number, step: number) => Math.max(lo, Math.min(hi, v + (Math.random() - 0.5) * step))

  const findGame = (id: string) => {
    const g = games.find((x) => x.id === id)
    if (!g) throw new Error(`Game not found: ${id}`)
    return g
  }
  const changed = () => listeners.libraryChanged.forEach((l) => l())

  const api: RetroDeskApi = {
    library: {
      async getSystems() {
        await sleep(30)
        return summaries()
      },
      async getGames(q: GameQuery = {}) {
        let list = games.filter((g) => (q.includeHidden || !g.hidden) && (!q.systemId || g.systemId === q.systemId) && (!q.favoritesOnly || g.favorite))
        if (q.search) {
          const needle = q.search.toLowerCase()
          list = list.filter((g) => g.title.toLowerCase().includes(needle))
        }
        const sort = q.sort ?? 'title'
        list = [...list].sort((a, b) => {
          switch (sort) {
            case 'lastPlayed':
              return (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0)
            case 'playTime':
              return b.playTimeSec - a.playTimeSec
            case 'added':
              return b.addedAt - a.addedAt
            case 'system':
              return a.systemId.localeCompare(b.systemId) || a.title.localeCompare(b.title)
            default:
              return a.title.localeCompare(b.title)
          }
        })
        return q.limit ? list.slice(0, q.limit) : list
      },
      async getGame(id) {
        return games.find((g) => g.id === id) ?? null
      },
      async getRecent(limit = 12) {
        return games
          .filter((g) => g.lastPlayedAt && !g.hidden)
          .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
          .slice(0, limit)
      },
      async scan(): Promise<ScanResult> {
        const t0 = Date.now()
        const before = games.length
        await runTask(
          'Scanning ROM folders',
          2200,
          systems.map((s) => `Looking in ${s.shortName ?? s.name}`),
          { kind: 'scan' }
        )
        if (games.length === 0 && settings.romFolders.length) games = buildLibrary()
        changed()
        return { added: games.length - before, removed: 0, total: games.length, durationMs: Date.now() - t0 }
      },
      async setFavorite(id, favorite) {
        const g = findGame(id)
        g.favorite = favorite
        return { ...g }
      },
      async setHidden(id, hidden) {
        const g = findGame(id)
        g.hidden = hidden
        changed()
        return { ...g }
      },
      async setEmulatorOverride(id, emulator) {
        const g = findGame(id)
        if (emulator) g.emulatorOverride = emulator
        else delete g.emulatorOverride
        return { ...g }
      },
      async fetchArtwork() {
        await runTask(
          'Downloading artwork',
          3000,
          games.slice(0, 30).map((g) => g.title),
          { kind: 'artwork' }
        )
        changed()
      },
      async importFiles(paths) {
        const t0 = Date.now()
        await runTask(`Importing ${paths.length} file${paths.length === 1 ? '' : 's'}`, 1200, [], { kind: 'import' })
        for (const p of paths) games.push(makeGame('nes', (p.split(/[\\/]/).pop() ?? p).replace(/\.[^.]+$/, '')))
        changed()
        return { added: paths.length, removed: 0, total: games.length, durationMs: Date.now() - t0, copied: paths.length, originals: paths }
      },
      async removeImportedOriginals(paths) {
        console.info('[mock] moved to trash', paths)
        return { removed: paths.length, errors: [] }
      }
    },
    emulators: {
      async list() {
        await sleep(40)
        return emulators.map((e) => ({ ...e }))
      },
      async install(id) {
        const e = emulators.find((x) => x.id === id)
        if (!e) throw new Error(`Unknown emulator ${id}`)
        await runTask(`Installing ${e.name}`, 2600, ['Downloading', 'Downloading', 'Extracting', 'Configuring'], { kind: 'emulator', id: e.id })
        e.installed = true
        e.version = e.version ?? '1.0.0'
        e.sizeBytes = e.sizeBytes ?? 48_000_000
        changed()
        return { ...e }
      },
      async uninstall(id) {
        const e = emulators.find((x) => x.id === id)
        if (e) e.installed = false
        await sleep(300)
        changed()
      },
      async installForSystem(systemId) {
        const s = systems.find((x) => x.id === systemId)
        const ref = s?.emulators.find((r) => r.default) ?? s?.emulators[0]
        if (!ref) throw new Error(`No emulator known for ${systemId}`)
        if (ref.type === 'retroarch') {
          if (!isInstalled('retroarch')) await api.emulators.install('retroarch')
          await api.emulators.install(`core:${ref.core}`)
        } else {
          await api.emulators.install(ref.id)
        }
      },
      async openEmulatorUi(id) {
        console.info('[mock] open emulator UI', id)
      }
    },
    bios: {
      async check(): Promise<BiosStatus[]> {
        await sleep(60)
        return systems.flatMap((s) =>
          s.bios.map((b) => ({ systemId: s.id, file: b.file, description: b.description, required: b.required, present: presentBios.has(b.file), valid: presentBios.has(b.file) }))
        )
      },
      async importFiles(paths) {
        for (const s of systems) for (const b of s.bios) presentBios.add(b.file)
        console.info('[mock] imported bios', paths)
        return api.bios.check()
      }
    },
    game: {
      async launch(gameId): Promise<LaunchResult> {
        await sleep(500)
        const g = findGame(gameId)
        const s = systems.find((x) => x.id === g.systemId)
        if (!s) return { ok: false, error: 'Unknown system' }
        if (!systemPlayable(s)) {
          const ref = s.emulators[0]
          return { ok: false, needs: 'emulator', error: `No emulator for ${s.name} is installed yet.`, emulatorId: ref ? (ref.type === 'retroarch' ? `core:${ref.core}` : ref.id) : undefined }
        }
        const missing = s.bios.find((b) => b.required && !presentBios.has(b.file))
        if (missing) return { ok: false, needs: 'bios', error: `${s.name} needs ${missing.file} (${missing.description}).` }
        g.lastPlayedAt = Date.now()
        g.playCount += 1
        const sess = startSession(g)
        emitSession()
        changed()
        return { ok: true, session: { ...sess } }
      },
      async getSession() {
        return session ? { ...session } : null
      },
      async quickAction(action: QuickAction) {
        await sleep(120)
        if (!session) return
        if (action === 'quit') {
          const g = games.find((x) => x.id === session?.gameId)
          if (g) g.playTimeSec += Math.round((Date.now() - session.startedAt) / 1000)
          session = null
          emitSession()
          changed()
          return
        }
        const def = QUICK_ACTIONS[action]
        if (def.available && !def.available(session)) return
        if (action === 'resume') session.paused = false
        def.apply?.(session)
        emitSession()
      }
    },
    settings: {
      async get() {
        return structuredClone(settings)
      },
      async set(patch: DeepPartial<Settings>) {
        settings = deepMerge(settings, patch)
        const snapshot = structuredClone(settings)
        listeners.settingsChanged.forEach((l) => l(structuredClone(snapshot)))
        return structuredClone(settings)
      }
    },
    system: {
      async getStats() {
        stats = {
          ...stats,
          cpuPercent: walk(stats.cpuPercent, 3, 96, 14),
          memUsedBytes: walk(stats.memUsedBytes, 6e9, 20e9, 4e8),
          gpu: stats.gpu ? { ...stats.gpu, utilPercent: walk(stats.gpu.utilPercent, 2, 99, 16), tempC: walk(stats.gpu.tempC, 40, 82, 3) } : undefined
        }
        return structuredClone(stats)
      },
      async setPerformanceMode(mode: PerformanceMode) {
        stats.powerPlan = { quiet: 'Power saver', balanced: 'Balanced', performance: 'High performance', unchanged: stats.powerPlan ?? 'Balanced' }[mode]
      },
      async pickFolder() {
        await sleep(200)
        const options = ['D:\\Games\\ROMs', 'E:\\Emulation\\roms', 'F:\\Retro']
        return options.find((o) => !settings.romFolders.some((f) => f.path === o)) ?? 'G:\\More ROMs'
      },
      async pickFiles(opts) {
        await sleep(200)
        return opts?.title?.toLowerCase().includes('bios') ? ['D:\\Downloads\\scph5501.bin'] : ['D:\\Downloads\\Shovel Knight (USA).nes']
      },
      async openPath(p) {
        console.info('[mock] openPath', p)
      },
      async openExternal(url) {
        window.open(url, '_blank', 'noopener')
      },
      async getPaths() {
        const j = (s: string) => `${settings.dataRoot}\\${s}`
        return { dataRoot: settings.dataRoot, roms: j('roms'), bios: j('bios'), saves: j('saves'), states: j('states'), screenshots: j('screenshots'), emulators: j('emulators'), media: j('media') }
      },
      async getVersion() {
        return '0.1.0-preview'
      },
      async getGamepads() {
        return null
      },
      async rumbleGamepads() {}
    },
    window: {
      async toggleFullscreen() {
        if (document.fullscreenElement) await document.exitFullscreen()
        else await document.documentElement.requestFullscreen().catch(() => undefined)
        return !!document.fullscreenElement
      },
      async isFullscreen() {
        return !!document.fullscreenElement
      },
      async minimize() {},
      async quit() {
        console.info('[mock] quit')
      },
      async setOverlayActive(active) {
        listeners.overlay.forEach((l) => l(active))
      },
      async setOverlayHold() {}
    },
    on: {
      task: (cb) => sub(listeners.task, cb),
      session: (cb) => sub(listeners.session, cb),
      libraryChanged: (cb) => sub(listeners.libraryChanged, cb),
      overlay: (cb) => sub(listeners.overlay, cb),
      settingsChanged: (cb) => sub(listeners.settingsChanged, cb),
      gamepads: (cb) => sub(listeners.gamepads, cb)
    }
  }
  return api
}
