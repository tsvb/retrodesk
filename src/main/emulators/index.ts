// Emulator manager: install / uninstall / list RetroArch, cores and standalone emulators.
import { spawn } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { rm } from 'fs/promises'
import { dirname, join } from 'path'
import type { RetroDeskApi } from '../../shared/api'
import type { EmulatorStatus } from '../../shared/types'
import { createTask } from '../events'
import { getPaths } from '../paths'
import { getNativeGamepads } from '../gamepads'
import { getSettings } from '../settings'
import { getSystemDef, getSystemDefs } from '../systems'
import { dirSize, removeExcept } from './extract'
import { allRefs, systemChosenRef, type EmuRef } from './keys'
import { getEntry, getInstalled, loadManifest, recordInstall, removeEntry } from './manifest'
import { buildRetroArchArgs, coreBasenames, coreDisplayName, coreFileBase, coreLibPath, installCore, installRetroArch, RA_ID, raDir, raExe, writeAppendConfig } from './retroarch'
import { getStandaloneDef, hasVcRedist, installStandalone, postInstall, STANDALONE_DEFS, standaloneDir, type StandaloneDef } from './standalone'

export { parseEmulatorKey, refKey, refStatusId, resolveGameRef } from './keys'

// ---------------------------------------------------------------------------------------------
// Installed-state queries (sync; used by isSystemPlayable and the launcher)
// ---------------------------------------------------------------------------------------------

let coreCache: { at: number; dir: string; set: Set<string> } | null = null

function installedCoreSet(): Set<string> {
  const dir = join(raDir(getPaths()), 'cores')
  if (coreCache && coreCache.dir === dir && Date.now() - coreCache.at < 3000) return coreCache.set
  let set = new Set<string>()
  try {
    set = coreBasenames(readdirSync(dir))
  } catch {
    /* no cores dir */
  }
  coreCache = { at: Date.now(), dir, set }
  return set
}

const invalidateCores = () => {
  coreCache = null
}

/** The folder shown for an installed executable: on macOS the one holding its app bundle, not Contents/MacOS. */
export function installDirOf(exe: string): string {
  return /^(.*)[\\/][^\\/]+\.app[\\/]Contents[\\/]MacOS[\\/][^\\/]+$/i.exec(exe)?.[1] ?? dirname(exe)
}

/** RetroArch exe if installed (manifest, or an adopted pre-existing install). */
export function retroArchExe(): string | undefined {
  const m = getInstalled(RA_ID)
  if (m) return m.absExePath
  const exe = raExe(getPaths())
  return existsSync(exe) ? exe : undefined
}

export function isCoreInstalled(core: string): boolean {
  return installedCoreSet().has(coreFileBase(core).toLowerCase())
}

/** Standalone exe if installed. */
export function standaloneExe(id: string): string | undefined {
  const m = getInstalled(id)
  if (m) return m.absExePath
  const def = getStandaloneDef(id)
  if (!def) return undefined
  const exe = join(standaloneDir(getPaths(), id), def.exe)
  return existsSync(exe) ? exe : undefined
}

export function isRefInstalled(ref: EmuRef): boolean {
  return ref.type === 'retroarch' ? !!retroArchExe() && isCoreInstalled(ref.core) : !!standaloneExe(ref.id)
}

export function isSystemPlayable(systemId: string): boolean {
  if (systemId === 'steam') return true
  const sys = getSystemDef(systemId)
  if (!sys) return false
  const chosen = systemChosenRef(sys, getSettings())
  if (chosen && isRefInstalled(chosen)) return true
  return allRefs(sys).some(isRefInstalled)
}

// ---------------------------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------------------------

function systemsForCore(core: string): string[] {
  const base = coreFileBase(core)
  return getSystemDefs()
    .filter((s) => s.emulators.some((e) => e.type === 'retroarch' && coreFileBase(e.core) === base))
    .map((s) => s.id)
}

function systemsForStandalone(def: StandaloneDef): string[] {
  const fromDefs = getSystemDefs()
    .filter((s) => s.emulators.some((e) => e.type === 'standalone' && e.id === def.id))
    .map((s) => s.id)
  return [...new Set([...fromDefs, ...def.systems])]
}

/** Every core referenced by systems.json, keyed by the exact `core` string used there. */
function referencedCores(): string[] {
  const seen = new Map<string, string>()
  for (const s of getSystemDefs()) for (const e of s.emulators) if (e.type === 'retroarch' && !seen.has(coreFileBase(e.core))) seen.set(coreFileBase(e.core), e.core)
  return [...seen.values()]
}

function statusFor(id: string): EmulatorStatus {
  const paths = getPaths()
  if (id === RA_ID) {
    const exe = retroArchExe()
    const e = getEntry(RA_ID)
    return {
      id,
      kind: 'retroarch',
      name: 'RetroArch',
      systems: [...new Set(referencedCores().flatMap(systemsForCore))],
      installed: !!exe,
      version: exe ? e?.version : undefined,
      installPath: exe ? installDirOf(exe) : undefined,
      sizeBytes: exe ? e?.sizeBytes : undefined
    }
  }
  if (id.startsWith('core:')) {
    const core = id.slice(5)
    const installed = isCoreInstalled(core)
    const e = getEntry(id)
    return {
      id,
      kind: 'core',
      name: coreDisplayName(core),
      systems: systemsForCore(core),
      installed,
      version: installed ? e?.version : undefined,
      installPath: installed ? coreLibPath(paths, core) : undefined,
      sizeBytes: installed ? e?.sizeBytes : undefined
    }
  }
  const def = getStandaloneDef(id)
  if (!def) throw new Error(`Unknown emulator "${id}"`)
  const exe = standaloneExe(id)
  const e = getEntry(id)
  return {
    id,
    kind: 'standalone',
    name: def.name,
    systems: systemsForStandalone(def),
    installed: !!exe,
    version: exe ? e?.version : undefined,
    installPath: exe ? installDirOf(exe) : undefined,
    sizeBytes: exe ? e?.sizeBytes : undefined
  }
}

/** Normalise 'core:snes9x' / 'core:snes9x_libretro' to the exact core string used in systems.json. */
function normaliseId(id: string): string {
  if (id.startsWith('core:')) {
    const base = coreFileBase(id.slice(5))
    return `core:${referencedCores().find((c) => coreFileBase(c) === base) ?? id.slice(5)}`
  }
  if (id.startsWith('standalone:')) return id.slice('standalone:'.length)
  if (id.startsWith('retroarch:')) return `core:${id.slice('retroarch:'.length)}`
  return id
}

// ---------------------------------------------------------------------------------------------
// Install / uninstall
// ---------------------------------------------------------------------------------------------

const inflight = new Map<string, Promise<EmulatorStatus>>()

async function doInstall(id: string): Promise<EmulatorStatus> {
  const paths = getPaths()
  if (id === RA_ID) {
    const task = createTask('Installing RetroArch', { kind: 'emulator', id })
    try {
      const r = await installRetroArch(paths, task)
      recordInstall({ id, version: r.version, installedAt: Date.now(), exePath: r.exePath, sizeBytes: await dirSize(raDir(paths)) })
      task.done(`RetroArch ${r.version}`)
    } catch (e) {
      task.fail(e)
      throw e
    }
    return statusFor(id)
  }
  if (id.startsWith('core:')) {
    const core = id.slice(5)
    const task = createTask(`Installing ${coreDisplayName(core)}`, { kind: 'emulator', id })
    try {
      const r = await installCore(core, paths, task)
      invalidateCores()
      recordInstall({ id, version: r.version, installedAt: Date.now(), exePath: r.exePath, sizeBytes: r.sizeBytes })
      task.done(retroArchExe() || inflight.has(RA_ID) ? r.version : `${r.version} (RetroArch not installed yet)`)
    } catch (e) {
      task.fail(e)
      throw e
    }
    return statusFor(id)
  }
  const def = getStandaloneDef(id)
  if (!def) throw new Error(`Unknown emulator "${id}"`)
  const task = createTask(`Installing ${def.name}`, { kind: 'emulator', id })
  try {
    const r = await installStandalone(def, paths, task)
    recordInstall({ id, version: r.version, installedAt: Date.now(), exePath: r.exePath, sizeBytes: r.sizeBytes })
    await postInstall(def, paths, task)
    task.done(def.needsVcRedist && !hasVcRedist() ? `${r.version} - needs the Microsoft Visual C++ runtime (aka.ms/vs/17/release/vc_redist.x64.exe)` : r.version)
  } catch (e) {
    task.fail(e)
    throw e
  }
  return statusFor(id)
}

export async function installEmulator(rawId: string): Promise<EmulatorStatus> {
  const id = normaliseId(rawId)
  if (id !== RA_ID && !id.startsWith('core:') && !getStandaloneDef(id)) throw new Error(`Unknown emulator "${rawId}"`)
  const running = inflight.get(id)
  if (running) return running
  const p = doInstall(id).finally(() => inflight.delete(id))
  inflight.set(id, p)
  return p
}

export async function uninstallEmulator(rawId: string): Promise<void> {
  const id = normaliseId(rawId)
  const paths = getPaths()
  if (id === RA_ID) {
    // Saves/states/screenshots live in the RetroDesk data root, so the whole folder (incl. cores) can go.
    await rm(raDir(paths), { recursive: true, force: true, maxRetries: 3 })
    for (const k of Object.keys(loadManifest().emulators)) if (k === RA_ID || k.startsWith('core:')) removeEntry(k)
    invalidateCores()
    return
  }
  if (id.startsWith('core:')) {
    await rm(coreLibPath(paths, id.slice(5)), { force: true })
    removeEntry(id)
    invalidateCores()
    return
  }
  const def = getStandaloneDef(id)
  if (!def) throw new Error(`Unknown emulator "${rawId}"`)
  // Keep portable user data (memory cards, Switch NAND, Dolphin User/...) so a reinstall picks it back up.
  await removeExcept(standaloneDir(paths, id), def.userData)
  removeEntry(id)
}

export async function installForSystem(systemId: string): Promise<void> {
  const sys = getSystemDef(systemId)
  if (!sys) throw new Error(`Unknown system "${systemId}"`)
  const ref = systemChosenRef(sys, getSettings())
  if (!ref) throw new Error(`No emulator is known for ${sys.name}`)
  if (isRefInstalled(ref)) return
  const task = createTask(`Setting up ${sys.name}`, { kind: 'system', id: systemId })
  try {
    if (ref.type === 'retroarch') {
      // RetroArch and the core install side by side (retroarch.ts serializes their moves into the RetroArch folder).
      const jobs = [...(retroArchExe() ? [] : [{ name: 'RetroArch', id: RA_ID }]), ...(isCoreInstalled(ref.core) ? [] : [{ name: coreDisplayName(ref.core), id: `core:${ref.core}` }])]
      const pending = new Set(jobs.map((j) => j.name))
      const report = () => task.update((jobs.length - pending.size) / jobs.length, `Installing ${[...pending].join(' and ')}`)
      report()
      const results = await Promise.allSettled(
        jobs.map((j) =>
          installEmulator(j.id).then(() => {
            pending.delete(j.name)
            if (pending.size) report()
          })
        )
      )
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (failed) throw failed.reason
    } else {
      task.update(-1, `Installing ${getStandaloneDef(ref.id)?.name ?? ref.id}`)
      await installEmulator(ref.id)
    }
    task.done(`${sys.name} is ready to play`)
  } catch (e) {
    task.fail(e)
    throw e
  }
}

/** Launch an emulator's own UI (no game). Not tracked as a session. */
export async function openEmulatorUi(rawId: string): Promise<void> {
  const id = normaliseId(rawId)
  if (id === RA_ID || id.startsWith('core:')) {
    const exe = retroArchExe()
    if (!exe) throw new Error('RetroArch is not installed')
    const { cfgPath, mainCfg } = await writeAppendConfig(getSettings(), getPaths(), true, getNativeGamepads()?.[0]?.id)
    spawnDetached(exe, buildRetroArchArgs({ appendCfg: cfgPath, mainCfg }), dirname(exe))
    return
  }
  const def = getStandaloneDef(id)
  if (!def) throw new Error(`Unknown emulator "${rawId}"`)
  const exe = standaloneExe(id)
  if (!exe) throw new Error(`${def.name} is not installed`)
  spawnDetached(exe, def.uiArgs, dirname(exe))
}

function spawnDetached(exe: string, args: string[], cwd: string): void {
  const child = spawn(exe, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false })
  child.on('error', (e) => console.error(`[emulators] failed to start ${exe}`, e))
  child.unref()
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

export async function initEmulators(): Promise<void> {
  loadManifest(true)
  invalidateCores()
  // Adopt a RetroArch that was extracted/copied there manually.
  if (!getEntry(RA_ID) && existsSync(raExe(getPaths()))) {
    recordInstall({ id: RA_ID, version: 'unknown', installedAt: Date.now(), exePath: raExe(getPaths()), sizeBytes: 0 })
  }
}

export function listEmulators(): EmulatorStatus[] {
  const ids = [RA_ID, ...referencedCores().map((c) => `core:${c}`), ...STANDALONE_DEFS.map((d) => d.id)]
  return ids.map(statusFor)
}

export const emulatorsHandlers: RetroDeskApi['emulators'] = {
  async list() {
    return listEmulators()
  },
  install: installEmulator,
  uninstall: uninstallEmulator,
  installForSystem,
  openEmulatorUi
}
