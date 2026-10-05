import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { BatteryCharging, BatteryMedium, Camera, Download, FastForward, Menu, Minus, Pause, Play, Plus, Power, RotateCcw, Upload, type LucideIcon } from 'lucide-react'
import { QUICK_ACTIONS } from '@shared/quickActions'
import type { PerformanceMode, QuickAction, SessionInfo, SystemStats, SystemSummary } from '@shared/types'
import { api, isElectron } from '../api'
import { Button, type ButtonProps } from '../components/Button'
import { Segmented } from '../components/Controls'
import { PadButton } from '../components/Glyph'
import { HintBar } from '../components/HintBar'
import { ConfirmDialog } from '../components/Modal'
import { StatsCard } from '../components/Stats'
import { Toasts } from '../components/TaskTray'
import { installGamepad } from '../input/gamepad'
import { FocusScope, useActions, useFocusGroup } from '../input/hooks'
import { installKeyboard } from '../input/keyboard'
import { formatClock, formatDuration } from '../lib/format'
import { useBattery, useNow } from '../lib/hooks'
import { feedback } from '../lib/feedback'
import { canSwitchPowerPlan } from '../lib/platform'
import { primeAudioOnGesture } from '../lib/sound'
import { systemColor } from '../lib/color'
import { currentButtonLayout, useInputStore } from '../stores/input'
import { toast, useToasts } from '../stores/session'
import { followSettingsChanges, useSettings } from '../stores/settings'

/** Does a KeyboardEvent match an Electron accelerator like "Control+Alt+Home"? */
function matchesAccelerator(e: KeyboardEvent, accel: string): boolean {
  const parts = accel.toLowerCase().split('+')
  const key = parts[parts.length - 1]
  const want = (m: string) => parts.includes(m)
  if (want('control') !== e.ctrlKey && want('ctrl') !== e.ctrlKey) return false
  if (want('alt') !== e.altKey) return false
  if (want('shift') !== e.shiftKey) return false
  return e.key.toLowerCase() === key
}

const ICONS: Record<QuickAction, LucideIcon> = {
  resume: Play,
  save_state: Download,
  load_state: Upload,
  slot_next: Plus,
  slot_prev: Minus,
  screenshot: Camera,
  fast_forward: FastForward,
  pause_toggle: Pause,
  reset: RotateCcw,
  retroarch_menu: Menu,
  quit: Power
}

/**
 * One quick action as a button. Label, toggle state, availability and the in-game hotkey all come from
 * QUICK_ACTIONS; the panel only decides where the button goes.
 */
function ActionButton({
  id,
  session,
  running,
  onRun,
  iconOnly,
  ...button
}: { id: QuickAction; session: SessionInfo; running: QuickAction | null; onRun: (id: QuickAction) => void; iconOnly?: boolean } & ButtonProps) {
  const family = useInputStore((s) => s.pads[0]?.family ?? 'xbox')
  const def = QUICK_ACTIONS[id]
  const on = def.isActive?.(session) ?? false
  const label = on && def.activeLabel ? def.activeLabel : def.label
  const hotkey = def.hotkey
  return (
    <Button
      icon={ICONS[id]}
      size="lg"
      label={label}
      title={hotkey ? `${label} (in game: Select + ${hotkey.pad})` : label}
      className={on ? 'is-active' : ''}
      disabled={def.available ? !def.available(session) : false}
      busy={running === id}
      onPress={() => onRun(id)}
      {...button}
    >
      {!iconOnly && (
        <>
          <span className="qa__actionlabel">{label}</span>
          {hotkey?.std !== undefined && (
            <span className="qa__hotkey">
              <PadButton family={family} index={hotkey.std} size="sm" />
            </span>
          )}
        </>
      )}
    </Button>
  )
}

/**
 * Game Assist: the in-game quick menu. Lives in a transparent, click-through, always-on-top window.
 * Fully transparent while inactive; it only watches for the controller combo (or Guide).
 */
export function OverlayApp() {
  const [active, setActive] = useState(false)
  const [session, setSession] = useState<SessionInfo | null>(null)
  // Only the running game's system (name and color) is shown here, so skip the full library load.
  const [systems, setSystems] = useState<SystemSummary[]>([])
  const activeRef = useRef(false)
  activeRef.current = active

  const loadSystems = useCallback(() => {
    void api.library
      .getSystems()
      .then(setSystems)
      .catch(() => undefined)
  }, [])

  const open = useCallback(() => {
    if (activeRef.current) return
    activeRef.current = true
    feedback('open')
    // Render the menu once the window is back on the display, so its slide-in isn't spent in the parked window.
    void api.window.setOverlayActive(true).finally(() => setActive(activeRef.current))
    void api.game.getSession().then(setSession)
    loadSystems()
  }, [loadSystems])

  const resume = useCallback(async () => {
    if (!activeRef.current) return
    activeRef.current = false
    setActive(false)
    feedback('back')
    try {
      await api.game.quickAction('resume')
    } finally {
      await api.window.setOverlayActive(false)
    }
  }, [])

  useEffect(() => {
    document.documentElement.classList.add('is-overlay')
    primeAudioOnGesture()
    void useSettings.getState().load()
    loadSystems()
    void api.game.getSession().then(setSession)
    const offs = [
      followSettingsChanges(),
      // While closed the window is parked off-screen; toasts (e.g. "State saved" right after closing) keep it on the display.
      useToasts.subscribe((s, prev) => {
        if (!s.toasts.length !== !prev.toasts.length) void api.window.setOverlayHold(s.toasts.length > 0)
      }),
      api.on.overlay((v) => {
        activeRef.current = v
        setActive(v)
        if (v) {
          void api.game.getSession().then(setSession)
          loadSystems()
        }
      }),
      api.on.session((s) => {
        setSession(s)
        if (!s && activeRef.current) {
          activeRef.current = false
          setActive(false)
          void api.window.setOverlayActive(false)
        }
      }),
      installGamepad({
        mode: 'overlay',
        getLayout: currentButtonLayout,
        getCombo: () => useSettings.getState().settings?.hotkeys.quickMenuCombo ?? [8, 9],
        isActive: () => activeRef.current,
        onCombo: () => (activeRef.current ? void resume() : open())
      }),
      installKeyboard({
        onKey: (e) => {
          const accel = useSettings.getState().settings?.hotkeys.quickMenu ?? 'Control+Alt+Home'
          if (!matchesAccelerator(e, accel)) return false
          if (activeRef.current) void resume()
          else open()
          return true
        }
      })
    ]
    return () => offs.forEach((o) => o())
  }, [open, resume, loadSystems])

  return (
    <div className={`overlay ${active ? 'is-active' : ''}`}>
      {!isElectron && <MockGame />}
      <div className="overlay__dim" onClick={() => void resume()} />
      {active && (
        <FocusScope id="overlay-panel">
          <Panel session={session} system={session ? systems.find((x) => x.id === session.systemId) : undefined} onResume={resume} />
        </FocusScope>
      )}
      <Toasts className="toasts--overlay" />
    </div>
  )
}

function Panel({ session, system, onResume }: { session: SessionInfo | null; system?: SystemSummary; onResume: () => Promise<void> }) {
  const now = useNow(1000)
  const battery = useBattery()
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [confirm, setConfirm] = useState<QuickAction | null>(null)
  const [running, setRunning] = useState<QuickAction | null>(null)
  const perf = useSettings((s) => s.settings?.performance.inGameMode ?? 'unchanged')
  const [mode, setMode] = useState<PerformanceMode>(perf)
  useFocusGroup('qa-slot', { memory: false })

  useEffect(() => setMode(perf), [perf])

  useEffect(() => {
    let alive = true
    let t: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const s = await api.system.getStats()
        if (alive) setStats(s)
      } catch {
        /* keep last */
      }
      if (alive) t = setTimeout(poll, 1000)
    }
    void poll()
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [])

  useActions({ back: { label: 'Resume', run: () => void onResume() } })

  const run = async (id: QuickAction) => {
    const def = QUICK_ACTIONS[id]
    setRunning(id)
    try {
      await api.game.quickAction(id)
      if (def.toast && session) toast(def.toast(session), 'success')
      if (def.closesMenu) await (id === 'quit' ? api.window.setOverlayActive(false) : onResume())
    } catch (e) {
      feedback('error')
      toast(`That didn't work: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setRunning(null)
    }
  }
  const trigger = (id: QuickAction) => {
    if (running) return
    if (QUICK_ACTIONS[id].confirm) setConfirm(id)
    else void run(id)
  }
  const ra = session?.supportsCommands ?? false
  const common = session ? { session, running, onRun: trigger } : null
  const dialog = confirm && session ? QUICK_ACTIONS[confirm].confirm?.(session) : undefined
  const accent = systemColor(system ?? { id: session?.systemId ?? 'none' })
  const bat = stats?.battery ?? (battery ? { percent: battery.percent, charging: battery.charging } : undefined)

  return (
    <aside className="qa" style={{ '--sys': accent } as CSSProperties} aria-label="Quick menu">
      <header className="qa__status">
        <span className="qa__brand">Game Assist</span>
        <span className="qa__statusright">
          {bat && (
            <span className="qa__battery">
              {bat.charging ? <BatteryCharging size="1.2em" /> : <BatteryMedium size="1.2em" />}
              {Math.round(bat.percent)}%
            </span>
          )}
          <span className="qa__clock">{formatClock(now)}</span>
        </span>
      </header>
      <div className="qa__game">
        <span className="qa__system">
          <i />
          {system?.name ?? session?.systemId ?? 'No game running'}
        </span>
        <h1 className="qa__title">{session?.title ?? 'Nothing is running'}</h1>
        {session && <span className="qa__time">Playing for {formatDuration(now.getTime() - session.startedAt)}</span>}
      </div>

      <div className="qa__actions">
        <Button variant="primary" size="lg" icon={Play} autoFocus onPress={() => void onResume()}>
          Resume
        </Button>
        {common && ra && (
          <>
            <div className="qa__pair">
              <ActionButton id="save_state" {...common} />
              <ActionButton id="load_state" {...common} />
            </div>
            <div className="qa__slot">
              <ActionButton id="slot_prev" group="qa-slot" iconOnly {...common} />
              <span className="qa__slotlabel">
                Slot <strong>{common.session.stateSlot}</strong>
              </span>
              <ActionButton id="slot_next" group="qa-slot" iconOnly {...common} />
            </div>
            <div className="qa__pair">
              <ActionButton id="screenshot" {...common} />
              <ActionButton id="fast_forward" {...common} />
            </div>
            <div className="qa__pair">
              <ActionButton id="reset" {...common} />
              <ActionButton id="retroarch_menu" {...common} />
            </div>
            <p className="qa__legend">While playing, hold Select and press the button shown.</p>
          </>
        )}
        {canSwitchPowerPlan && (
          <div className="qa__perf">
            <span className="qa__label">Performance</span>
            <Segmented
              group="qa-perf"
              value={mode}
              onChange={(m) => {
                setMode(m)
                void api.system.setPerformanceMode(m).then(() => toast(`Performance mode: ${m === 'unchanged' ? 'system default' : m}`, 'success'))
              }}
              options={[
                { value: 'quiet', label: 'Quiet' },
                { value: 'balanced', label: 'Balanced' },
                { value: 'performance', label: 'Max' },
                { value: 'unchanged', label: 'Default' }
              ]}
            />
          </div>
        )}
        {common && <ActionButton id="quit" variant="danger" {...common} />}
      </div>

      <div className="qa__stats">
        <StatsCard stats={stats} compact />
      </div>
      <HintBar className="hintbar--overlay" />

      {confirm && session && dialog && (
        <ConfirmDialog
          {...dialog}
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null)
            void run(confirm)
          }}
        />
      )}
    </aside>
  )
}

/** Browser preview only: a stand-in "game" so the translucent overlay can be judged. */
function MockGame() {
  return (
    <div className="mockgame" aria-hidden="true">
      <div className="mockgame__sky" />
      <div className="mockgame__hills" />
      <div className="mockgame__ground" />
      <span className="mockgame__hint">Browser preview. Press Ctrl + Alt + Home or hold Back + Start to open the quick menu.</span>
    </div>
  )
}
