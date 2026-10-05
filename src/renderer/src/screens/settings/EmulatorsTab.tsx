import { useEffect, useState } from 'react'
import { Download, ExternalLink, Trash2 } from 'lucide-react'
import type { EmulatorStatus } from '@shared/types'
import { api } from '../../api'
import { Button } from '../../components/Button'
import { PickerRow, ProgressBar } from '../../components/Controls'
import { ConfirmDialog } from '../../components/Modal'
import { defaultKeyForSystem, isKeyInstalled, keyLabel, refKey } from '../../lib/emulators'
import { formatBytes } from '../../lib/format'
import { feedback } from '../../lib/feedback'
import { useLibrary } from '../../stores/library'
import { findRunningTask, toast, useTasks } from '../../stores/session'
import { useSettings, useSettingsValue } from '../../stores/settings'
import { Section } from './Settings'

export function EmulatorsTab() {
  const emulators = useLibrary((s) => s.emulators)
  const systems = useLibrary((s) => s.systems)
  const settings = useSettingsValue()
  const update = useSettings((s) => s.update)

  useEffect(() => {
    void useLibrary.getState().refreshEmulators()
  }, [])

  const groups: { title: string; description: string; items: EmulatorStatus[] }[] = [
    {
      title: 'RetroArch',
      description: 'The multi-system frontend that runs the libretro cores below. Supports the in-game quick menu actions.',
      items: emulators.filter((e) => e.kind === 'retroarch')
    },
    { title: 'RetroArch cores', description: 'One core per system family. They need RetroArch installed.', items: emulators.filter((e) => e.kind === 'core') },
    { title: 'Standalone emulators', description: 'Dedicated emulators for newer systems.', items: emulators.filter((e) => e.kind === 'standalone') }
  ]

  const choosable = systems.filter((s) => s.emulators.length > 1 && (s.gameCount > 0 || !settings.ui.hideEmptySystems))

  return (
    <>
      {groups.map((g) =>
        g.items.length ? (
          <Section key={g.title} title={g.title} description={g.description}>
            {g.items.map((e) => (
              <EmulatorRow key={e.id} emu={e} systemNames={e.systems.map((id) => systems.find((s) => s.id === id)?.shortName ?? id)} />
            ))}
          </Section>
        ) : null
      )}
      {choosable.length > 0 && (
        <Section title="Default emulator per system" description="Used for every game of that system unless the game has its own choice.">
          {choosable.map((s) => {
            const current = defaultKeyForSystem(s, settings.systemEmulator) ?? ''
            return (
              <PickerRow
                key={s.id}
                title={s.name}
                value={current}
                options={s.emulators.map((ref) => {
                  const key = refKey(ref)
                  return { value: key, label: keyLabel(key, emulators), hint: isKeyInstalled(key, emulators) ? 'Installed' : 'Not installed' }
                })}
                onChange={(v) => void update({ systemEmulator: { [s.id]: v } })}
              />
            )
          })}
        </Section>
      )}
    </>
  )
}

function EmulatorRow({ emu, systemNames }: { emu: EmulatorStatus; systemNames: string[] }) {
  const task = useTasks((s) => findRunningTask(s, { kinds: ['emulator'], id: emu.id }, (l) => l.toLowerCase().includes(emu.name.toLowerCase())))
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const install = async () => {
    setBusy(true)
    try {
      await api.emulators.install(emu.id)
      toast(`${emu.name} installed`, 'success')
    } catch (e) {
      feedback('error')
      toast(`Couldn't install ${emu.name}: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setBusy(false)
      void useLibrary.getState().refreshEmulators()
    }
  }
  const uninstall = async () => {
    setConfirm(false)
    try {
      await api.emulators.uninstall(emu.id)
      toast(`${emu.name} removed`, 'info')
    } catch (e) {
      toast(`Couldn't remove ${emu.name}: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      void useLibrary.getState().refreshEmulators()
    }
  }
  const working = busy || !!task
  return (
    <div className={`emu ${emu.installed ? 'is-installed' : ''}`}>
      <div className="emu__text">
        <span className="emu__name">
          {emu.name}
          <span className={`badge ${emu.installed ? 'badge--ok' : 'badge--dim'}`}>{emu.installed ? `Installed${emu.version ? ` ${emu.version}` : ''}` : 'Not installed'}</span>
        </span>
        <span className="emu__meta">
          {systemNames.join(', ')}
          {emu.installed && emu.sizeBytes ? `. ${formatBytes(emu.sizeBytes)} on disk` : ''}
        </span>
        {working && (
          <span className="emu__progress">
            <ProgressBar value={task?.progress ?? -1} />
            <small>{task?.detail ?? 'Starting'}</small>
          </span>
        )}
      </div>
      <div className="emu__actions">
        {emu.installed ? (
          <>
            {emu.kind !== 'core' && (
              <Button size="sm" icon={ExternalLink} onPress={() => void api.emulators.openEmulatorUi(emu.id)}>
                Open
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={Trash2} onPress={() => setConfirm(true)} label="Uninstall" title="Uninstall" />
          </>
        ) : (
          <Button size="sm" variant="primary" icon={Download} busy={working} onPress={install}>
            Install
          </Button>
        )}
      </div>
      {confirm && (
        <ConfirmDialog
          title={`Uninstall ${emu.name}?`}
          description="Saves and states are kept. You can reinstall it at any time."
          confirmLabel="Uninstall"
          danger
          onCancel={() => setConfirm(false)}
          onConfirm={uninstall}
        />
      )}
    </div>
  )
}
