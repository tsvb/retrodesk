import { execFile } from 'child_process'
import { readdir, readFile, stat } from 'fs/promises'
import { homedir } from 'os'
import { join, normalize } from 'path'
import { hostOs } from '../platform'
import { getObject, getString, parseVdf, type VdfObject } from './vdf'
import { dirExists, fileExists, mapLimit } from './util'

/**
 * Steam library discovery (Windows: the registry; macOS: ~/Library/Application Support/Steam). Steam games are exposed as games of the pseudo-system "steam" with
 * path `steam://rungameid/<appid>`.
 */

export interface SteamApp {
  appid: string
  name: string
  installDir?: string
  sizeOnDisk: number
  libraryPath: string
  /** Unix seconds, from the manifest. */
  lastPlayed?: number
}

export const STEAM_URL_PREFIX = 'steam://rungameid/'

export function steamGamePath(appid: string): string {
  return `${STEAM_URL_PREFIX}${appid}`
}

export function appIdFromPath(p: string): string | undefined {
  return p.toLowerCase().startsWith(STEAM_URL_PREFIX) ? p.slice(STEAM_URL_PREFIX.length).replace(/\/+$/, '') : undefined
}

/** Tools, runtimes and redistributables that Steam installs alongside games. */
const EXCLUDED_APP_IDS = new Set([
  '228980', // Steamworks Common Redistributables
  '250820', // SteamVR
  '1070560', // Steam Linux Runtime
  '1391110', // Steam Linux Runtime - Soldier
  '1628350', // Steam Linux Runtime - Sniper
  '1493710', // Proton Experimental
  '2180100', // Proton Hotfix
  '1826330', // Proton EasyAntiCheat Runtime
  '1161040', // Proton BattlEye Runtime
  '323910', // SteamVR Performance Test
  '1007' // Steam client (old)
])
const EXCLUDED_NAME = /redistributable|soundtrack|dedicated server|\bsdk\b|^proton\b|steam linux runtime|steamworks|^steamvr\b|\bOST\b/i

export function isExcludedSteamApp(appid: string, name: string): boolean {
  return EXCLUDED_APP_IDS.has(appid) || EXCLUDED_NAME.test(name)
}

function regQuery(key: string, value: string): Promise<string | undefined> {
  return new Promise((res) => {
    execFile('reg', ['query', key, '/v', value], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) return res(undefined)
      const m = new RegExp(`${value}\\s+REG_(?:EXPAND_)?SZ\\s+(.+)`, 'i').exec(stdout)
      res(m?.[1]?.trim())
    })
  })
}

/** Locate the Steam install directory, or undefined if Steam isn't installed. */
export async function findSteamPath(): Promise<string | undefined> {
  if (hostOs() === 'macos') {
    // The Steam app keeps its libraries (steamapps, libraryfolders.vdf, appcache) in Application Support.
    const p = join(homedir(), 'Library', 'Application Support', 'Steam')
    return (await dirExists(join(p, 'steamapps'))) ? p : undefined
  }
  if (process.platform !== 'win32') return undefined
  // Each query spawns reg.exe: ask all at once, then take the first answer in this order.
  const found = await Promise.all([
    regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath'),
    regQuery('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'),
    regQuery('HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath')
  ])
  const candidates = [...found, 'C:\\Program Files (x86)\\Steam']
  for (const c of candidates) {
    if (!c) continue
    const p = normalize(c)
    if (await dirExists(join(p, 'steamapps'))) return p
  }
  return undefined
}

/** Library folders listed in steamapps/libraryfolders.vdf (always includes the Steam dir itself). */
export async function listLibraryFolders(steamPath: string): Promise<string[]> {
  const out = new Map<string, string>()
  out.set(steamPath.toLowerCase(), steamPath)
  try {
    const vdf = parseVdf(await readFile(join(steamPath, 'steamapps', 'libraryfolders.vdf'), 'utf8'))
    const root = getObject(vdf, 'libraryfolders') ?? getObject(vdf, 'LibraryFolders') ?? vdf
    for (const [k, v] of Object.entries(root)) {
      // New format: "0" { "path" "..." }. Old format: "1" "D:\\SteamLibrary".
      const p = typeof v === 'string' ? (/^\d+$/.test(k) ? v : undefined) : getString(v, 'path')
      if (p) out.set(normalize(p).toLowerCase(), normalize(p))
    }
  } catch {
    /* no vdf: just the main library */
  }
  return [...out.values()]
}

export function parseAppManifest(text: string, libraryPath: string): SteamApp | undefined {
  const vdf = parseVdf(text)
  const st: VdfObject | undefined = getObject(vdf, 'AppState')
  const appid = getString(st, 'appid')
  const name = getString(st, 'name')
  // appid ends up in file names and in the steam:// URL handed to the shell: digits only.
  if (!st || !appid || !/^\d{1,10}$/.test(appid) || !name) return undefined
  const flags = Number(getString(st, 'StateFlags') ?? '4')
  if (Number.isFinite(flags) && (flags & 4) === 0) return undefined // not fully installed
  const lastPlayed = Number(getString(st, 'LastPlayed') ?? '0')
  return {
    appid,
    name,
    installDir: getString(st, 'installdir'),
    sizeOnDisk: Number(getString(st, 'SizeOnDisk') ?? '0') || 0,
    libraryPath,
    lastPlayed: lastPlayed > 0 ? lastPlayed : undefined
  }
}

/**
 * All installed Steam games (excluding tools/redistributables). Never throws.
 * `complete` is false when Steam was not found or a library folder could not be read (unplugged drive), in
 * which case a game missing from `apps` is not known to be uninstalled.
 */
export async function listSteamGames(steamPath?: string): Promise<{ steamPath?: string; apps: SteamApp[]; complete: boolean }> {
  const sp = steamPath ?? (await findSteamPath())
  if (!sp) return { apps: [], complete: false }
  const apps = new Map<string, SteamApp>()
  let complete = true
  for (const lib of await listLibraryFolders(sp)) {
    const dir = join(lib, 'steamapps')
    let names: string[]
    try {
      names = (await readdir(dir)).filter((n) => /^appmanifest_\d+\.acf$/i.test(n))
    } catch {
      complete = false
      continue
    }
    await mapLimit(names, 8, async (n) => {
      try {
        const app = parseAppManifest(await readFile(join(dir, n), 'utf8'), lib)
        if (app && !isExcludedSteamApp(app.appid, app.name)) apps.set(app.appid, app)
      } catch {
        /* unreadable manifest */
      }
    })
  }
  return { steamPath: sp, apps: [...apps.values()].sort((a, b) => a.name.localeCompare(b.name)), complete }
}

/** Artwork Steam already cached locally: appcache/librarycache/<appid>/... (new) or <appid>_<name>.jpg (old). */
export async function findLocalSteamArt(steamPath: string, appid: string): Promise<{ boxart?: string; hero?: string; header?: string }> {
  const cache = join(steamPath, 'appcache', 'librarycache')
  const out: { boxart?: string; hero?: string; header?: string } = {}
  const want: [keyof typeof out, string][] = [
    ['boxart', 'library_600x900.jpg'],
    ['hero', 'library_hero.jpg'],
    ['header', 'header.jpg']
  ]
  const appDir = join(cache, appid)
  const dirs = [appDir]
  try {
    for (const e of await readdir(appDir, { withFileTypes: true })) if (e.isDirectory()) dirs.push(join(appDir, e.name))
  } catch {
    /* old layout or missing */
  }
  for (const [kind, file] of want) {
    for (const d of dirs) {
      const p = join(d, file)
      if (await fileExists(p)) {
        out[kind] = p
        break
      }
    }
    if (!out[kind]) {
      const old = join(cache, `${appid}_${file}`)
      if (await fileExists(old)) out[kind] = old
    }
  }
  if (!out.header) {
    const lh = join(appDir, 'library_header.jpg')
    if (await fileExists(lh)) out.header = lh
  }
  // Ignore zero-byte placeholders.
  for (const k of Object.keys(out) as (keyof typeof out)[]) {
    const p = out[k]
    if (p && (await stat(p).catch(() => undefined))?.size === 0) delete out[k]
  }
  return out
}
