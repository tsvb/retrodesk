import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { BatteryCharging, BatteryMedium, Camera, Download, FastForward, Menu, Minus, Play, Plus, Power, RotateCcw, Upload } from 'lucide-react'
import type { PerformanceMode, QuickAction, SessionInfo, SystemStats } from '@shared/types'
import { api, isElectron } from '../api'
import { Button } from '../components/Button'
import { Segmented } from '../components/Controls'
import { HintBar } from '../components/HintBar'
import { ConfirmDialog } from '../components/Modal'
import { StatsCard } from '../components/Stats'
import { Toasts } from '../components/TaskTray'
import { installGamepad } from '../input/gamepad'
import { FocusScope, useActions, useFocusGroup } from '../input/hooks'
import { installKeyboard } from '../input/keyboard'
import { formatClock, formatDuration } from '../lib/format'
import { useBattery, useNow } from '../lib/hooks'
import { playSound, primeAudioOnGesture } from '../lib/sound'
import { systemColor } from '../lib/color'
import { systemById, useLibrary } from '../stores/library'
import { toast } from '../stores/session'
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

/**
 * Game Assist: the in-game quick menu. Lives in a transparent, click-through, always-on-top window.
 * Fully transparent while inactive; it only watches for the controller combo (or Guide).
 */
export function OverlayApp() {
  const [active, setActive] = useState(false)
  const [session, setSession] = useState<SessionInfo | null>(null)
  const activeRef = useRef(false)
  activeRef.current = active

  const open = useCallback(() => {
    if (activeRef.current) return
    activeRef.current = true
    setActive(true)
    playSound('open')
    void api.window.setOverlayActive(true)
    void api.game.getSession().then(setSession)
  }, [])

  const resume = useCallback(async () => {
    if (!activeRef.current) return
    activeRef.current = false
    setActive(false)
    playSound('back')
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
    void useLibrary.getState().refresh()
    void api.game.getSession().then(setSession)
    const offs = [
      followSettingsChanges(),
      api.on.overlay((v) => {
        activeRef.current = v
        setActive(v)
        if (v) void api.game.getSession().then(setSession)
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
        getLayout: () => useSettings.getState().settings?.ui.buttonLayout ?? 'xbox',
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
  }, [open, resume])

  return (
    <div className={`overlay ${active ? 'is-active' : ''}`}>
      {!isElectron && <MockGame />}
      <div className="overlay__dim" onClick={() => void resume()} />
      {active && (
        <FocusScope id="overlay-panel">
          <Panel session={session} onResume={resume} />
        </FocusScope>
      )}
      <Toasts className="toasts--overlay" />
    </div>
  )
}

function Panel({ session, onResume }: { session: SessionInfo | null; onResume: () => Promise<void> }) {
  const now = useNow(1000)
  const battery = useBattery()
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [slot, setSlot] = useState(session?.stateSlot ?? 0)
  // Prefer the backend's state; fall back to local tracking for backends that don't report it.
  const [localFf, setLocalFf] = useState(false)
  const ff = session?.fastForward ?? localFf
  const [confirm, setConfirm] = useState<'quit' | 'reset' | null>(null)
  const perf = useSettings((s) => s.settings?.performance.inGameMode ?? 'unchanged')
  const [mode, setMode] = useState<PerformanceMode>(perf)
  const system = useLibrary((s) => systemById(s.systems, session?.systemId))
  useFocusGroup('qa-slot', { memory: false })

  useEffect(() => setSlot(session?.stateSlot ?? 0), [session?.stateSlot])
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

  const run = async (action: QuickAction, message?: string) => {
    try {
      await api.game.quickAction(action)
      if (message) toast(message, 'success')
    } catch (e) {
      playSound('error')
      toast(`That didn't work: ${e instanceof Error ? e.message : String(e)}`, 'error')
    }
  }
  const changeSlot = async (delta: 1 | -1) => {
    const next = Math.max(0, Math.min(9, slot + delta))
    setSlot(next)
    await run(delta > 0 ? 'slot_next' : 'slot_prev')
  }
  const ra = session?.supportsCommands ?? false
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
        {ra && (
          <>
            <div className="qa__pair">
              <Button icon={Download} size="lg" onPress={() => void run('save_state', `State saved to slot ${slot}`)}>
                Save state
              </Button>
              <Button icon={Upload} size="lg" onPress={() => void run('load_state', `Loaded state from slot ${slot}`)}>
                Load state
              </Button>
            </div>
            <div className="qa__slot">
              <Button icon={Minus} size="lg" group="qa-slot" onPress={() => void changeSlot(-1)} disabled={slot <= 0} label="Previous slot" title="Previous slot" />
              <span className="qa__slotlabel">
                Slot <strong>{slot}</strong>
              </span>
              <Button icon={Plus} size="lg" group="qa-slot" onPress={() => void changeSlot(1)} disabled={slot >= 9} label="Next slot" title="Next slot" />
            </div>
            <div className="qa__pair">
              <Button icon={Camera} size="lg" onPress={() => void run('screenshot', 'Screenshot saved')}>
                Screenshot
              </Button>
              <Button
                icon={FastForward}
                size="lg"
                className={ff ? 'is-active' : ''}
                onPress={() => {
                  setLocalFf(!ff)
                  void run('fast_forward', ff ? 'Normal speed' : 'Fast-forward on')
                }}
              >
                {ff ? 'Normal speed' : 'Fast forward'}
              </Button>
            </div>
            <div className="qa__pair">
              <Button icon={RotateCcw} size="lg" onPress={() => setConfirm('reset')}>
                Reset
              </Button>
              <Button
                icon={Menu}
                size="lg"
                onPress={async () => {
                  await run('retroarch_menu')
                  await onResume()
                }}
              >
                RetroArch menu
              </Button>
            </div>
          </>
        )}
        <div className="qa__perf">
          <span className="qa__label">Performance</span>
          <Segmented
            group="qa-perf"
            value={mode}
            onChange={(m) => {
              setMode(m)
              void api.system.setPerformanceMode(m).then(() => toast(`Performance mode: ${m === 'unchanged' ? 'Windows default' : m}`, 'success'))
            }}
            options={[
              { value: 'quiet', label: 'Quiet' },
              { value: 'balanced', label: 'Balanced' },
              { value: 'performance', label: 'Max' },
              { value: 'unchanged', label: 'Default' }
            ]}
          />
        </div>
        <Button variant="danger" size="lg" icon={Power} onPress={() => setConfirm('quit')}>
          Quit game
        </Button>
      </div>

      <div className="qa__stats">
        <StatsCard stats={stats} compact />
      </div>
      <HintBar className="hintbar--overlay" />

      {confirm === 'quit' && (
        <ConfirmDialog
          title={`Quit ${session?.title ?? 'the game'}?`}
          description={ra ? 'If quick resume is on, your progress is saved before closing.' : 'Unsaved progress since your last in-game save will be lost.'}
          confirmLabel="Quit game"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            setConfirm(null)
            await run('quit')
            await api.window.setOverlayActive(false)
          }}
        />
      )}
      {confirm === 'reset' && (
        <ConfirmDialog
          title="Reset the game?"
          description="It restarts from the beginning, like pressing the console's reset button."
          confirmLabel="Reset"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            setConfirm(null)
            await run('reset', 'Game reset')
            await onResume()
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

