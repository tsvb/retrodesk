import { useEffect, useState } from 'react'
import { Eye, FolderOpen, FolderPlus, ImageDown, RefreshCw, Tag, Trash2, Upload } from 'lucide-react'
import type { Game, RomFolder } from '@shared/types'
import { api } from '../../api'
import { Button } from '../../components/Button'
import { PickerModal, PickerRow, SettingRow, ToggleRow, type Option } from '../../components/Controls'
import { ConfirmDialog } from '../../components/Modal'
import { addRomFolder, fetchArtwork, importRomFiles, rescan } from '../../lib/libraryActions'
import { useLibrary } from '../../stores/library'
import { toast } from '../../stores/session'
import { useSettings, useSettingsValue } from '../../stores/settings'
import { Section } from './Settings'

const AUTO = '__auto__'

export function LibraryTab() {
  const settings = useSettingsValue()
  const update = useSettings((s) => s.update)
  const systems = useLibrary((s) => s.systems)
  const version = useLibrary((s) => s.version)
  const [scanning, setScanning] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [assigning, setAssigning] = useState<RomFolder | null>(null)
  const [removing, setRemoving] = useState<RomFolder | null>(null)
  const [newDataRoot, setNewDataRoot] = useState<string | null>(null)
  const [hidden, setHidden] = useState<Game[]>([])

  useEffect(() => {
    let alive = true
    api.library.getGames({ includeHidden: true }).then((g) => alive && setHidden(g.filter((x) => x.hidden)))
    return () => {
      alive = false
    }
  }, [version])

  const systemOptions: Option<string>[] = [
    { value: AUTO, label: 'Detect from sub-folders', hint: 'roms/snes, roms/psx, roms/Nintendo 64 and so on' },
    ...[...systems].sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ value: s.id, label: s.name, hint: s.extensions.join(' ') }))
  ]
  const systemName = (id?: string) => (id ? (systems.find((s) => s.id === id)?.name ?? id) : 'Systems detected from sub-folders')

  const setFolders = (folders: RomFolder[]) => update({ romFolders: folders })

  return (
    <>
      <Section
        title="ROM folders"
        description="RetroDesk looks inside these folders for games. Give each system its own sub-folder, or assign a whole folder to one system."
      >
        {settings.romFolders.length === 0 && <p className="muted">No folders yet. Add the folder that holds your games.</p>}
        {settings.romFolders.map((f) => (
          <div className="folder" key={f.path}>
            <FolderOpen className="folder__icon" size="1.4em" />
            <div className="folder__text">
              <span className="folder__path">{f.path}</span>
              <span className="folder__sys">{systemName(f.systemId)}</span>
            </div>
            <Button icon={Tag} size="sm" onPress={() => setAssigning(f)} label="Assign system" title="Assign a system">
              {f.systemId ? 'Change system' : 'Assign system'}
            </Button>
            <Button icon={Trash2} size="sm" variant="ghost" onPress={() => setRemoving(f)} label="Remove folder" title="Remove folder" />
          </div>
        ))}
        <div className="button-row">
          <Button icon={FolderPlus} variant="primary" onPress={() => void addRomFolder()}>
            Add folder
          </Button>
          <Button
            icon={RefreshCw}
            busy={scanning}
            onPress={async () => {
              setScanning(true)
              await rescan()
              setScanning(false)
            }}
          >
            Rescan library
          </Button>
          <Button icon={Upload} onPress={() => void importRomFiles()}>
            Import ROM files
          </Button>
        </div>
        <p className="settings-section__note">Imported files are copied to {settings.dataRoot}\roms\&lt;system&gt;. You can also drop files onto the window.</p>
      </Section>

      <Section title="Artwork">
        <ToggleRow
          title="Download artwork automatically"
          description="Fetch box art and screenshots from libretro-thumbnails after each scan."
          value={settings.scraping.autoFetchArtwork}
          onChange={(v) => void update({ scraping: { autoFetchArtwork: v } })}
        />
        <PickerRow
          title="Preferred region"
          description="Used when a game has artwork for several regions."
          value={settings.scraping.preferredRegion}
          options={[
            { value: 'USA', label: 'USA' },
            { value: 'Europe', label: 'Europe' },
            { value: 'Japan', label: 'Japan' },
            { value: 'World', label: 'World' }
          ]}
          onChange={(v) => void update({ scraping: { preferredRegion: v } })}
        />
        <div className="button-row">
          <Button
            icon={ImageDown}
            busy={fetching}
            onPress={async () => {
              setFetching(true)
              await fetchArtwork()
              setFetching(false)
            }}
          >
            Fetch missing artwork
          </Button>
        </div>
      </Section>

      <Section title="Data folder" description="Emulators, BIOS files, saves, states, screenshots and artwork live here.">
        <SettingRow title={settings.dataRoot}>
          <Button icon={FolderOpen} size="sm" onPress={() => void api.system.openPath(settings.dataRoot)}>
            Open
          </Button>
          <Button
            size="sm"
            onPress={async () => {
              const p = await api.system.pickFolder('Choose the RetroDesk data folder')
              if (p && p !== settings.dataRoot) setNewDataRoot(p)
            }}
          >
            Change
          </Button>
        </SettingRow>
      </Section>

      {hidden.length > 0 && (
        <Section title="Hidden games" description="These games are kept out of every list.">
          {hidden.map((g) => (
            <SettingRow key={g.id} title={g.title} description={systemName(g.systemId)}>
              <Button
                icon={Eye}
                size="sm"
                onPress={async () => {
                  await useLibrary.getState().setHidden(g, false)
                  toast(`${g.title} is back in your library`, 'success')
                }}
              >
                Show
              </Button>
            </SettingRow>
          ))}
        </Section>
      )}

      {assigning && (
        <PickerModal
          title="Which system is in this folder?"
          description={assigning.path}
          options={systemOptions}
          value={assigning.systemId ?? AUTO}
          onClose={() => setAssigning(null)}
          onPick={(v) => {
            const target = assigning
            setAssigning(null)
            void setFolders(settings.romFolders.map((f) => (f.path === target.path ? (v === AUTO ? { path: f.path } : { path: f.path, systemId: v }) : f)))
          }}
        />
      )}
      {newDataRoot && (
        <ConfirmDialog
          title="Switch to this data folder?"
          description={`RetroDesk will use ${newDataRoot} from now on. Artwork is copied across. Emulators, BIOS files and saves are not: they stay in ${settings.dataRoot} and will no longer be used. Games in its roms folder leave your library, with their play time, on the next scan.`}
          confirmLabel="Switch folder"
          danger
          onCancel={() => setNewDataRoot(null)}
          onConfirm={() => {
            const target = newDataRoot
            setNewDataRoot(null)
            void update({ dataRoot: target }).then(() => toast(`Data folder set to ${target}.`, 'info'))
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title="Remove this folder?"
          description={`${removing.path} will no longer be scanned. Your files are not touched.`}
          confirmLabel="Remove folder"
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const target = removing
            setRemoving(null)
            void setFolders(settings.romFolders.filter((f) => f.path !== target.path)).then(() => toast('Folder removed. Rescan to update your library.', 'info'))
          }}
        />
      )}
    </>
  )
}
