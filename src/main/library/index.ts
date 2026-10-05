import { app } from 'electron'
import { existsSync } from 'fs'
import { isAbsolute, join, relative } from 'path'
import type { RetroDeskApi } from '../../shared/api'
import type { BiosStatus, Game, MediaKind, ScanResult, SystemSummary } from '../../shared/types'
import { isSystemPlayable } from '../emulators'
import { broadcast, createTask, emitLibraryChanged } from '../events'
import { getPaths, managedPathPredicate } from '../paths'
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
import { dirExists, gameIdForPath, isUnder, normPath } from './util'

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
/** The running scan only covers some folders. */
let scanScoped = false
/**
 * Set after the first full scan of this session. Later scans reuse the sizes the library already has instead of
 * measuring every file again, so a ROM replaced by one of another size shows its new size after the next restart.
 */
let sizesMeasured = false
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

/**
 * Throttled libraryChanged event (bursts of updates during artwork downloads). Artwork-only changes travel as a
 * delta the renderer patches in place; anything else makes it reload.
 */
let changeTimer: ReturnType<typeof setTimeout> | null = null
let reloadPending = false
const mediaPending = new Set<string>()

function flushChanges(): void {
  if (changeTimer) clearTimeout(changeTimer)
  changeTimer = null
  if (reloadPending) {
    // The reload picks up the artwork too.
    reloadPending = false
    mediaPending.clear()
    emitLibraryChanged()
    return
  }
  const lib = getStore()
  const media = [...mediaPending].map((id) => lib.get(id)).filter((g): g is Game => !!g)
  mediaPending.clear()
  if (media.length) broadcast('libraryChanged', { media })
}

function notifyChanged(immediate = false): void {
  reloadPending = true
  if (immediate) flushChanges()
  else changeTimer ??= setTimeout(flushChanges, 1500)
}

/** A game's artwork changed: tell the renderer with the next throttled event, without a reload. */
function notifyMediaChanged(id: string): void {
  mediaPending.add(id)
  changeTimer ??= setTimeout(flushChanges, 1500)
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
  if (!store) {
    const loading = new GameStore(libraryFile())
    await loading.loadAsync()
    // Something that could not wait may have loaded it synchronously in the meantime: keep that one.
    store ??= loading
  }
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

const MEDIA_KINDS: MediaKind[] = ['boxart', 'snap', 'title']
const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])
const sameMedia = (a: Game['media'], b: Game['media']): boolean => MEDIA_KINDS.every((k) => a[k] === b[k])

/**
 * What a rescan changes about a game already in the library, or undefined when it changes nothing. Unchanged games
 * are left alone, so a rescan that finds nothing new neither rewrites the library file nor makes the UI reload.
 */
function rescanned(g: Game, sg: ScannedGame): Partial<Game> | undefined {
  // A cover next to the ROM is the user's choice: it wins. Other local images only fill gaps.
  const media = { ...g.media }
  if (sg.localMedia.boxart) media.boxart = sg.localMedia.boxart
  for (const k of ['snap', 'title'] as MediaKind[]) {
    const local = sg.localMedia[k]
    if (local && !media[k]) media[k] = local
  }
  const same =
    g.systemId === sg.systemId &&
    g.path === sg.path &&
    g.fileName === sg.fileName &&
    g.rawName === sg.rawName &&
    g.title === sg.title &&
    g.sizeBytes === sg.sizeBytes &&
    sameList(g.regions, sg.regions) &&
    sameList(g.tags, sg.tags) &&
    sameMedia(g.media, media)
  if (same) return undefined
  const { systemId, path, fileName, rawName, title, regions, tags, sizeBytes } = sg
  return { systemId, path, fileName, rawName, title, regions, tags, sizeBytes, media }
}

/** Installed Steam games, reusing the Steam folder found before (finding it runs reg.exe). */
async function scanSteam(): ReturnType<typeof listSteamGames> {
  await detectSteam()
  const known = steamPath && (await dirExists(join(steamPath, 'steamapps'))) ? steamPath : undefined
  return listSteamGames(known)
}

/**
 * Bring the library in line with the ROM folders and Steam. With `scope` (folders an import just copied games
 * into), only those folders are read, Steam is skipped and nothing is removed.
 */
async function runScan(scope?: string[]): Promise<ScanResult> {
  const t0 = Date.now()
  const task = createTask('Scanning library', { kind: 'scan' })
  const lib = getStore()
  try {
    const settings = getSettings()
    const paths = getPaths()
    const roots = scope ? scope.map((path) => ({ path })) : [...settings.romFolders.filter((f) => f.path), { path: paths.roms }]
    const known = new Map(lib.all().map((g) => [normPath(g.path), { sizeBytes: g.sizeBytes, systemId: g.systemId }]))
    const noSteam = { steamPath: undefined, apps: [] as SteamApp[], complete: false }
    const [out, steam] = await Promise.all([
      scanFolders({
        roots,
        excludeDirs: [paths.bios, paths.saves, paths.states, paths.screenshots, paths.emulators, paths.media, paths.downloads],
        known,
        trustKnownSizes: sizesMeasured,
        arcadeNames,
        onProgress: (p) =>
          p.phase === 'walk'
            ? task.update(-1, `${p.dirs.toLocaleString()} folders, ${p.files.toLocaleString()} files`)
            : task.update(p.total ? (p.done ?? 0) / p.total : -1, `Reading ${(p.done ?? 0).toLocaleString()} of ${(p.total ?? 0).toLocaleString()} games`)
      }),
      scope ? noSteam : scanSteam().catch(() => noSteam)
    ])
    const steamWasDetected = steamDetected
    if (scope) {
      romFolderBiosFiles = [...new Set([...romFolderBiosFiles, ...out.biosFiles])]
    } else {
      steamPath = steam.steamPath
      steamDetected = !!steam.steamPath
      steamDetectDone = Promise.resolve()
      romFolderBiosFiles = out.biosFiles
    }
    // Steam's "playable" flag is part of what the UI shows.
    let changed = steamDetected !== steamWasDetected

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
        changed = true
        continue
      }
      const patch = rescanned(existing, sg)
      if (patch) {
        lib.update(id, (g) => Object.assign(g, patch))
        changed = true
      }
    }

    // Removing a game also drops its play time, favourite flag and artwork links, so only do it when the scan
    // actually looked where the game lives and did not find it.
    const notLookedAt = [...out.unreachableRoots, ...out.unreadableDirs]
    let removed = 0
    for (const g of scope ? [] : lib.all()) {
      if (seen.has(g.id)) continue
      if (g.systemId === 'steam' ? !steam.complete : notLookedAt.some((r) => isUnder(g.path, r))) continue
      lib.remove(g.id)
      removed++
      changed = true
    }

    // ES-DE downloaded_media for games still missing artwork.
    try {
      const candidates = scope ? [...seen].map((id) => lib.get(id)).filter((g): g is Game => !!g) : lib.all()
      const lacking = candidates.filter((g) => g.systemId !== 'steam' && (!g.media.boxart || !g.media.snap || !g.media.title))
      const esde = await applyEsDeMedia(lacking, { romRoots: roots.map((r) => r.path), mediaDir: paths.media, isServable: managedPathPredicate() })
      for (const [id, media] of esde) {
        const g = lib.get(id)
        if (!g || sameMedia(g.media, media)) continue
        lib.update(id, (x) => (x.media = media))
        changed = true
      }
    } catch (e) {
      console.warn('[library] ES-DE media lookup failed', e)
    }
    if (applyArcadeTitles()) changed = true
    if (!scope) sizesMeasured = true

    await lib.flush()
    if (changed) notifyChanged(true)
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

/**
 * Start a scan unless one is running, in which case that one's result is returned. A full scan asked for while a
 * partial one (an import) runs is started after it instead, or new folders and deleted games would be missed.
 */
function startScan(scope?: string[]): Promise<ScanResult> {
  if (scanPromise) {
    if (!scope && scanScoped) return scanPromise.catch(() => undefined).then(() => startScan())
    return scanPromise
  }
  scanScoped = !!scope
  scanPromise = runScan(scope).finally(() => {
    scanPromise = null
  })
  return scanPromise
}

export function scan(): Promise<ScanResult> {
  return startScan()
}

/**
 * The folders to rescan after an import copied `copied` into `romsDir`: the roms/<system> folder of each.
 * Undefined when a full scan is needed instead: a configured ROM folder overlaps one of them and may assign
 * its own system to what is inside.
 */
function importScope(copied: string[], romsDir: string): string[] | undefined {
  const dirs = new Map<string, string>()
  for (const p of copied) {
    const sys = relative(romsDir, p).split(/[\\/]/)[0]
    if (!sys || sys.startsWith('..') || isAbsolute(sys)) return undefined
    const dir = join(romsDir, sys)
    dirs.set(normPath(dir), dir)
  }
  // A ROM folder below roms/<system> is a scan root of its own, with its own system: leave that to a full scan.
  // Folders above are fine: roms/ is always a root, so they never decide what is inside it.
  const folders = getSettings()
    .romFolders.map((f) => f.path)
    .filter(Boolean)
  for (const d of dirs.values()) if (folders.some((f) => isUnder(f, d))) return undefined
  return [...dirs.values()]
}

// ---------------------------------------------------------------- artwork

function needsArtwork(g: Game, isServable: (p: string) => boolean): boolean {
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
      isServable: managedPathPredicate(),
      onProgress: (done, total, title) => task.update(done / total, `${done.toLocaleString()} of ${total.toLocaleString()}: ${title}`),
      onUpdate: (id, media) => {
        if (lib.update(id, (g) => (g.media = media))) notifyMediaChanged(id)
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
    const servable = managedPathPredicate()
    const games = gameIds?.length ? gameIds.map((id) => lib.get(id)).filter((g): g is Game => !!g) : lib.all().filter((g) => needsArtwork(g, servable))
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
    const romsDir = getPaths().roms
    let scope: string[] | undefined
    try {
      const res = await importRomFiles(paths ?? [], romsDir, (done, total, name) => task.update(total ? done / total : -1, name))
      task.done(`${res.copied.length} file(s) copied${res.skipped.length ? `, ${res.skipped.length} skipped` : ''}${res.errors.length ? `, ${res.errors.length} failed` : ''}`)
      if (res.errors.length) console.warn('[library] import errors', res.errors)
      // Files skipped because they are already in roms/ may not be in the library yet: look at those too.
      scope = importScope([...res.copied, ...res.skipped.filter((p) => isUnder(p, romsDir))], romsDir)
    } catch (e) {
      task.fail(e)
      throw e
    }
    if (scanPromise) await scanPromise.catch(() => undefined)
    // Only the folders the import touched, not every ROM folder.
    return startScan(scope)
  }
}

export const biosHandlers: RetroDeskApi['bios'] = {
  async check(): Promise<BiosStatus[]> {
    return checkBios(
      getSystemDefs(),
      getPaths().bios,
      romFolderBiosFiles.filter((f) => existsSync(f))
    )
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
