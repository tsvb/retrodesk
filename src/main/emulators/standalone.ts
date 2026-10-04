// Standalone emulators: release discovery, install (download + extract + portable trigger), argument templating,
// ROM path resolution for folder-format games and BIOS/config provisioning.
import { existsSync } from 'fs'
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import defsJson from '../data/standalone-emulators.json'
import { dolphinLatest, downloadFile, forgejoLatestRelease, githubRelease, type ResolvedRelease } from './download'
import { dirSize, extractArchive, findFile, moveMerge, singleTopFolder } from './extract'
import { downloadDetail, type ProgressSink } from './retroarch'

export type ReleaseSource =
  | { type: 'github'; repo: string; tag?: string }
  | { type: 'forgejo'; api: string; repo: string }
  | { type: 'dolphin'; url: string }

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
  portable: { path: string; kind: 'file' | 'dir' }[]
  /** Paths (relative to install dir) holding user data; kept on uninstall. */
  userData: string[]
  needsVcRedist: boolean
  /** How Game.path is turned into the {rom} argument. */
  romKind: 'file' | 'ps3' | 'wiiu' | 'vita'
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

export async function resolveRelease(def: StandaloneDef, signal?: AbortSignal): Promise<ResolvedRelease> {
  const pattern = new RegExp(def.assetPattern)
  try {
    switch (def.source.type) {
      case 'github':
        return await githubRelease(def.source.repo, pattern, def.source.tag, signal)
      case 'forgejo':
        return await forgejoLatestRelease(def.source.api, def.source.repo, pattern, signal)
      case 'dolphin':
        return await dolphinLatest(def.source.url, signal)
    }
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
  await downloadFile(rel.asset.url, archive, { signal, onProgress: (r, t) => task.update(t ? (r / t) * 0.8 : -1, downloadDetail(r, t)) })
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
    else if (def.id === 'xemu') await writeFile(full, '[general]\nshow_welcome = false\n')
    else await writeFile(full, '')
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

async function editFile(path: string, edit: (text: string) => string): Promise<void> {
  const before = existsSync(path) ? await readFile(path, 'utf8') : ''
  const after = edit(before)
  if (after !== before) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, after)
  }
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

function firstExisting(cands: string[]): string | undefined {
  return cands.find((c) => existsSync(c))
}

/**
 * Point a standalone emulator at RetroDesk's BIOS dir / copy what it needs, and check required firmware.
 * Called right before every launch (and is cheap when already done).
 */
export async function provisionStandalone(def: StandaloneDef, exeDir: string, biosDir: string): Promise<ProvisionResult> {
  switch (def.id) {
    case 'pcsx2': {
      const target = join(exeDir, 'bios')
      await mkdir(target, { recursive: true })
      for (const src of await findPs2Bios(biosDir)) {
        const dst = join(target, basename(src))
        if (!existsSync(dst)) await copyFile(src, dst)
      }
      const files = (await readdir(target).catch(() => [] as string[])).filter((f) => !f.startsWith('.'))
      if (!files.length) return { ok: false, error: `PS2 needs a BIOS dump. Put your PS2 BIOS (e.g. SCPH-70012.bin) in ${join(biosDir, 'ps2')}.` }
      const ini = join(exeDir, 'inis', 'PCSX2.ini')
      await editFile(ini, (t) => {
        let out = upsertIni(t, 'UI', 'SetupWizardIncomplete', 'false')
        out = upsertIni(out, 'UI', 'ConfirmShutdown', 'false')
        out = upsertIni(out, 'Folders', 'Bios', 'bios')
        const current = readIniValue(out, 'Filenames', 'BIOS')
        if (!current || !existsSync(join(target, current))) {
          const preferred = files.find((f) => /\.bin$/i.test(f)) ?? files[0]!
          out = upsertIni(out, 'Filenames', 'BIOS', preferred)
        }
        return out
      })
      return { ok: true }
    }
    case 'duckstation': {
      await editFile(join(exeDir, 'settings.ini'), (t) => {
        let out = upsertIni(t, 'Main', 'SetupWizardIncomplete', 'false')
        out = upsertIni(out, 'Main', 'ConfirmPowerOff', 'false')
        return upsertIni(out, 'BIOS', 'SearchDirectory', biosDir)
      })
      return { ok: true }
    }
    case 'xemu': {
      const find = (name: string) => firstExisting([join(biosDir, name), join(biosDir, 'xbox', name)])
      const mcpx = find('mcpx_1.0.bin')
      const flash = (await globFiles(biosDir, /^complex_4627.*\.bin$/i))[0] ?? (await globFiles(join(biosDir, 'xbox'), /^complex_4627.*\.bin$/i))[0]
      const hdd = find('xbox_hdd.qcow2')
      const missing = [!mcpx && 'mcpx_1.0.bin', !flash && 'Complex_4627.bin', !hdd && 'xbox_hdd.qcow2'].filter(Boolean)
      await editFile(join(exeDir, 'xemu.toml'), (t) => {
        let out = upsertIni(t, 'general', 'show_welcome', 'false')
        if (mcpx) out = upsertIni(out, 'sys.files', 'bootrom_path', tomlStr(mcpx))
        if (flash) out = upsertIni(out, 'sys.files', 'flashrom_path', tomlStr(flash))
        if (hdd) out = upsertIni(out, 'sys.files', 'hdd_path', tomlStr(hdd))
        return out
      })
      if (missing.length) return { ok: false, error: `Xbox needs ${missing.join(', ')} in ${biosDir}.` }
      return { ok: true }
    }
    case 'eden': {
      const keysDir = join(exeDir, 'user', 'keys')
      await mkdir(keysDir, { recursive: true })
      for (const k of ['prod.keys', 'title.keys']) {
        const src = firstExisting([join(biosDir, k), join(biosDir, 'switch', k)])
        const dst = join(keysDir, k)
        if (src && (!existsSync(dst) || (await stat(src)).mtimeMs > (await stat(dst)).mtimeMs)) await copyFile(src, dst)
      }
      if (!existsSync(join(keysDir, 'prod.keys'))) return { ok: false, error: `Switch games need your prod.keys. Put it in ${biosDir} (or ${join(biosDir, 'switch')}).` }
      // Firmware install == copying the firmware NCAs into nand/system/Contents/registered (what Eden's installer does).
      const fw = join(exeDir, 'user', 'nand', 'system', 'Contents', 'registered')
      if (!(await readdir(fw).catch(() => [] as string[])).length) {
        const ncas = await globFiles(join(biosDir, 'switch', 'firmware'), /\.nca$/i)
        if (!ncas.length) {
          return { ok: false, error: `Switch firmware is not installed. Put your firmware dump (*.nca files) in ${join(biosDir, 'switch', 'firmware')}, or install it from Eden (Tools > Install Firmware).` }
        }
        await mkdir(fw, { recursive: true })
        for (const n of ncas) await copyFile(n, join(fw, basename(n)))
      }
      return { ok: true }
    }
    case 'rpcs3': {
      const fwInstalled = existsSync(join(exeDir, 'dev_flash', 'vsh', 'module')) || existsSync(join(exeDir, 'dev_flash', 'sys', 'external'))
      if (fwInstalled) return { ok: true }
      const pup = firstExisting([join(biosDir, 'PS3UPDAT.PUP'), join(biosDir, 'ps3', 'PS3UPDAT.PUP')])
      if (!pup) return { ok: false, error: `PS3 games need the official firmware. Download PS3UPDAT.PUP from playstation.com and put it in ${biosDir}.` }
      return { ok: false, error: `PS3 firmware is not installed in RPCS3 yet. Open RPCS3 (Settings > Emulators) and use File > Install Firmware with ${pup}.` }
    }
    case 'vita3k': {
      const pup = firstExisting([join(biosDir, 'PSVUPDAT.PUP'), join(biosDir, 'vita', 'PSVUPDAT.PUP')])
      const installed = (await findDir(exeDir, 'vs0', 3)) !== undefined
      if (!installed && !pup) return { ok: false, error: `Vita games need the official firmware. Put PSVUPDAT.PUP in ${biosDir}, then install it from Vita3K.` }
      return { ok: true }
    }
    default:
      return { ok: true }
  }
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

/** Extra files fetched when installing an emulator (e.g. xemu's prebuilt HDD image into the BIOS dir). */
export async function postInstall(def: StandaloneDef, paths: InstallPaths, task: ProgressSink, signal?: AbortSignal): Promise<void> {
  if (def.id === 'xemu') {
    const hdd = join(paths.bios, 'xbox_hdd.qcow2')
    if (!existsSync(hdd) && !existsSync(join(paths.bios, 'xbox', 'xbox_hdd.qcow2'))) {
      task.update(-1, 'Downloading Xbox HDD image')
      try {
        await downloadFile('https://github.com/xemu-project/xemu-dashboard/releases/latest/download/xbox_hdd.qcow2', hdd, { signal, onProgress: (r, t) => task.update(t ? r / t : -1, downloadDetail(r, t)) })
      } catch (e) {
        console.warn('[emulators] xbox_hdd.qcow2 download failed', e)
      }
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
