import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import type { RetroDeskApi } from '../../shared/api'
import type { BiosStatus, Game, MediaKind, ScanResult, SystemSummary } from '../../shared/types'
import { isSystemPlayable } from '../emulators'
import { createTask, emitLibraryChanged } from '../events'
import { getPaths, isManagedPath as isServable } from '../paths'
import { getSettings, onSettingsChanged } from '../settings'
import { getSystemDefs } from '../systems'
import { fetchArtworkForGames, loadArcadeNames } from './artwork'
import { checkBios, importBiosFiles } from './bios'
import { importRomFiles } from './importer'
import { applyEsDeMedia } from './localMedia'
import { scanFolders, type ScannedGame } from './scanner'
import { findSteamPath, listSteamGames, steamGamePath, type SteamApp } from './steam'
import { GameStore } from './store'
import { parseRomName } from './titles'
import { gameIdForPath, isUnder, normPath } from './util'

// ---------------------------------------------------------------- state

let store: GameStore | null = null
let quitHookInstalled = false
let steamPath: string | undefined
let steamDetected = false
let steamDetectDone: Promise<void> | null = null
/** Arcade BIOS zips found in ROM folders during the last scan (neogeo.zip next to the ROMs counts as present). */
let romFolderBiosFiles: string[] = []
let arcadeNames: Map<string, string> | undefined
let scanPromise: Promise<ScanResult> | null = null
let artworkChain: Promise<void> = Promise.resolve()

function libraryFile(): string {
  return join(app.getPath('userData'), 'library.json')
}

function getStore(): GameStore {
  if (!store) {
    store = new GameStore(libraryFile())
    store.load()
  }
  return store
}

function indexDir(): string {
  return join(getPaths().media, '_index')
}

/** Throttled libraryChanged event (bursts of updates during artwork downloads). */
let changeTimer: ReturnType<typeof setTimeout> | null = null
function notifyChanged(immediate = false): void {
  if (immediate) {
    if (changeTimer) clearTimeout(changeTimer)
    changeTimer = null
    emitLibraryChanged()
    return
  }
  if (changeTimer) return
  changeTimer = setTimeout(() => {
    changeTimer = null
    emitLibraryChanged()
  }, 1500)
}

function detectSteam(): Promise<void> {
  steamDetectDone ??= findSteamPath()
    .then((p) => {
      steamPath = p
      steamDetected = !!p
    })
    .catch(() => {
      steamDetected = false
    })
  return steamDetectDone
}

// ---------------------------------------------------------------- public (main-process) API

export async function initLibrary(): Promise<void> {
  const s = getStore()
  if (!quitHookInstalled) {
    quitHookInstalled = true
    app.on('before-quit', () => store?.flushSync())
    // After a data-folder switch the recorded artwork still points into the old folder: bring it across.
    onSettingsChanged((now, prev) => {
      if (now.dataRoot !== prev.dataRoot) void fetchArtwork().catch((e: unknown) => console.warn('[library] artwork repair failed', e))
    })
  }
  void detectSteam()
  void loadArcadeNames(indexDir(), false)
    .then((m) => {
      if (m) arcadeNames = m
    })
    .catch(() => undefined)
  if (s.size === 0 && getSettings().romFolders.length > 0) {
    setTimeout(() => {
      scan().catch((e: unknown) => console.error('[library] initial scan failed', e))
    }, 0)
  }
}

export function getGameById(id: string): Game | undefined {
  return getStore().get(id)
}

export function recordPlaySession(id: string, startedAt: number, seconds: number): void {
  const g = getStore().update(id, (game) => {
    game.playCount += 1
    game.playTimeSec += Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0))
    game.lastPlayedAt = startedAt
  })
  if (g) notifyChanged(true)
}

// ---------------------------------------------------------------- scanning

function newGame(sg: Pick<ScannedGame, 'path' | 'systemId' | 'fileName' | 'rawName' | 'title' | 'regions' | 'tags' | 'sizeBytes'>, id: string): Game {
  return {
    id,
    systemId: sg.systemId,
    path: sg.path,
    fileName: sg.fileName,
    title: sg.title,
    rawName: sg.rawName,
    regions: sg.regions,
    tags: sg.tags,
    sizeBytes: sg.sizeBytes,
    addedAt: Date.now(),
    playTimeSec: 0,
    playCount: 0,
    favorite: false,
    hidden: false,
    media: {}
  }
}

function steamToScanned(app_: SteamApp): ScannedGame {
  return {
    path: steamGamePath(app_.appid),
    systemId: 'steam',
    fileName: app_.installDir ?? app_.name,
    rawName: app_.name,
    title: app_.name.replace(/\s+/g, ' ').trim(),
    regions: [],
    tags: [],
    sizeBytes: app_.sizeOnDisk,
    localMedia: {}
  }
}

/** Re-title arcade/neogeo games from the FBNeo name map ("mslug" -> "Metal Slug: Super Vehicle-001"). */
function applyArcadeTitles(): number {
  if (!arcadeNames) return 0
  let n = 0
  for (const g of getStore().all()) {
    if (g.systemId !== 'arcade' && g.systemId !== 'neogeo') continue
    const desc = arcadeNames.get(g.rawName.toLowerCase())
    if (!desc) continue
    const p = parseRomName(desc)
    if (g.title === p.title) continue
    getStore().update(g.id, (x) => {
      x.title = p.title
      x.regions = p.regions
      x.tags = p.tags
    })
    n++
  }
  return n
}

async function runScan(): Promise<ScanResult> {
  const t0 = Date.now()
  const task = createTask('Scanning library', { kind: 'scan' })
  const lib = getStore()
  try {
    const settings = getSettings()
    const paths = getPaths()
    const roots = [...settings.romFolders.filter((f) => f.path), { path: paths.roms }]
    const knownSizes = new Map(lib.all().map((g) => [normPath(g.path), g.sizeBytes]))
    const [out, steam] = await Promise.all([
      scanFolders({
        roots,
        excludeDirs: [paths.bios, paths.saves, paths.states, paths.screenshots, paths.emulators, paths.media, paths.downloads],
        knownSizes,
        arcadeNames,
        onProgress: (p) =>
          p.phase === 'walk'
            ? task.update(-1, `${p.dirs.toLocaleString()} folders, ${p.files.toLocaleString()} files`)
            : task.update(p.total ? (p.done ?? 0) / p.total : -1, `Reading ${(p.done ?? 0).toLocaleString()} of ${(p.total ?? 0).toLocaleString()} games`)
      }),
      listSteamGames().catch(() => ({ steamPath: undefined, apps: [] as SteamApp[], complete: false }))
    ])
    steamPath = steam.steamPath
    steamDetected = !!steam.steamPath
    steamDetectDone = Promise.resolve()
    romFolderBiosFiles = out.biosFiles

    const scanned = [...out.games, ...steam.apps.map(steamToScanned)]
    const seen = new Set<string>()
    const newIds: string[] = []
    for (const sg of scanned) {
      const id = gameIdForPath(sg.path)
      if (seen.has(id)) continue
      seen.add(id)
      const existing = lib.get(id)
      if (!existing) {
        const g = newGame(sg, id)
        g.media = { ...sg.localMedia }
        lib.put(g)
        newIds.push(id)
        continue
      }
      lib.update(id, (g) => {
        g.systemId = sg.systemId
        g.path = sg.path
        g.fileName = sg.fileName
        g.rawName = sg.rawName
        g.title = sg.title
        g.regions = sg.regions
        g.tags = sg.tags
        g.sizeBytes = sg.sizeBytes
        // A cover next to the ROM is the user's choice: it wins. Other local images only fill gaps.
        if (sg.localMedia.boxart) g.media.boxart = sg.localMedia.boxart
        for (const k of ['snap', 'title'] as MediaKind[]) {
          const local = sg.localMedia[k]
          if (local && !g.media[k]) g.media[k] = local
        }
      })
    }

    // Removing a game also drops its play time, favourite flag and artwork links, so only do it when the scan
    // actually looked where the game lives and did not find it.
    const notLookedAt = [...out.unreachableRoots, ...out.unreadableDirs]
    let removed = 0
    for (const g of lib.all()) {
      if (seen.has(g.id)) continue
      if (g.systemId === 'steam' ? !steam.complete : notLookedAt.some((r) => isUnder(g.path, r))) continue
      lib.remove(g.id)
      removed++
    }

    // ES-DE downloaded_media for games still missing artwork.
    try {
      const lacking = lib.all().filter((g) => g.systemId !== 'steam' && (!g.media.boxart || !g.media.snap || !g.media.title))
      const esde = await applyEsDeMedia(lacking, { romRoots: roots.map((r) => r.path), mediaDir: paths.media, isServable })
      for (const [id, media] of esde) lib.update(id, (g) => (g.media = media))
    } catch (e) {
      console.warn('[library] ES-DE media lookup failed', e)
    }
    applyArcadeTitles()

    await lib.flush()
    notifyChanged(true)
    const total = lib.size
    const errNote = out.errors.length ? `, ${out.errors.length} unreadable` : ''
    const offline = out.unreachableRoots.length ? `, ${out.unreachableRoots.length} folder(s) not reachable` : ''
    task.done(`${total.toLocaleString()} games (${newIds.length} new, ${removed} removed${errNote}${offline})`)
    if (out.errors.length) console.warn('[library] scan errors', out.errors.slice(0, 20))

    if (newIds.length && settings.scraping.autoFetchArtwork) {
      void fetchArtwork(newIds, false).catch((e: unknown) => console.warn('[library] auto artwork failed', e))
    }
    return { added: newIds.length, removed, total, durationMs: Date.now() - t0 }
  } catch (e) {
    task.fail(e)
    throw e
  }
}

export function scan(): Promise<ScanResult> {
  if (!scanPromise) {
    scanPromise = runScan().finally(() => {
      scanPromise = null
    })
  }
  return scanPromise
}

// ---------------------------------------------------------------- artwork

function needsArtwork(g: Game): boolean {
  if (g.hidden) return false
  // An image recorded under a previous data folder can no longer be shown, so it counts as missing.
  const has = (p?: string): boolean => !!p && isServable(p)
  if (g.systemId === 'steam') return !has(g.media.boxart) || !has(g.media.snap)
  return !has(g.media.boxart) || !has(g.media.snap) || !has(g.media.title)
}

async function runArtwork(games: Game[], force: boolean): Promise<void> {
  if (!games.length) return
  const task = createTask('Downloading artwork', { kind: 'artwork' })
  try {
    const settings = getSettings()
    const paths = getPaths()
    if (games.some((g) => g.systemId === 'arcade' || g.systemId === 'neogeo')) {
      task.update(-1, 'Loading arcade game names')
      const names = await loadArcadeNames(indexDir(), true)
      if (names) {
        arcadeNames = names
        if (applyArcadeTitles()) notifyChanged()
      }
    }
    if (games.some((g) => g.systemId === 'steam') && !steamPath) await detectSteam()
    const lib = getStore()
    const res = await fetchArtworkForGames(games, {
      mediaDir: paths.media,
      preferredRegion: settings.scraping.preferredRegion,
      force,
      steamPath,
      arcadeNames,
      isServable,
      onProgress: (done, total, title) => task.update(done / total, `${done.toLocaleString()} of ${total.toLocaleString()}: ${title}`),
      onUpdate: (id, media) => {
        lib.update(id, (g) => (g.media = media))
        notifyChanged()
      }
    })
    await lib.flush()
    notifyChanged(true)
    const parts = [`${res.downloaded.toLocaleString()} images downloaded`]
    if (res.notFound) parts.push(`${res.notFound.toLocaleString()} games without artwork`)
    if (res.errors.length) parts.push(`${res.errors.length} network errors (${res.errors[0]})`)
    if (res.errors.length && res.downloaded === 0 && res.failed > 0 && res.failed >= games.length) {
      task.fail(new Error(`Artwork download failed: ${res.errors[0]}`))
    } else {
      task.done(parts.join(', '))
    }
    if (res.errors.length) console.warn('[library] artwork errors', res.errors.slice(0, 20))
  } catch (e) {
    task.fail(e)
    throw e
  }
}

/**
 * Ids given -> refresh those games (re-download); none -> every visible game that is missing artwork.
 * Runs are serialised: a second call waits for the current one, then only handles what is still missing.
 */
export function fetchArtwork(gameIds?: string[], force = gameIds !== undefined && gameIds.length > 0): Promise<void> {
  const next = artworkChain.then(() => {
    const lib = getStore()
    const games = gameIds?.length ? gameIds.map((id) => lib.get(id)).filter((g): g is Game => !!g) : lib.all().filter(needsArtwork)
    return runArtwork(games, force)
  })
  artworkChain = next.catch(() => undefined)
  return next
}

// ---------------------------------------------------------------- handlers

function setField(id: string, fn: (g: Game) => void): Game {
  const g = getStore().update(id, fn)
  if (!g) throw new Error(`Game not found: ${id}`)
  notifyChanged(true)
  return g
}

function playable(systemId: string): boolean {
  if (systemId === 'steam') return steamDetected
  try {
    return isSystemPlayable(systemId)
  } catch {
    return false
  }
}

export const libraryHandlers: RetroDeskApi['library'] = {
  async getSystems(): Promise<SystemSummary[]> {
    await Promise.race([detectSteam(), new Promise((r) => setTimeout(r, 1500))])
    const counts = new Map<string, number>()
    for (const g of getStore().all()) if (!g.hidden) counts.set(g.systemId, (counts.get(g.systemId) ?? 0) + 1)
    return getSystemDefs().map((s) => ({ ...s, gameCount: counts.get(s.id) ?? 0, playable: playable(s.id) }))
  },
  async getGames(query) {
    return getStore().query(query ?? {})
  },
  async getGame(id) {
    return getStore().get(id) ?? null
  },
  async getRecent(limit) {
    return getStore().recent(limit ?? 20)
  },
  scan,
  async setFavorite(id, favorite) {
    return setField(id, (g) => (g.favorite = !!favorite))
  },
  async setHidden(id, hidden) {
    return setField(id, (g) => (g.hidden = !!hidden))
  },
  async setEmulatorOverride(id, emulator) {
    return setField(id, (g) => {
      if (emulator) g.emulatorOverride = emulator
      else delete g.emulatorOverride
    })
  },
  async fetchArtwork(gameIds) {
    await fetchArtwork(gameIds)
  },
  async importFiles(paths) {
    const task = createTask('Importing games', { kind: 'import' })
    try {
      const res = await importRomFiles(paths ?? [], getPaths().roms, (done, total, name) => task.update(total ? done / total : -1, name))
      task.done(`${res.copied.length} file(s) copied${res.skipped.length ? `, ${res.skipped.length} skipped` : ''}${res.errors.length ? `, ${res.errors.length} failed` : ''}`)
      if (res.errors.length) console.warn('[library] import errors', res.errors)
    } catch (e) {
      task.fail(e)
      throw e
    }
    if (scanPromise) await scanPromise.catch(() => undefined)
    return scan()
  }
}

export const biosHandlers: RetroDeskApi['bios'] = {
  async check(): Promise<BiosStatus[]> {
    return checkBios(getSystemDefs(), getPaths().bios, romFolderBiosFiles.filter((f) => existsSync(f)))
  },
  async importFiles(paths) {
    const task = createTask('Importing BIOS files', { kind: 'bios' })
    const res = await importBiosFiles(paths ?? [], getSystemDefs(), getPaths().bios)
    if (res.errors.length) console.warn('[bios] import errors', res.errors)
    if (!res.imported.length && res.errors.length) {
      task.fail(new Error(res.errors[0]))
      throw new Error(res.errors[0])
    }
    task.done(`${res.imported.length} imported${res.skipped.length ? `, ${res.skipped.length} not recognised` : ''}`)
    return biosHandlers.check()
  }
}

/** True when a Steam install was found (by the last scan or the startup probe). */
export function isSteamDetected(): boolean {
  return steamDetected
}
