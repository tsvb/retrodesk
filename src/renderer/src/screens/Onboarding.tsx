import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, Check, Download, FolderOpen, FolderPlus, ImageDown, Play, RefreshCw, Trash2 } from 'lucide-react'
import type { ScanResult, SystemSummary } from '@shared/types'
import { api } from '../api'
import { Button } from '../components/Button'
import { ProgressBar } from '../components/Controls'
import { Wordmark } from '../components/TopBar'
import { HintBar } from '../components/HintBar'
import { FocusScope, useActions, useFocusGroup } from '../input/hooks'
import { formatNumber } from '../lib/format'
import { describeScan } from '../lib/libraryActions'
import { sep } from '../lib/platform'
import { useLibrary } from '../stores/library'
import { findRunningTask, toast, useTasks } from '../stores/session'
import { useSettings, useSettingsValue } from '../stores/settings'

const STEPS = ['Welcome', 'Data folder', 'ROM folders', 'Scan', 'Artwork', 'Ready'] as const

/** First-run wizard. Shown while settings.onboarded is false. */
export function Onboarding() {
  const [step, setStep] = useState(0)
  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1))
  const prev = () => setStep((s) => Math.max(0, s - 1))
  return (
    <div className="onboarding">
      <aside className="onboarding__rail">
        <Wordmark />
        <ol className="steps">
          {STEPS.map((label, i) => (
            <li key={label} className={i === step ? 'is-current' : i < step ? 'is-done' : ''}>
              <span className="steps__n">{i < step ? <Check size="0.9em" strokeWidth={3} /> : i + 1}</span>
              {label}
            </li>
          ))}
        </ol>
      </aside>
      <main className="onboarding__main">
        <FocusScope key={step}>
          <StepBack onBack={step > 0 ? prev : undefined} />
          <div className="onboarding__step">
            {step === 0 && <Welcome onNext={next} />}
            {step === 1 && <DataStep onNext={next} />}
            {step === 2 && <FoldersStep onNext={next} />}
            {step === 3 && <ScanStep onNext={next} />}
            {step === 4 && <ArtworkStep onNext={next} />}
            {step === 5 && <DoneStep />}
          </div>
        </FocusScope>
      </main>
      <HintBar className="hintbar--onboarding" />
    </div>
  )
}

function StepBack({ onBack }: { onBack?: () => void }) {
  useActions({ back: onBack ? { label: 'Previous step', run: onBack } : undefined })
  return null
}

function StepFrame({ title, lead, children, actions }: { title: string; lead?: ReactNode; children?: ReactNode; actions: ReactNode }) {
  useFocusGroup('ob-actions', { memory: false })
  return (
    <>
      <h1 className="onboarding__title">{title}</h1>
      {lead && <div className="onboarding__lead">{lead}</div>}
      {children && <div className="onboarding__body">{children}</div>}
      <div className="onboarding__actions">{actions}</div>
    </>
  )
}

function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <StepFrame
      title="Your games, one big screen"
      lead={
        <>
          <p>RetroDesk turns this computer into a handheld-style console: one library for every system, emulators that install themselves, and a quick menu you can open in the middle of any game.</p>
          <p>Setup takes a couple of minutes. A controller, or the arrow keys and Enter, gets you through it.</p>
        </>
      }
      actions={
        <Button variant="primary" size="xl" icon={ArrowRight} onPress={onNext} autoFocus>
          Get started
        </Button>
      }
    />
  )
}

function DataStep({ onNext }: { onNext: () => void }) {
  const s = useSettingsValue()
  const update = useSettings((st) => st.update)
  return (
    <StepFrame
      title="Where RetroDesk keeps its things"
      lead={<p>Emulators, BIOS files, save games, states, screenshots and artwork are stored in one folder. The default works for most people; pick a drive with more space if you like.</p>}
      actions={
        <>
          <Button
            size="xl"
            icon={FolderOpen}
            onPress={async () => {
              const p = await api.system.pickFolder('Choose the RetroDesk data folder')
              if (p) await update({ dataRoot: p })
            }}
          >
            Choose another folder
          </Button>
          <Button variant="primary" size="xl" icon={ArrowRight} onPress={onNext} autoFocus>
            Use this folder
          </Button>
        </>
      }
    >
      <div className="path-card">
        <FolderOpen size="1.6em" />
        <span>{s.dataRoot}</span>
      </div>
    </StepFrame>
  )
}

function FoldersStep({ onNext }: { onNext: () => void }) {
  const s = useSettingsValue()
  const update = useSettings((st) => st.update)
  const add = async () => {
    const p = await api.system.pickFolder('Choose a ROM folder')
    if (p && !s.romFolders.some((f) => f.path.toLowerCase() === p.toLowerCase())) await update({ romFolders: [...s.romFolders, { path: p }] })
  }
  const has = s.romFolders.length > 0
  return (
    <StepFrame
      title="Show RetroDesk your games"
      lead={<p>Pick the folder that holds your ROMs. Each system should have its own sub-folder; common names are recognized automatically.</p>}
      actions={
        <>
          <Button size="xl" icon={FolderPlus} onPress={add} autoFocus={!has}>
            {has ? 'Add another folder' : 'Add ROM folder'}
          </Button>
          <Button variant="primary" size="xl" icon={ArrowRight} onPress={onNext} autoFocus={has}>
            {has ? 'Continue' : 'Skip for now'}
          </Button>
        </>
      }
    >
      <div className="ob-folders">
        <pre className="tree" aria-label="Example folder layout">
          {`ROMs${sep}
  snes${sep}            Super Metroid.sfc
  psx${sep}             Final Fantasy VII (Disc 1).chd
  Nintendo 64${sep}     Super Mario 64.z64
  gba${sep}             Metroid Fusion.gba`}
        </pre>
        {has && (
          <ul className="ob-folders__list">
            {s.romFolders.map((f) => (
              <li key={f.path}>
                <FolderOpen size="1.1em" />
                <span>{f.path}</span>
                <Button size="sm" variant="ghost" icon={Trash2} label="Remove" title="Remove" onPress={() => void update({ romFolders: s.romFolders.filter((x) => x.path !== f.path) })} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </StepFrame>
  )
}

function ScanStep({ onNext }: { onNext: () => void }) {
  const folders = useSettingsValue().romFolders
  const [result, setResult] = useState<ScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [installState, setInstallState] = useState<Record<string, 'pending' | 'working' | 'done' | 'error'>>({})
  const systems = useLibrary((s) => s.systems)
  const scanTask = useTasks((s) => findRunningTask(s, { kinds: ['scan'] }, (l) => /scan/i.test(l)))
  const installTask = useTasks((s) => findRunningTask(s, { kinds: ['system', 'emulator'] }, (l) => /install/i.test(l)))

  const scan = async () => {
    setScanning(true)
    try {
      const r = await api.library.scan()
      await useLibrary.getState().refresh()
      setResult(r)
    } catch (e) {
      toast(`Scan failed: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setScanning(false)
    }
  }
  useEffect(() => {
    if (folders.length) void scan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const found = systems.filter((s) => s.gameCount > 0)
  const missing = found.filter((s) => !s.playable)
  const installing = Object.values(installState).includes('working')
  const installAll = async () => {
    for (const s of missing) {
      setInstallState((m) => ({ ...m, [s.id]: 'working' }))
      try {
        await api.emulators.installForSystem(s.id)
        setInstallState((m) => ({ ...m, [s.id]: 'done' }))
      } catch {
        setInstallState((m) => ({ ...m, [s.id]: 'error' }))
      }
    }
    await useLibrary.getState().refreshEmulators()
  }
  const allInstalled = missing.length > 0 && missing.every((s) => installState[s.id] === 'done')

  if (!folders.length)
    return (
      <StepFrame
        title="Nothing to scan yet"
        lead={<p>No ROM folders were added. You can add them any time from Settings, Library, or drop files onto the window.</p>}
        actions={
          <Button variant="primary" size="xl" icon={ArrowRight} onPress={onNext} autoFocus>
            Continue
          </Button>
        }
      />
    )

  return (
    <StepFrame
      title={scanning || !result ? 'Looking for games' : result.total ? `Found ${formatNumber(result.total)} games` : 'No games found'}
      lead={
        scanning || !result ? (
          <p>Reading {folders.length === 1 ? folders[0]?.path : `${folders.length} folders`}.</p>
        ) : result.total ? (
          <p>
            {describeScan(result)}. {missing.length ? `${missing.length} of these systems still need an emulator.` : 'Every system is ready to play.'}
          </p>
        ) : (
          <p>Check that each system has its own sub-folder with a recognized name, then scan again.</p>
        )
      }
      actions={
        <>
          {result && !scanning && (
            <Button size="xl" icon={RefreshCw} onPress={scan} autoFocus={!result.total}>
              Scan again
            </Button>
          )}
          {missing.length > 0 && !allInstalled && (
            <Button variant="primary" size="xl" icon={Download} onPress={installAll} busy={installing} autoFocus>
              {`Install emulators for ${missing.length} system${missing.length === 1 ? '' : 's'}`}
            </Button>
          )}
          <Button
            variant={missing.length > 0 && !allInstalled ? 'secondary' : 'primary'}
            size="xl"
            icon={ArrowRight}
            onPress={onNext}
            disabled={scanning || installing}
            autoFocus={!!result?.total && (missing.length === 0 || allInstalled)}
          >
            {missing.length > 0 && !allInstalled ? 'Skip' : 'Continue'}
          </Button>
        </>
      }
    >
      {scanning && (
        <div className="install-progress">
          <span>{scanTask?.detail ?? 'Starting'}</span>
          <ProgressBar value={scanTask?.progress ?? -1} />
        </div>
      )}
      {!scanning && found.length > 0 && (
        <ul className="found">
          {found.map((s) => (
            <FoundSystem key={s.id} system={s} state={installState[s.id]} detail={installState[s.id] === 'working' ? installTask : undefined} />
          ))}
        </ul>
      )}
    </StepFrame>
  )
}

function FoundSystem({ system, state, detail }: { system: SystemSummary; state?: 'pending' | 'working' | 'done' | 'error'; detail?: { progress: number; label: string } }) {
  const ready = system.playable || state === 'done'
  return (
    <li className={`found__item ${ready ? 'is-ready' : ''}`}>
      <span className="found__dot" style={{ background: system.color }} />
      <span className="found__name">{system.name}</span>
      <span className="found__count">{formatNumber(system.gameCount)}</span>
      <span className="found__state">
        {state === 'working' ? (
          <ProgressBar value={detail?.progress ?? -1} />
        ) : state === 'error' ? (
          'Install failed'
        ) : ready ? (
          <>
            <Check size="1em" /> Ready
          </>
        ) : (
          'Needs emulator'
        )}
      </span>
    </li>
  )
}

function ArtworkStep({ onNext }: { onNext: () => void }) {
  const [state, setState] = useState<'idle' | 'working' | 'done'>('idle')
  const task = useTasks((s) => findRunningTask(s, { kinds: ['artwork'] }, (l) => /art/i.test(l)))
  const total = useLibrary((s) => s.systems.reduce((n, x) => n + x.gameCount, 0))
  const run = async () => {
    setState('working')
    try {
      await api.library.fetchArtwork()
      setState('done')
    } catch (e) {
      toast(`Artwork download failed: ${e instanceof Error ? e.message : String(e)}`, 'error')
      setState('idle')
    }
  }
  return (
    <StepFrame
      title="Covers make it feel like a console"
      lead={<p>RetroDesk can download box art and screenshots for your games from the free libretro-thumbnails collection. Games without art get a generated cover.</p>}
      actions={
        <>
          {state !== 'done' && (
            <Button variant="primary" size="xl" icon={ImageDown} onPress={run} busy={state === 'working'} autoFocus disabled={total === 0}>
              Download artwork
            </Button>
          )}
          <Button variant={state === 'done' ? 'primary' : 'secondary'} size="xl" icon={ArrowRight} onPress={onNext} autoFocus={state === 'done' || total === 0}>
            {state === 'done' ? 'Continue' : state === 'working' ? 'Continue in background' : 'Skip'}
          </Button>
        </>
      }
    >
      {state === 'working' && (
        <div className="install-progress">
          <span>{task?.detail ?? 'Starting'}</span>
          <ProgressBar value={task?.progress ?? -1} />
        </div>
      )}
      {state === 'done' && (
        <p className="ok-line">
          <Check size="1em" /> Artwork is up to date.
        </p>
      )}
    </StepFrame>
  )
}

function DoneStep() {
  const update = useSettings((s) => s.update)
  const total = useLibrary((s) => s.systems.reduce((n, x) => n + x.gameCount, 0))
  return (
    <StepFrame
      title="You're all set"
      lead={
        <>
          <p>{total ? `${formatNumber(total)} games are waiting on your shelf.` : 'Add games whenever you are ready; the Home screen shows you how.'}</p>
          <p>While playing, hold Back + Start on your controller, or press Ctrl + Alt + Home, to open the quick menu.</p>
        </>
      }
      actions={
        <Button variant="primary" size="xl" icon={Play} autoFocus onPress={() => void update({ onboarded: true })}>
          Start playing
        </Button>
      }
    />
  )
}
