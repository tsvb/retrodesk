import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleDashed, FileUp, FolderOpen, XCircle } from 'lucide-react'
import type { BiosStatus } from '@shared/types'
import { api } from '../../api'
import { Button } from '../../components/Button'
import { Spinner } from '../../components/Controls'
import { useFocusable } from '../../input/hooks'
import { useLibrary } from '../../stores/library'
import { toast } from '../../stores/session'
import { Section } from './Settings'

export function BiosTab() {
  const [list, setList] = useState<BiosStatus[] | null>(null)
  const [importing, setImporting] = useState(false)
  const systems = useLibrary((s) => s.systems)

  useEffect(() => {
    let alive = true
    api.bios.check().then((l) => alive && setList(l))
    return () => {
      alive = false
    }
  }, [])

  const doImport = async () => {
    const paths = await api.system.pickFiles({ title: 'Import BIOS files', extensions: ['.bin', '.rom', '.zip', '.bios', '.img'] })
    if (!paths.length) return
    setImporting(true)
    try {
      const before = new Set((list ?? []).filter((b) => b.present).map((b) => b.file))
      const next = await api.bios.importFiles(paths)
      setList(next)
      const added = next.filter((b) => b.present && !before.has(b.file)).length
      toast(added ? `Added ${added} BIOS file${added === 1 ? '' : 's'}` : 'Those files did not match any known BIOS', added ? 'success' : 'info')
    } catch (e) {
      toast(`BIOS import failed: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setImporting(false)
    }
  }

  const required = (list ?? []).filter((b) => b.required)
  const okRequired = required.filter((b) => b.present && b.valid).length
  const sysName = (id: string) => systems.find((s) => s.id === id)?.name ?? id

  return (
    <>
      <Section
        description="Some systems need firmware dumped from the original console. Pick the files and RetroDesk copies them to the right place, checking each one against its known checksum."
        aside={null}
      >
        <div className="button-row">
          <Button variant="primary" icon={FileUp} busy={importing} onPress={doImport}>
            Import BIOS files
          </Button>
          <Button
            icon={FolderOpen}
            onPress={async () => {
              const p = await api.system.getPaths()
              await api.system.openPath(p.bios)
            }}
          >
            Open BIOS folder
          </Button>
        </div>
        {list && required.length > 0 && (
          <p className={`bios-summary ${okRequired === required.length ? 'is-ok' : ''}`}>
            {okRequired} of {required.length} required files are in place.
          </p>
        )}
      </Section>
      <Section title="Files">
        {!list ? (
          <Spinner />
        ) : list.length === 0 ? (
          <p className="muted">None of your systems need BIOS files.</p>
        ) : (
          <table className="bios">
            <thead>
              <tr>
                <th>System</th>
                <th>File</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((b) => (
                <BiosRow key={`${b.systemId}/${b.file}`} b={b} systemName={sysName(b.systemId)} />
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </>
  )
}

function BiosRow({ b, systemName }: { b: BiosStatus; systemName: string }) {
  // Rows are focusable (without an action) so a controller can scroll through the table.
  const { props } = useFocusable<HTMLTableRowElement>({ group: 'bios-rows' })
  return (
    <tr className="bios__row" {...props}>
      <td>{systemName}</td>
      <td>
        <span className="bios__file">{b.file}</span>
        <span className="bios__desc">
          {b.description}
          {b.required ? '' : ', optional'}
        </span>
      </td>
      <td>
        <BiosState b={b} />
      </td>
    </tr>
  )
}

function BiosState({ b }: { b: BiosStatus }) {
  if (b.present && b.valid)
    return (
      <span className="bios__state is-ok">
        <CheckCircle2 size="1.1em" /> Verified
      </span>
    )
  if (b.present)
    return (
      <span className="bios__state is-warn">
        <AlertTriangle size="1.1em" /> Checksum mismatch
      </span>
    )
  if (b.required)
    return (
      <span className="bios__state is-bad">
        <XCircle size="1.1em" /> Missing
      </span>
    )
  return (
    <span className="bios__state is-dim">
      <CircleDashed size="1.1em" /> Not added
    </span>
  )
}
