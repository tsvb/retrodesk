// Game launcher + session tracking + Game Assist quick actions.
import { spawn, spawnSync, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { app, globalShortcut, shell } from 'electron'
import type { RetroDeskApi } from '../../shared/api'
import type { Game, LaunchResult, QuickAction, SessionInfo } from '../../shared/types'
import { createTask, emitSession } from '../events'
import { getGameById, recordPlaySession } from '../library'
import { getPaths } from '../paths'
import { getSettings, onSettingsChanged } from '../settings'
import { getSystemDef } from '../systems'
import { capturePowerState, restorePowerState, setPerformanceMode, type PowerState } from '../system'
import { destroyOverlay, focusMainWindow, isOverlayActive, onOverlayActiveChanged, setOverlayActive, showOverlay } from '../windows'
import { isRefInstalled, refKey, refStatusId, resolveGameRef, retroArchExe, standaloneExe } from '../emulators'
import type { EmuRef } from '../emulators/keys'
import { buildRetroArchArgs, coreDisplayName, coreDllPath, ensureCoreSystemAssets, RA_NETWORK_PORT, raDir, writeAppendConfig } from '../emulators/retroarch'
import { expandArgs, getStandaloneDef, hasVcRedist, provisionStandalone, resolveRom, vcRedistMessage } from '../emulators/standalone'
import { autoFetchableCore, describeMissing, missingBios } from './bios'
import { FocusHelper } from './focus'
import { RaCommandClient } from './racommand'

const QUIT_GRACE_MS = 4000

interface ActiveSession {
  info: SessionInfo
  child: ChildProcess
  ra: RaCommandClient | null
  /** We paused RetroArch when the overlay opened (so we unpause on close). */
  pausedByUs: boolean
  power?: PowerState
  quitTimer?: NodeJS.Timeout
  exited: boolean
  /** Serialises overlay pause/resume work. */
  chain: Promise<void>
}

let active: ActiveSession | null = null
let launching = false
let registeredAccelerator: string | null = null
const focusHelper = new FocusHelper()

// ---------------------------------------------------------------------------------------------
// Command building (exported for tests / integration)
// ---------------------------------------------------------------------------------------------

export interface LaunchPlan {
  exe: string
  args: string[]
  cwd: string
  ref: EmuRef
  supportsCommands: boolean
}

type PlanResult = { ok: true; plan: LaunchPlan } | Extract<LaunchResult, { ok: false }>

/** Resolve emulator, check install/BIOS/runtime and build the command line for a game. */
export async function planLaunch(game: Game): Promise<PlanResult> {
  const system = getSystemDef(game.systemId)
  if (!system) return { ok: false, error: `Unknown system "${game.systemId}"` }
  const settings = getSettings()
  const paths = getPaths()
  const ref = resolveGameRef(game, system, settings)
  if (!ref) return { ok: false, error: `No emulator is configured for ${system.name}.` }
  const emuName = ref.type === 'retroarch' ? `${coreDisplayName(ref.core)} (RetroArch)` : (getStandaloneDef(ref.id)?.name ?? ref.id)

  if (!isRefInstalled(ref)) {
    // For RetroArch + core, point the UI at whichever piece is missing.
    const emulatorId = ref.type === 'retroarch' && !retroArchExe() ? 'retroarch' : refStatusId(ref)
    return { ok: false, needs: 'emulator', emulatorId, error: `${emuName} is not installed yet.` }
  }
  if (!existsSync(game.path)) return { ok: false, error: `Game file not found: ${game.path}` }

  // Core asset packs (PPSSPP, blueMSX) are fetched automatically.
  const assetCore = autoFetchableCore(ref)
  if (assetCore) {
    try {
      await ensureCoreSystemAssets(assetCore, paths)
    } catch (e) {
      console.warn('[launch] asset pack download failed', e)
    }
  }
  const missing = missingBios({ system, ref, biosDir: paths.bios, romPath: game.path })
  if (missing.length) return { ok: false, needs: 'bios', error: describeMissing(system.name, missing, paths.bios) }

  if (ref.type === 'retroarch') {
    const exe = retroArchExe()!
    const { cfgPath, shaderPath } = await writeAppendConfig(settings, paths)
    return {
      ok: true,
      plan: { exe, cwd: dirname(exe), ref, supportsCommands: true, args: buildRetroArchArgs({ coreDll: coreDllPath(paths, ref.core), rom: game.path, appendCfg: cfgPath, shaderPath }) }
    }
  }

  const def = getStandaloneDef(ref.id)
  if (!def) return { ok: false, error: `Unknown emulator "${ref.id}"` }
  const exe = standaloneExe(ref.id)!
  if (def.needsVcRedist && !hasVcRedist()) return { ok: false, error: vcRedistMessage(def.name) }
  const prov = await provisionStandalone(def, dirname(exe), paths.bios)
  if (!prov.ok) return { ok: false, needs: 'bios', error: prov.error ?? `${def.name} is missing firmware.` }
  let rom
  try {
    rom = await resolveRom(def, game.path)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  const args = rom.argsOverride ?? expandArgs(def.args, { ...rom.vars, exeDir: dirname(exe) })
  return { ok: true, plan: { exe, cwd: dirname(exe), ref, supportsCommands: false, args } }
}

// ---------------------------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------------------------

const publicInfo = (): SessionInfo | null => (active ? { ...active.info } : null)

function startProcess(plan: LaunchPlan): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(plan.exe, plan.args, { cwd: plan.cwd, stdio: 'ignore', windowsHide: false, detached: false })
    child.once('spawn', () => resolve(child))
    child.once('error', reject)
  })
}

export async function launchGame(gameId: string): Promise<LaunchResult> {
  if (active && !active.exited) {
    if (active.info.gameId === gameId) return { ok: true, session: publicInfo()! }
    return { ok: false, error: `${active.info.title} is still running. Quit it first.` }
  }
  if (launching) return { ok: false, error: 'A game is already starting.' }
  launching = true
  try {
    const game = await getGameById(gameId)
    if (!game) return { ok: false, error: 'Game not found.' }

    if (game.systemId === 'steam') {
      const startedAt = Date.now()
      await shell.openExternal(game.path)
      await Promise.resolve(recordPlaySession(game.id, startedAt, 0)).catch((e) => console.warn('[launch] recordPlaySession failed', e))
      return { ok: true, session: { gameId: game.id, title: game.title, systemId: game.systemId, emulatorId: 'steam', supportsCommands: false, startedAt, stateSlot: 0 } }
    }

    const planned = await planLaunch(game)
    if (!planned.ok) return planned
    const { plan } = planned

    let ra: RaCommandClient | null = null
    if (plan.ref.type === 'retroarch') {
      ra = new RaCommandClient(RA_NETWORK_PORT)
      // Another RetroArch (e.g. opened from Settings) would own the command port and receive our commands.
      if (await ra.getStatus(200)) {
        ra.close()
        return { ok: false, error: 'RetroArch is already open. Close it and try again.' }
      }
    }

    const settings = getSettings()
    let power: PowerState | undefined
    if (settings.performance.inGameMode !== 'unchanged') {
      try {
        power = await capturePowerState()
        await setPerformanceMode(settings.performance.inGameMode)
      } catch (e) {
        console.warn('[launch] could not apply performance mode', e)
      }
    }

    let child: ChildProcess
    try {
      child = await startProcess(plan)
    } catch (e) {
      ra?.close()
      if (power) await restorePowerState(power).catch(() => undefined)
      return { ok: false, error: `Could not start the emulator: ${e instanceof Error ? e.message : String(e)}` }
    }

    const info: SessionInfo = {
      gameId: game.id,
      title: game.title,
      systemId: game.systemId,
      emulatorId: refKey(plan.ref),
      supportsCommands: plan.supportsCommands,
      startedAt: Date.now(),
      pid: child.pid,
      stateSlot: 0,
      ...(plan.supportsCommands ? { paused: false, fastForward: false } : {})
    }
    const session: ActiveSession = { info, child, ra, pausedByUs: false, power, exited: false, chain: Promise.resolve() }
    active = session
    child.once('exit', (code) => void endSession(session, code))
    void focusHelper.start()
    emitSession(publicInfo())
    showOverlay()
    registerShortcut()
    return { ok: true, session: { ...info } }
  } finally {
    launching = false
  }
}

async function endSession(s: ActiveSession, code: number | null): Promise<void> {
  if (s.exited) return
  s.exited = true
  clearTimeout(s.quitTimer)
  const seconds = Math.max(0, Math.round((Date.now() - s.info.startedAt) / 1000))
  if (active === s) active = null
  unregisterShortcut()
  s.ra?.close()
  focusHelper.stop()
  try {
    destroyOverlay()
  } catch (e) {
    console.warn('[launch] destroyOverlay failed', e)
  }
  emitSession(null)
  try {
    await recordPlaySession(s.info.gameId, s.info.startedAt, seconds)
  } catch (e) {
    console.warn('[launch] recordPlaySession failed', e)
  }
  if (s.power) await restorePowerState(s.power).catch((e) => console.warn('[launch] power plan restore failed', e))
  focusMainWindow()
  // A quick non-zero exit almost always means the emulator failed to boot the game.
  if (code && code !== 0 && seconds < 10 && !s.quitTimer) {
    const hint = s.info.supportsCommands ? ` See ${join(raDir(getPaths()), 'logs', 'retroarch.log')}.` : ''
    createTask(s.info.title).fail(`The emulator closed unexpectedly (exit code ${code}).${hint}`)
  }
}

function forceKill(pid: number | undefined): void {
  if (!pid) return
  spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => undefined)
}

function scheduleForceKill(s: ActiveSession): void {
  clearTimeout(s.quitTimer)
  s.quitTimer = setTimeout(() => {
    if (!s.exited) forceKill(s.info.pid)
  }, QUIT_GRACE_MS)
}

// ---------------------------------------------------------------------------------------------
// Overlay integration: pause RetroArch while the quick menu is open, restore focus afterwards
// ---------------------------------------------------------------------------------------------

/** Update SessionInfo.paused and notify the UI if it changed. */
function setPaused(s: ActiveSession, paused: boolean): void {
  if (s.info.paused === paused || s.exited) return
  s.info.paused = paused
  if (active === s) emitSession(publicInfo())
}

async function syncPaused(s: ActiveSession): Promise<void> {
  if (!s.ra || s.exited) return
  const st = await s.ra.getStatus(400)
  if (st?.state === 'PAUSED' || st?.state === 'PLAYING') setPaused(s, st.state === 'PAUSED')
}

async function pauseForOverlay(s: ActiveSession): Promise<void> {
  if (!s.ra || s.exited) return
  const st = await s.ra.getStatus(400)
  if (st?.state === 'PLAYING') {
    await s.ra.send('PAUSE_TOGGLE')
    s.pausedByUs = true
    setPaused(s, true)
  } else if (st?.state === 'PAUSED') {
    setPaused(s, true)
  }
}

async function resumeFromOverlay(s: ActiveSession): Promise<void> {
  if (s.exited) return
  if (s.ra && s.pausedByUs) {
    s.pausedByUs = false
    const st = await s.ra.getStatus(400)
    if (st?.state === 'PAUSED') await s.ra.send('PAUSE_TOGGLE')
    if (st) setPaused(s, false)
  }
  if (s.info.pid) {
    const r = await focusHelper.focus(s.info.pid)
    if (r !== 'OK') console.warn(`[launch] refocus emulator: ${r}`)
  }
}

function onOverlayChanged(activeOverlay: boolean): void {
  const s = active
  if (!s || s.exited) return
  s.chain = s.chain
    .then(() => (activeOverlay ? pauseForOverlay(s) : resumeFromOverlay(s)))
    .catch((e) => console.warn('[launch] overlay pause/resume failed', e))
}

// ---------------------------------------------------------------------------------------------
// Quick actions
// ---------------------------------------------------------------------------------------------

const RA_COMMANDS: Partial<Record<QuickAction, string>> = {
  save_state: 'SAVE_STATE',
  load_state: 'LOAD_STATE',
  screenshot: 'SCREENSHOT',
  reset: 'RESET'
}

export async function quickAction(action: QuickAction): Promise<void> {
  const s = active
  if (!s || s.exited) return
  if (action === 'resume') {
    setOverlayActive(false)
    return
  }
  if (action === 'quit') {
    if (s.ra) await s.ra.send('QUIT').catch(() => undefined)
    else spawn('taskkill', ['/PID', String(s.info.pid)], { windowsHide: true, stdio: 'ignore' }).on('error', () => undefined)
    scheduleForceKill(s)
    return
  }
  if (!s.ra) {
    console.info(`[launch] "${action}" is not supported for ${s.info.emulatorId}`)
    return
  }
  switch (action) {
    case 'retroarch_menu':
      // Unpause + refocus first, then open the menu so RetroArch isn't left paused underneath it.
      await (s.chain = s.chain.then(() => resumeFromOverlay(s)).catch(() => undefined))
      setOverlayActive(false)
      await s.ra.send('MENU_TOGGLE')
      return
    case 'slot_next':
      await s.ra.send('STATE_SLOT_PLUS')
      s.info.stateSlot = Math.min(999, s.info.stateSlot + 1)
      emitSession(publicInfo())
      return
    case 'slot_prev':
      if (s.info.stateSlot <= 0) return // RetroArch would go to the "auto" slot (-1)
      await s.ra.send('STATE_SLOT_MINUS')
      s.info.stateSlot -= 1
      emitSession(publicInfo())
      return
    case 'pause_toggle': {
      // The user is now in charge of pausing; don't auto-unpause on overlay close.
      s.pausedByUs = false
      await s.ra.send('PAUSE_TOGGLE')
      setPaused(s, !s.info.paused)
      // RetroArch applies the toggle on its next frame; re-sync shortly after in case it was ignored.
      setTimeout(() => void syncPaused(s), 250)
      return
    }
    case 'fast_forward':
      await s.ra.send('FAST_FORWARD')
      s.info.fastForward = !s.info.fastForward
      emitSession(publicInfo())
      return
    default: {
      const cmd = RA_COMMANDS[action]
      if (cmd) await s.ra.send(cmd)
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Global shortcut (registered only while a game runs, so we never steal it from other apps otherwise)
// ---------------------------------------------------------------------------------------------

function registerShortcut(): void {
  unregisterShortcut()
  const acc = getSettings().hotkeys.quickMenu
  if (!acc) return
  try {
    const ok = globalShortcut.register(acc, () => {
      if (active && !active.exited) setOverlayActive(!isOverlayActive())
    })
    if (ok) registeredAccelerator = acc
    else console.warn(`[launch] global shortcut ${acc} is taken by another app`)
  } catch (e) {
    console.warn(`[launch] invalid accelerator ${acc}`, e)
  }
}

function unregisterShortcut(): void {
  if (!registeredAccelerator) return
  try {
    globalShortcut.unregister(registeredAccelerator)
  } catch {
    /* ignore */
  }
  registeredAccelerator = null
}

/** Best-effort synchronous power-plan restore if the app quits mid-game. */
function restorePowerSync(p: PowerState): void {
  try {
    if (p.scheme) spawnSync('powercfg', ['/setactive', p.scheme], { windowsHide: true, timeout: 4000 })
    if (p.overlay) spawnSync('powercfg', ['/overlaysetactive', p.overlay], { windowsHide: true, timeout: 4000 })
  } catch {
    /* ignore */
  }
}

export function initLaunch(): void {
  onOverlayActiveChanged(onOverlayChanged)
  onSettingsChanged((s, prev) => {
    if (s.hotkeys.quickMenu !== prev.hotkeys.quickMenu && active && !active.exited) registerShortcut()
  })
  app.on('will-quit', () => {
    unregisterShortcut()
    focusHelper.stop()
    if (active?.power) restorePowerSync(active.power)
  })
}

export const gameHandlers: RetroDeskApi['game'] = {
  launch: launchGame,
  async getSession() {
    return publicInfo()
  },
  quickAction
}
