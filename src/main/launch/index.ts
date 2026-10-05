// Game launcher + session tracking + Game Assist quick actions.
import { spawn, spawnSync, type ChildProcess } from 'child_process'
import { existsSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { app, globalShortcut, shell } from 'electron'
import type { RetroDeskApi } from '../../shared/api'
import { QUICK_ACTIONS, type QuickActionDef } from '../../shared/quickActions'
import type { Game, LaunchResult, QuickAction, SessionInfo } from '../../shared/types'
import { createTask, emitSession, type TaskHandle } from '../events'
import { getGameById, recordPlaySession } from '../library'
import { getPaths } from '../paths'
import { getSettings, onSettingsChanged } from '../settings'
import { getSystemDef } from '../systems'
import { readJson, writeJsonAtomic } from '../util/json'
import { canSwitchPowerPlan, capturePowerState, enterPerformanceMode, restorePowerState, type PowerState } from '../system'
import { destroyOverlay, focusMainWindow, isOverlayActive, onOverlayActiveChanged, setOverlayActive, showOverlay } from '../windows'
import { isRefInstalled, refKey, refStatusId, resolveGameRef, retroArchExe, standaloneExe } from '../emulators'
import type { EmuRef } from '../emulators/keys'
import { buildRetroArchArgs, coreDisplayName, coreLibPath, ensureCoreSystemAssets, RA_NETWORK_PORT, raDir, writeAppendConfig } from '../emulators/retroarch'
import { expandArgs, getStandaloneDef, hasVcRedist, provisionStandalone, resolveRom, standaloneDataDir, vcRedistMessage } from '../emulators/standalone'
import { hostOs } from '../platform'
import { autoFetchableCore, describeMissing, missingBios } from './bios'
import { fileWrittenSince } from './confirm'
import { createFocusHelper } from './focus'
import { RaCommandClient } from './racommand'

const QUIT_GRACE_MS = 4000

interface ActiveSession {
  info: SessionInfo
  child: ChildProcess
  ra: RaCommandClient | null
  /** We paused RetroArch when the overlay opened (so we unpause on close). */
  pausedByUs: boolean
  power?: PowerState
  /** Capturing the plan and switching to the in-game mode, done after the emulator started; the restore waits for it. */
  boosting: Promise<void>
  /** `boosting` has settled. */
  boosted?: boolean
  quitTimer?: NodeJS.Timeout
  exited: boolean
  /** Serialises overlay pause/resume work. */
  chain: Promise<void>
}

let active: ActiveSession | null = null
let launching = false
/** The power-plan restore in flight, if any. */
let restoring: Promise<void> = Promise.resolve()
let registeredAccelerator: string | null = null
const focusHelper = createFocusHelper({ cacheDir: () => app.getPath('userData') })
/** The focus helper is only needed once the quick menu closes: keep its start-up away from the emulator's. */
const FOCUS_HELPER_DELAY_MS = 5000

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

  // Core asset packs (PPSSPP, blueMSX) are fetched automatically, shown as a task so the launch doesn't look hung.
  const assetCore = autoFetchableCore(ref)
  if (assetCore) {
    // Only created once there is something to download.
    let task: TaskHandle | undefined
    try {
      await ensureCoreSystemAssets(assetCore, paths, {
        update: (progress, detail) => (task ??= createTask(`Setting up ${emuName}`, { kind: 'system', id: system.id })).update(progress, detail)
      })
      task?.done(`${emuName} is ready`)
    } catch (e) {
      task?.fail(e)
      console.warn('[launch] asset pack download failed', e)
    }
  }
  const missing = missingBios({ system, ref, biosDir: paths.bios, romPath: game.path })
  if (missing.length) return { ok: false, needs: 'bios', error: describeMissing(system.name, missing, paths.bios) }

  if (ref.type === 'retroarch') {
    const exe = retroArchExe()!
    const { cfgPath, shaderPath, mainCfg } = await writeAppendConfig(settings, paths)
    return {
      ok: true,
      plan: { exe, cwd: dirname(exe), ref, supportsCommands: true, args: buildRetroArchArgs({ coreDll: coreLibPath(paths, ref.core), rom: game.path, appendCfg: cfgPath, shaderPath, mainCfg }) }
    }
  }

  const def = getStandaloneDef(ref.id)
  if (!def) return { ok: false, error: `Unknown emulator "${ref.id}"` }
  const exe = standaloneExe(ref.id)!
  if (def.needsVcRedist && !hasVcRedist()) return { ok: false, error: vcRedistMessage(def.name) }
  const prov = await provisionStandalone(def, standaloneDataDir(def, dirname(exe)), paths.bios)
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
  /** The command client, until a RetroArch session takes it over; closed on the way out otherwise. */
  let ra: RaCommandClient | null = null
  try {
    const game = await getGameById(gameId)
    if (!game) return { ok: false, error: 'Game not found.' }

    if (game.systemId === 'steam') {
      // The path comes from library.json; only ever hand a real Steam launch URL to the shell.
      if (!/^steam:\/\/rungameid\/\d+$/.test(game.path)) return { ok: false, error: 'This Steam entry is not valid. Rescan your library.' }
      const startedAt = Date.now()
      await shell.openExternal(game.path)
      await Promise.resolve(recordPlaySession(game.id, startedAt, 0)).catch((e) => console.warn('[launch] recordPlaySession failed', e))
      return { ok: true, session: { gameId: game.id, title: game.title, systemId: game.systemId, emulatorId: 'steam', supportsCommands: false, startedAt, stateSlot: 0 } }
    }

    // These checks don't depend on the plan, so they run while it is made (and are dropped if the launch stops).
    // Another RetroArch (e.g. opened from Settings) would own the command port and receive our commands. Nothing
    // answers when none is open, so this check costs its whole timeout: overlapping it is what keeps it cheap.
    ra = new RaCommandClient(RA_NETWORK_PORT)
    const raOpen = ra.getStatus(200)
    const settings = getSettings()
    const mode = canSwitchPowerPlan() ? settings.performance.inGameMode : 'unchanged'
    // Let the previous session finish putting its plan back, or we would capture the boosted one as "original".
    const capturing: Promise<PowerState | undefined> =
      mode === 'unchanged'
        ? Promise.resolve(undefined)
        : restoring.then(capturePowerState).catch((e) => {
            console.warn('[launch] could not read the power plan', e)
            return undefined
          })

    const planned = await planLaunch(game)
    if (!planned.ok) return planned
    const { plan } = planned
    const isRetroArch = plan.ref.type === 'retroarch'
    if (isRetroArch && (await raOpen)) return { ok: false, error: 'RetroArch is already open. Close it and try again.' }

    let child: ChildProcess
    try {
      child = await startProcess(plan)
    } catch (e) {
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
    const session: ActiveSession = { info, child, ra: isRetroArch ? ra : null, pausedByUs: false, boosting: Promise.resolve(), exited: false, chain: Promise.resolve() }
    if (isRetroArch) ra = null // the session owns it now
    active = session
    child.once('exit', (code) => void endSession(session, code))
    // The power mode is switched once the emulator is on its way rather than holding up its start. The plan being
    // replaced goes to disk before anything changes, so a crash mid-game can still put it back.
    session.boosting = capturing
      .then(async (power) => {
        if (!power || session.exited) return
        session.power = power
        rememberPowerState(power)
        await enterPerformanceMode(mode, power)
      })
      .catch((e) => console.warn('[launch] could not apply performance mode', e))
      .finally(() => (session.boosted = true))
    focusHelper.prewarm(FOCUS_HELPER_DELAY_MS)
    emitSession(publicInfo())
    showOverlay()
    registerShortcut()
    return { ok: true, session: { ...info } }
  } finally {
    ra?.close()
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
  // Back to the frontend first (unless another game is already in front); the power plan and play time are
  // tidied up behind it.
  if (!active) focusMainWindow()
  // Once the mode switch (if still going) is done. The next launch waits for this before capturing its own
  // "original" plan.
  restoring = Promise.all([restoring, s.boosting]).then(() => (s.power ? restorePower(s.power) : undefined))
  try {
    await recordPlaySession(s.info.gameId, s.info.startedAt, seconds)
  } catch (e) {
    console.warn('[launch] recordPlaySession failed', e)
  }
  // A quick non-zero exit almost always means the emulator failed to boot the game.
  if (code && code !== 0 && seconds < 10 && !s.quitTimer) {
    const hint = s.info.supportsCommands ? ` See ${join(raDir(getPaths()), 'logs', 'retroarch.log')}.` : ''
    createTask(s.info.title).fail(`The emulator closed unexpectedly (exit code ${code}).${hint}`)
  }
}

/** Ask the emulator to close (Windows: WM_CLOSE via taskkill; macOS: SIGTERM). */
function requestQuit(pid: number | undefined): void {
  if (!pid) return
  if (hostOs() === 'macos') signalProcess(pid, 'SIGTERM')
  else spawn('taskkill', ['/PID', String(pid)], { windowsHide: true, stdio: 'ignore' }).on('error', () => undefined)
}

function forceKill(pid: number | undefined): void {
  if (!pid) return
  if (hostOs() === 'macos') signalProcess(pid, 'SIGKILL')
  else spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => undefined)
}

function signalProcess(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal)
  } catch {
    /* already gone */
  }
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
  s.chain = s.chain.then(() => (activeOverlay ? pauseForOverlay(s) : resumeFromOverlay(s))).catch((e) => console.warn('[launch] overlay pause/resume failed', e))
}

// ---------------------------------------------------------------------------------------------
// Quick actions
// ---------------------------------------------------------------------------------------------

/**
 * Send an action's RetroArch command. The command port never answers a command, so "sent" proves nothing:
 * first check RetroArch is listening at all, then for actions that leave a file behind wait for that file.
 */
async function sendCommand(s: ActiveSession, ra: RaCommandClient, def: QuickActionDef): Promise<void> {
  if (!def.command) return
  if (!(await ra.getStatus(400))) throw new Error('RetroArch is not responding.')
  const since = Date.now()
  await ra.send(def.command)
  // Only files RetroArch changes are looked at (see fileWrittenSince), so these patterns needn't name the game.
  if (def.writes === 'states') {
    const file = new RegExp(`\\.state${s.info.stateSlot || ''}$`)
    if (!(await fileWrittenSince(getPaths().states, since, file))) throw new Error('RetroArch did not write a save state. This core may not support them.')
  } else if (def.writes === 'screenshots') {
    if (!(await fileWrittenSince(getPaths().screenshots, since, /\.(png|bmp|tga)$/i))) throw new Error('RetroArch did not save a screenshot.')
  }
}

export async function quickAction(action: QuickAction): Promise<void> {
  const s = active
  if (!s || s.exited) return
  const def = QUICK_ACTIONS[action]
  if (action === 'resume') {
    setOverlayActive(false)
    return
  }
  if (action === 'quit') {
    if (s.ra) await s.ra.send('QUIT').catch(() => undefined)
    else requestQuit(s.info.pid)
    scheduleForceKill(s)
    return
  }
  if (!s.ra) {
    console.info(`[launch] "${action}" is not supported for ${s.info.emulatorId}`)
    return
  }
  if (def.available && !def.available(s.info)) return
  if (action === 'retroarch_menu') {
    // Unpause + refocus first, then open the menu so RetroArch isn't left paused underneath it.
    await (s.chain = s.chain.then(() => resumeFromOverlay(s)).catch(() => undefined))
    setOverlayActive(false)
  }
  // The user is now in charge of pausing; don't auto-unpause on overlay close.
  if (action === 'pause_toggle') s.pausedByUs = false
  await sendCommand(s, s.ra, def)
  if (def.apply && !s.exited) {
    def.apply(s.info)
    if (active === s) emitSession(publicInfo())
  }
  // RetroArch applies the toggle on its next frame; re-sync shortly after in case it was ignored.
  if (action === 'pause_toggle') setTimeout(() => void syncPaused(s), 250)
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

/** Best-effort synchronous power-plan restore if the app quits mid-game (Windows; macOS never switches plans). */
function restorePowerSync(p: PowerState, keepRecord = false): void {
  if (!canSwitchPowerPlan()) return
  try {
    if (p.scheme) spawnSync('powercfg', ['/setactive', p.scheme], { windowsHide: true, timeout: 4000 })
    if (p.overlay) spawnSync('powercfg', ['/overlaysetactive', p.overlay], { windowsHide: true, timeout: 4000 })
    if (!keepRecord) forgetPowerState()
  } catch {
    /* ignore */
  }
}

// The plan we replaced is kept on disk until it has been put back: after a crash, a kill or a Windows shutdown
// mid-game nothing else would remember it, and the machine would stay on the boosted plan for good.
const powerRestoreFile = (): string => join(app.getPath('userData'), 'power-restore.json')
const GUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

function rememberPowerState(p: PowerState): void {
  try {
    writeJsonAtomic(powerRestoreFile(), p)
  } catch (e) {
    console.warn('[launch] could not record the power plan to restore', e)
  }
}

function forgetPowerState(): void {
  rmSync(powerRestoreFile(), { force: true })
}

/** Put a captured plan back and drop the on-disk record. Never rejects. */
async function restorePower(p: PowerState): Promise<void> {
  try {
    await restorePowerState(p)
    forgetPowerState()
  } catch (e) {
    console.warn('[launch] power plan restore failed', e)
  }
}

/** A record left behind by a session that never ended cleanly. */
function leftoverPowerState(): PowerState | undefined {
  const p = readJson<Partial<PowerState> | null>(powerRestoreFile(), null)
  if (!p || (p.source !== 'ac' && p.source !== 'dc')) return undefined
  const guid = (v: unknown): string | undefined => (typeof v === 'string' && GUID.test(v) ? v : undefined)
  return { scheme: guid(p.scheme), overlay: guid(p.overlay), source: p.source }
}

export function initLaunch(): void {
  onOverlayActiveChanged(onOverlayChanged)
  onSettingsChanged((s, prev) => {
    if (s.hotkeys.quickMenu !== prev.hotkeys.quickMenu && active && !active.exited) registerShortcut()
  })
  const leftover = leftoverPowerState()
  if (leftover) restoring = restorePower(leftover)
  app.on('will-quit', () => {
    unregisterShortcut()
    focusHelper.stop()
    // A switch to the performance mode still in flight could land after this restore: keep the record so the next
    // start puts the plan back again.
    if (active?.power) restorePowerSync(active.power, !active.boosted)
  })
}

export const gameHandlers: RetroDeskApi['game'] = {
  launch: launchGame,
  async getSession() {
    return publicInfo()
  },
  quickAction
}
