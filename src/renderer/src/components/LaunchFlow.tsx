import { useCallback, useState, type ReactNode } from 'react'
import { Download, Settings2, ShieldCheck } from 'lucide-react'
import type { Game } from '@shared/types'
import { api } from '../api'
import { playSound } from '../lib/sound'
import { defaultKeyForSystem } from '../lib/emulators'
import { systemById, useLibrary } from '../stores/library'
import { useSettings } from '../stores/settings'
import { useNav } from '../stores/nav'
import { findRunningTask, toast, useTasks } from '../stores/session'
import { Button } from './Button'
import { ProgressBar } from './Controls'
import { Modal } from './Modal'

type Problem =
  | { kind: 'emulator'; game: Game; error: string }
  | { kind: 'bios'; game: Game; error: string }
  | { kind: 'firewall'; game: Game }
  | null

const FIREWALL_NOTICE_KEY = 'retrodesk.firewallNoticeSeen'

/**
 * RetroArch's network-command port (used by the quick menu) listens on all interfaces, so Windows Firewall asks
 * about it the first time. Local commands work either way; warn once so the prompt isn't a surprise mid-game.
 */
function needsFirewallNotice(g: Game): boolean {
  try {
    if (localStorage.getItem(FIREWALL_NOTICE_KEY)) return false
  } catch {
    return false
  }
  const system = systemById(useLibrary.getState().systems, g.systemId)
  const settings = useSettings.getState().settings
  const key = g.emulatorOverride ?? (system ? defaultKeyForSystem(system, settings?.systemEmulator ?? {}) : undefined)
  return !!key?.startsWith('retroarch')
}

/**
 * Launch a game and handle the two recoverable failures: a missing emulator (offer one-click install
 * then retry) and missing BIOS files (explain and link to the BIOS settings).
 */
export function useLauncher(): { launch: (g: Game, skipNotice?: boolean) => Promise<void>; launching: string | null; dialog: ReactNode } {
  const [launching, setLaunching] = useState<string | null>(null)
  const [problem, setProblem] = useState<Problem>(null)
  const [installing, setInstalling] = useState(false)
  const systems = useLibrary((s) => s.systems)
  const push = useNav((s) => s.push)
  const installTask = useTasks((s) => findRunningTask(s, { kinds: ['system', 'emulator'] }, (l) => /install/i.test(l)))

  const launch = useCallback(async (g: Game, skipNotice = false) => {
    if (!skipNotice && needsFirewallNotice(g)) {
      setProblem({ kind: 'firewall', game: g })
      return
    }
    setLaunching(g.id)
    try {
      const res = await api.game.launch(g.id)
      if (res.ok) return
      if (res.needs === 'emulator') setProblem({ kind: 'emulator', game: g, error: res.error })
      else if (res.needs === 'bios') setProblem({ kind: 'bios', game: g, error: res.error })
      else {
        playSound('error')
        toast(`Couldn't start ${g.title}: ${res.error}`, 'error')
      }
    } catch (e) {
      playSound('error')
      toast(`Couldn't start ${g.title}: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setLaunching(null)
    }
  }, [])

  const installAndRetry = async () => {
    if (problem?.kind !== 'emulator') return
    const game = problem.game
    setInstalling(true)
    try {
      await api.emulators.installForSystem(game.systemId)
      await useLibrary.getState().refreshEmulators()
      setProblem(null)
      toast('Emulator installed. Starting game…', 'success')
      await launch(game, true)
    } catch (e) {
      toast(`Install failed: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setInstalling(false)
    }
  }

  let dialog: ReactNode = null
  if (problem) {
    const system = systemById(systems, problem.game.systemId)
    const sysName = system?.name ?? problem.game.systemId
    if (problem.kind === 'firewall') {
      const game = problem.game
      const proceed = () => {
        try {
          localStorage.setItem(FIREWALL_NOTICE_KEY, '1')
        } catch {
          /* storage unavailable: the notice simply shows again next time */
        }
        setProblem(null)
        void launch(game, true)
      }
      dialog = (
        <Modal
          title="One-time heads up"
          description={
            <>
              <p>
                The first time RetroArch starts, Windows Firewall may ask whether it can access networks. RetroDesk only talks to RetroArch on
                this PC (for the quick menu: save states, pause, quit), which works whichever button you press.
              </p>
              <p>Choose Cancel unless you also want RetroArch netplay online.</p>
            </>
          }
          onClose={() => setProblem(null)}
          footer={
            <Button variant="primary" icon={ShieldCheck} onPress={proceed} autoFocus>
              Got it, start {game.title}
            </Button>
          }
        />
      )
    } else if (problem.kind === 'emulator') {
      dialog = (
        <Modal
          title={`Install an emulator for ${sysName}`}
          description={
            <>
              <p>{problem.error}</p>
              <p>RetroDesk can download and set it up for you, then start {problem.game.title}.</p>
            </>
          }
          onClose={() => !installing && setProblem(null)}
          closeLabel={installing ? 'Working' : 'Cancel'}
          footer={
            <>
              <Button variant="secondary" onPress={() => setProblem(null)} disabled={installing}>
                Not now
              </Button>
              <Button variant="primary" icon={Download} onPress={installAndRetry} busy={installing} autoFocus>
                Install and play
              </Button>
            </>
          }
        >
          {installing && (
            <div className="install-progress">
              <span>{installTask ? `${installTask.label}${installTask.detail ? `: ${installTask.detail}` : ''}` : 'Preparing download'}</span>
              <ProgressBar value={installTask?.progress ?? -1} />
            </div>
          )}
        </Modal>
      )
    } else {
      dialog = (
        <Modal
          title={`${sysName} needs BIOS files`}
          description={
            <>
              <p>{problem.error}</p>
              <p>BIOS files come from your own console. Copy them into RetroDesk from the BIOS settings page; they are checked automatically.</p>
            </>
          }
          onClose={() => setProblem(null)}
          footer={
            <>
              <Button variant="secondary" onPress={() => setProblem(null)}>
                Close
              </Button>
              <Button
                variant="primary"
                icon={Settings2}
                autoFocus
                onPress={() => {
                  setProblem(null)
                  push({ name: 'settings', tab: 'bios' })
                }}
              >
                Open BIOS settings
              </Button>
            </>
          }
        />
      )
    }
  }
  return { launch, launching, dialog }
}
