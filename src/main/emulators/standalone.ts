// Standalone emulators: release discovery, install (download + extract + portable trigger), argument templating,
// ROM path resolution for folder-format games and BIOS/config provisioning. What each emulator needs is declared
// in data/standalone-emulators.json; this file is the machinery that carries it out.
import { existsSync } from 'fs'
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import defsJson from '../data/standalone-emulators.json'
import { dolphinLatest, downloadTrusted, forgejoLatestRelease, githubRelease, isTrustedDownloadUrl, type ResolvedRelease } from './download'
import { dirSize, extractArchive, findFile, moveMerge, singleTopFolder } from './extract'
import { downloadDetail, type ProgressSink } from './retroarch'

export type ReleaseSource =
  | { type: 'github'; repo: string; tag?: string }
  | { type: 'forgejo'; api: string; repo: string }
  | { type: 'dolphin'; url: string }

/** A BIOS / firmware / key file an emulator needs, and what to do with it. */
export interface FirmwareItem {
  /** Name the player knows it by; used in the "needs ..." message. */
  label: string
  /** Lets config values refer to the file found, as `{id}`. */
  id?: string
  /** Folders to look in, relative to the BIOS dir ('' is the BIOS dir itself). */
  dirs?: string[]
  /** Exact file name, or a case-insensitive pattern for the file name. */
  name?: string
  pattern?: string
  /** A named search for what a name or pattern cannot express (see FINDERS). */
  finder?: string
  /** Use every match, not only the first. */
  all?: boolean
  /** Copy what was found here (relative to the exe dir; a trailing "/" means "into this folder"). */
  copyTo?: string
  /** missing: only files not there yet. newer: also when the source is newer. notInstalled: only until `installed` holds. */
  copyWhen?: 'missing' | 'newer' | 'notInstalled'
  /** How to tell the emulator already has it, relative to the exe dir. */
  installed?: { anyOf?: string[]; nonEmptyDir?: string; dirNamed?: string; depth?: number }
  required: boolean
  /** Shown when it is missing. Placeholders: {bios}. */
  message?: string
  /** The emulator has to install the file itself: shown when it was found but is not installed. Placeholders: {file}. */
  manual?: string
}

export interface ConfigEdit {
  /** INI / TOML file relative to the exe dir. */
  file: string
  /** Values: {bios}, or {<firmware id>} for a found file (the entry is skipped when it was not found). */
  set: { section: string; key: string; value: string; quote?: 'toml' }[]
  /** A named edit for what `set` cannot express (see CONFIG_HOOKS). */
  hook?: string
}

export interface StandaloneDef {
  id: string
  name: string
  systems: string[]
  source: ReleaseSource
  assetPattern: string
  fallback: { version: string; url: string } | null
  archiveType: '7z' | 'zip'
  /** Exe path relative to the install dir (after flattening a single top-level folder). */
  exe: string
  /** Launch args; placeholders: {rom} {titleId} {exeDir}. */
  args: string[]
  /** Args used by openEmulatorUi (no game). */
  uiArgs: string[]
  /** Files/dirs whose presence switches the emulator to portable mode. */
  portable: { path: string; kind: 'file' | 'dir'; content?: string }[]
  /** Paths (relative to install dir) holding user data; kept on uninstall. */
  userData: string[]
  needsVcRedist: boolean
  /** How Game.path is turned into the {rom} argument. */
  romKind: 'file' | 'ps3' | 'wiiu' | 'vita'
  /** BIOS / firmware / keys checked and put in place before every launch. */
  firmware?: FirmwareItem[]
  /** Replaces the per-item messages with one listing everything missing. Placeholders: {missing} {bios}. */
  missingMessage?: string
  /** Settings written into the emulator's own config before every launch. */
  config?: ConfigEdit
  /** Extra downloads into the BIOS dir when the emulator is installed (best effort). */
  postInstall?: { label: string; url: string; to: string; unless?: string[] }[]
  notes?: string
}

export const STANDALONE_DEFS: StandaloneDef[] = defsJson as StandaloneDef[]

export function getStandaloneDef(id: string): StandaloneDef | undefined {
  return STANDALONE_DEFS.find((d) => d.id === id)
}

export interface InstallPaths {
  emulators: string
  downloads: string
  bios: string
}

export const standaloneDir = (paths: Pick<InstallPaths, 'emulators'>, id: string): string => join(paths.emulators, id)

function lookupRelease(def: StandaloneDef, pattern: RegExp, signal?: AbortSignal): Promise<ResolvedRelease> {
  switch (def.source.type) {
    case 'github':
      return githubRelease(def.source.repo, pattern, def.source.tag, signal)
    case 'forgejo':
      return forgejoLatestRelease(def.source.api, def.source.repo, pattern, signal)
    case 'dolphin':
      return dolphinLatest(def.source.url, signal)
  }
}

export async function resolveRelease(def: StandaloneDef, signal?: AbortSignal): Promise<ResolvedRelease> {
  const pattern = new RegExp(def.assetPattern)
  try {
    const rel = await lookupRelease(def, pattern, signal)
    // The feed chooses the URL; if it points somewhere unexpected, prefer the pinned fallback over failing later.
    if (!isTrustedDownloadUrl(rel.asset.url)) throw new Error(`${def.name} release feed returned an untrusted download URL: ${rel.asset.url}`)
    return rel
  } catch (e) {
    if (signal?.aborted || !def.fallback) throw e
    console.warn(`[emulators] release lookup for ${def.id} failed, using pinned fallback`, e)
    return { version: def.fallback.version, asset: { name: def.fallback.url.split('/').pop() ?? `${def.id}.${def.archiveType}`, url: def.fallback.url } }
  }
}

/** Download, extract and install a standalone emulator into <emulators>/<id>. Keeps existing user data. */
export async function installStandalone(def: StandaloneDef, paths: InstallPaths, task: ProgressSink, signal?: AbortSignal): Promise<{ version: string; exePath: string; sizeBytes: number }> {
  task.update(-1, `Finding latest ${def.name}`)
  const rel = await resolveRelease(def, signal)
  const archive = join(paths.downloads, rel.asset.name.replace(/[^\w.-]+/g, '_'))
  await downloadTrusted(rel.asset.url, archive, {
    signal,
    size: rel.asset.size,
    sha256: rel.asset.sha256,
    onProgress: (r, t) => task.update(t ? (r / t) * 0.8 : -1, downloadDetail(r, t))
  })
  const dir = standaloneDir(paths, def.id)
  const staging = join(paths.emulators, `.staging-${def.id}-${Date.now()}`)
  try {
    task.update(0.8, 'Extracting')
    await extractArchive(archive, staging, { signal, onProgress: (f) => task.update(0.8 + f * 0.17, `Extracting ${Math.round(f * 100)}%`) })
    const root = await singleTopFolder(staging)
    task.update(0.97, 'Installing')
    await moveMerge(root, dir)
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    await rm(archive, { force: true }).catch(() => undefined)
  }
  let exePath = join(dir, def.exe)
  if (!existsSync(exePath)) {
    const found = await findFile(dir, basename(def.exe), 3)
    if (!found) throw new Error(`${basename(def.exe)} not found after extracting ${rel.asset.name}`)
    exePath = found
  }
  await ensurePortable(def, dirname(exePath))
  return { version: rel.version, exePath, sizeBytes: await dirSize(dir) }
}

/** Create the portable-mode trigger files/dirs next to the exe. */
export async function ensurePortable(def: StandaloneDef, exeDir: string): Promise<void> {
  for (const p of def.portable) {
    const full = join(exeDir, p.path)
    if (existsSync(full)) continue
    if (p.kind === 'dir') await mkdir(full, { recursive: true })
    else await writeFile(full, p.content ?? '')
  }
}

// ---------------------------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------------------------

/** Replace {placeholders} in each arg. An arg that is exactly a placeholder with no value is dropped. */
export function expandArgs(template: string[], vars: Record<string, string | undefined>): string[] {
  const out: string[] = []
  for (const arg of template) {
    const whole = /^\{(\w+)\}$/.exec(arg)
    if (whole) {
      const v = vars[whole[1]!]
      if (v !== undefined && v !== '') out.push(v)
      continue
    }
    out.push(arg.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m))
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// ROM path resolution (folder games, Vita title IDs)
// ---------------------------------------------------------------------------------------------

/** Parse a PS3/PSP/Vita PARAM.SFO into key -> value. */
export function parseSfo(buf: Buffer): Record<string, string | number> {
  if (buf.length < 20 || buf.readUInt32BE(0) !== 0x00505346) throw new Error('Not a PARAM.SFO file')
  const keyTable = buf.readUInt32LE(8)
  const dataTable = buf.readUInt32LE(12)
  const count = buf.readUInt32LE(16)
  const out: Record<string, string | number> = {}
  for (let i = 0; i < count; i++) {
    const e = 20 + i * 16
    const keyOff = buf.readUInt16LE(e)
    const fmt = buf.readUInt16LE(e + 2)
    const len = buf.readUInt32LE(e + 4)
    const dataOff = buf.readUInt32LE(e + 12)
    const keyStart = keyTable + keyOff
    const keyEnd = buf.indexOf(0, keyStart)
    const key = buf.toString('utf8', keyStart, keyEnd < 0 ? undefined : keyEnd)
    const d = dataTable + dataOff
    if (fmt === 0x0404) out[key] = buf.readUInt32LE(d)
    else out[key] = buf.toString('utf8', d, d + len).replace(/\0+$/, '')
  }
  return out
}

/** Title IDs like PCSE00123 / PCSB01234 embedded in a file or folder name. */
export function titleIdFromName(name: string): string | undefined {
  return /(?:^|[^A-Z0-9])([A-Z]{4}\d{5})(?![0-9])/.exec(name.toUpperCase())?.[1]
}

const isDir = async (p: string) => (await stat(p).catch(() => null))?.isDirectory() ?? false

export interface RomResolution {
  vars: Record<string, string | undefined>
  /** Replace the default args template (e.g. Vita3K content-path install). */
  argsOverride?: string[]
}

/** Turn Game.path into placeholder values for a standalone emulator. Throws with a user-facing message. */
export async function resolveRom(def: StandaloneDef, gamePath: string): Promise<RomResolution> {
  switch (def.romKind) {
    case 'ps3': {
      if (!(await isDir(gamePath))) return { vars: { rom: gamePath } }
      for (const rel of ['PS3_GAME/USRDIR/EBOOT.BIN', 'USRDIR/EBOOT.BIN', 'EBOOT.BIN']) {
        const p = join(gamePath, ...rel.split('/'))
        if (existsSync(p)) return { vars: { rom: p } }
      }
      return { vars: { rom: gamePath } }
    }
    case 'wiiu': {
      if (!(await isDir(gamePath))) return { vars: { rom: gamePath } }
      const code = join(gamePath, 'code')
      const files = await readdir(code).catch(() => [] as string[])
      const rpx = files.find((f) => f.toLowerCase().endsWith('.rpx'))
      if (rpx) return { vars: { rom: join(code, rpx) } }
      throw new Error('This Wii U folder has no code/*.rpx file. Point RetroDesk at a decrypted (Loadiine) game folder or a .wua/.wux file.')
    }
    case 'vita': {
      let titleId: string | undefined
      if (await isDir(gamePath)) {
        const sfo = join(gamePath, 'sce_sys', 'param.sfo')
        if (existsSync(sfo)) {
          const v = parseSfo(await readFile(sfo)).TITLE_ID
          if (typeof v === 'string' && v) titleId = v
        }
      }
      titleId ??= titleIdFromName(basename(gamePath))
      if (titleId) return { vars: { titleId, rom: gamePath } }
      const ext = extname(gamePath).toLowerCase()
      if (ext === '.vpk' || ext === '.zip') return { vars: { rom: gamePath }, argsOverride: ['-F', gamePath] }
      if (ext === '.pkg') throw new Error('Vita .pkg files need a zRIF license key. Install the game once from Vita3K (Settings > Emulators > Vita3K), then add its title ID (e.g. [PCSE00123]) to the file name.')
      throw new Error('Unknown Vita title ID. Name the file or folder with its title ID, e.g. "Game [PCSE00123]", or use a .vpk to install it.')
    }
    default:
      return { vars: { rom: gamePath } }
  }
}

// ---------------------------------------------------------------------------------------------
// INI / TOML upsert (PCSX2.ini, DuckStation settings.ini, xemu.toml)
// ---------------------------------------------------------------------------------------------

/** Set `key` in `[section]` of an INI/TOML-ish text, adding the section/key if needed. Keeps everything else. */
export function upsertIni(text: string, section: string, key: string, value: string, sep = ' = '): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.length ? text.split(/\r?\n/) : []
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  const header = `[${section}]`
  let start = lines.findIndex((l) => l.trim() === header)
  if (start < 0) {
    if (lines.length && lines[lines.length - 1]!.trim() !== '') lines.push('')
    lines.push(header, `${key}${sep}${value}`)
    return lines.join(eol) + eol
  }
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[.*\]\s*$/.test(lines[i]!)) {
      end = i
      break
    }
  }
  const keyRe = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`)
  for (let i = start + 1; i < end; i++) {
    if (keyRe.test(lines[i]!)) {
      lines[i] = `${key}${sep}${value}`
      return lines.join(eol) + eol
    }
  }
  // Insert after the last non-blank line of the section.
  let at = end
  while (at > start + 1 && lines[at - 1]!.trim() === '') at--
  lines.splice(at, 0, `${key}${sep}${value}`)
  return lines.join(eol) + eol
}

export function readIniValue(text: string, section: string, key: string): string | undefined {
  let inSection = false
  for (const l of text.split(/\r?\n/)) {
    const h = /^\s*\[(.*)\]\s*$/.exec(l)
    if (h) {
      inSection = h[1] === section
      continue
    }
    if (!inSection) continue
    const m = /^\s*([^=]+?)\s*=\s*(.*?)\s*$/.exec(l)
    if (m && m[1] === key) return m[2]!.replace(/^['"]|['"]$/g, '')
  }
  return undefined
}

/** TOML literal string (no escapes needed for Windows paths). */
const tomlStr = (s: string) => (s.includes("'") ? JSON.stringify(s) : `'${s}'`)

// ---------------------------------------------------------------------------------------------
// BIOS / firmware provisioning per emulator
// ---------------------------------------------------------------------------------------------

export interface ProvisionResult {
  ok: boolean
  /** User-facing explanation when !ok. */
  error?: string
}

const PS2_BIOS_SIZE = 4 * 1024 * 1024

/** PS2 BIOS candidates: everything in <bios>/ps2, plus 4 MB .bin/.rom files in <bios>. */
export async function findPs2Bios(biosDir: string): Promise<string[]> {
  const out: string[] = []
  const ps2 = join(biosDir, 'ps2')
  for (const f of await readdir(ps2).catch(() => [] as string[])) {
    const p = join(ps2, f)
    if ((await stat(p).catch(() => null))?.isFile()) out.push(p)
  }
  for (const f of await readdir(biosDir).catch(() => [] as string[])) {
    if (!/\.(bin|rom0?)$/i.test(f) || /mcpx|complex|dc_|saturn|scph[0-9]{4}\.bin$/i.test(f)) continue
    const p = join(biosDir, f)
    const st = await stat(p).catch(() => null)
    if (st?.isFile() && st.size === PS2_BIOS_SIZE) out.push(p)
  }
  return out
}

/** Files directly in `dir` whose name matches `re`. */
export async function globFiles(dir: string, re: RegExp): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries.filter((e) => e.isFile() && re.test(e.name)).map((e) => join(dir, e.name))
}

/** Searches a firmware item can name when a file name or pattern is not enough. */
const FINDERS: Record<string, (biosDir: string) => Promise<string[]>> = {
  ps2Bios: findPs2Bios
}

/** Config edits a `set` list cannot express. Given the config text and the exe dir. */
const CONFIG_HOOKS: Record<string, (text: string, exeDir: string) => Promise<string>> = {
  /** Keep the chosen PS2 BIOS if it is still there, else pick one (a .bin for preference). */
  async pcsx2BiosFile(text, exeDir) {
    const target = join(exeDir, 'bios')
    const files = (await readdir(target).catch(() => [] as string[])).filter((f) => !f.startsWith('.'))
    if (!files.length) return text
    const current = readIniValue(text, 'Filenames', 'BIOS')
    if (current && existsSync(join(target, current))) return text
    return upsertIni(text, 'Filenames', 'BIOS', files.find((f) => /\.bin$/i.test(f)) ?? files[0]!)
  }
}

const rel = (base: string, path: string): string => join(base, ...path.split('/').filter(Boolean))

async function findFirmware(item: FirmwareItem, biosDir: string): Promise<string[]> {
  let found: string[] = []
  if (item.finder) found = (await FINDERS[item.finder]?.(biosDir)) ?? []
  else {
    for (const d of item.dirs ?? ['']) {
      const dir = rel(biosDir, d)
      if (item.name) {
        if (existsSync(join(dir, item.name))) found.push(join(dir, item.name))
      } else if (item.pattern) found.push(...(await globFiles(dir, new RegExp(item.pattern, 'i'))))
    }
  }
  return item.all ? found : found.slice(0, 1)
}

async function isInstalled(item: FirmwareItem, exeDir: string): Promise<boolean> {
  const i = item.installed
  if (!i) return false
  if (i.anyOf?.some((p) => existsSync(rel(exeDir, p)))) return true
  if (i.nonEmptyDir && (await readdir(rel(exeDir, i.nonEmptyDir)).catch(() => [] as string[])).some((f) => !f.startsWith('.'))) return true
  if (i.dirNamed && (await findDir(exeDir, i.dirNamed, i.depth ?? 3)) !== undefined) return true
  return false
}

async function copyFirmware(item: FirmwareItem, files: string[], exeDir: string): Promise<void> {
  if (!item.copyTo) return
  const intoDir = item.copyTo.endsWith('/')
  for (const src of files) {
    const dst = intoDir ? join(rel(exeDir, item.copyTo), basename(src)) : rel(exeDir, item.copyTo)
    const stale = item.copyWhen === 'newer' && existsSync(dst) && (await stat(src)).mtimeMs > (await stat(dst)).mtimeMs
    if (existsSync(dst) && !stale) continue
    await mkdir(dirname(dst), { recursive: true })
    await copyFile(src, dst)
  }
}

/**
 * Point a standalone emulator at RetroDesk's BIOS dir / copy what it needs, and check required firmware, as
 * declared by the def's `firmware` and `config`. Called right before every launch (and is cheap when already done).
 */
export async function provisionStandalone(def: StandaloneDef, exeDir: string, biosDir: string): Promise<ProvisionResult> {
  const found: Record<string, string> = {}
  const problems: { item: FirmwareItem; error: string }[] = []
  for (const item of def.firmware ?? []) {
    const files = await findFirmware(item, biosDir)
    if (item.id && files[0]) found[item.id] = files[0]
    let installed = await isInstalled(item, exeDir)
    if (files.length && !(item.copyWhen === 'notInstalled' && installed)) {
      await copyFirmware(item, files, exeDir)
      if (item.copyTo) installed = await isInstalled(item, exeDir)
    }
    const ready = item.installed ? installed || (files.length > 0 && !item.manual && !item.copyTo) : files.length > 0
    if (ready || !item.required) continue
    const text = files[0] && item.manual ? item.manual.replaceAll('{file}', files[0]) : (item.message ?? `${def.name} needs ${item.label} in {bios}.`)
    problems.push({ item, error: text.replaceAll('{bios}', biosDir) })
  }

  if (def.config) {
    const cfg = def.config
    const hook = cfg.hook ? CONFIG_HOOKS[cfg.hook] : undefined
    const before = existsSync(rel(exeDir, cfg.file)) ? await readFile(rel(exeDir, cfg.file), 'utf8') : ''
    let after = before
    for (const e of cfg.set) {
      let skip = false
      const value = e.value.replace(/\{(\w+)\}/g, (m, k: string) => {
        if (k === 'bios') return biosDir
        if (found[k] === undefined) skip = true
        return found[k] ?? m
      })
      if (!skip) after = upsertIni(after, e.section, e.key, e.quote === 'toml' ? tomlStr(value) : value)
    }
    if (hook) after = await hook(after, exeDir)
    if (after !== before) {
      await mkdir(dirname(rel(exeDir, cfg.file)), { recursive: true })
      await writeFile(rel(exeDir, cfg.file), after)
    }
  }

  if (!problems.length) return { ok: true }
  if (def.missingMessage) {
    return { ok: false, error: def.missingMessage.replaceAll('{missing}', problems.map((p) => p.item.label).join(', ')).replaceAll('{bios}', biosDir) }
  }
  return { ok: false, error: problems[0]!.error }
}

async function findDir(root: string, name: string, depth: number): Promise<string | undefined> {
  let level = [root]
  for (let d = 0; d <= depth && level.length; d++) {
    const next: string[] = []
    for (const dir of level) {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const e of entries) {
        if (!e.isDirectory()) continue
        if (e.name.toLowerCase() === name) return join(dir, e.name)
        next.push(join(dir, e.name))
      }
    }
    level = next
  }
  return undefined
}

/** Extra files fetched into the BIOS dir when installing an emulator (e.g. xemu's prebuilt HDD image). Best effort. */
export async function postInstall(def: StandaloneDef, paths: InstallPaths, task: ProgressSink, signal?: AbortSignal): Promise<void> {
  for (const d of def.postInstall ?? []) {
    if ([d.to, ...(d.unless ?? [])].some((p) => existsSync(rel(paths.bios, p)))) continue
    task.update(-1, `Downloading ${d.label}`)
    try {
      await downloadTrusted(d.url, rel(paths.bios, d.to), { signal, onProgress: (r, t) => task.update(t ? r / t : -1, downloadDetail(r, t)) })
    } catch (e) {
      console.warn(`[emulators] ${d.label} download failed`, e)
    }
  }
}

// ---------------------------------------------------------------------------------------------
// VC++ runtime
// ---------------------------------------------------------------------------------------------

export const VC_REDIST_URL = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'

/** True if the VC++ 2015-2022 x64 runtime DLLs are present in System32. */
export function hasVcRedist(): boolean {
  if (process.platform !== 'win32') return true
  const sys32 = join(process.env['SystemRoot'] ?? 'C:\\Windows', process.arch === 'ia32' ? 'Sysnative' : 'System32')
  return ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll'].every((f) => existsSync(join(sys32, f)))
}

export const vcRedistMessage = (name: string): string =>
  `${name} needs the Microsoft Visual C++ 2015-2022 runtime (x64), which is not installed. Download it from ${VC_REDIST_URL}, run it, then try again.`
