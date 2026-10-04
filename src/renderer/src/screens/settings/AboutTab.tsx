import { useEffect, useState } from 'react'
import { FolderOpen, LogOut, Wand2 } from 'lucide-react'
import { api, isElectron } from '../../api'
import { Button } from '../../components/Button'
import { SettingRow } from '../../components/Controls'
import { Wordmark } from '../../components/TopBar'
import { useSettings } from '../../stores/settings'
import { Section } from './Settings'

type Paths = Awaited<ReturnType<typeof api.system.getPaths>>

const PATH_LABELS: Record<keyof Paths, string> = {
  dataRoot: 'Data folder',
  roms: 'Imported ROMs',
  bios: 'BIOS files',
  saves: 'Save files',
  states: 'Save states',
  screenshots: 'Screenshots',
  emulators: 'Emulators',
  media: 'Artwork'
}

export function AboutTab() {
  const [version, setVersion] = useState('')
  const [paths, setPaths] = useState<Paths | null>(null)
  const update = useSettings((s) => s.update)
  useEffect(() => {
    void api.system.getVersion().then(setVersion)
    void api.system.getPaths().then(setPaths)
  }, [])
  return (
    <>
      <div className="about">
        <Wordmark />
        <p>
          Version {version || '…'}
          {!isElectron && ' (browser preview with sample data)'}
        </p>
        <p className="muted">A handheld-style home for your emulators, built for the couch and the desk.</p>
      </div>
      <Section title="Folders">
        {paths &&
          (Object.keys(PATH_LABELS) as (keyof Paths)[]).map((k) => (
            <SettingRow key={k} title={PATH_LABELS[k]} description={paths[k]}>
              <Button size="sm" icon={FolderOpen} onPress={() => void api.system.openPath(paths[k])} label="Open folder">
                Open folder
              </Button>
            </SettingRow>
          ))}
      </Section>
      <Section title="Other">
        <div className="button-row">
          <Button icon={Wand2} onPress={() => void update({ onboarded: false })}>
            Run setup again
          </Button>
          <Button icon={LogOut} variant="danger" onPress={() => void api.window.quit()}>
            Quit RetroDesk
          </Button>
        </div>
      </Section>
    </>
  )
}
