import { useEffect, useState } from 'react'
import { mediaUrl } from '@shared/media'
import { Cpu, EyeOff, Heart, Play } from 'lucide-react'
import type { Game } from '@shared/types'
import { api } from '../api'
import { Button } from '../components/Button'
import { PickerModal, type Option } from '../components/Controls'
import { toggleFavorite } from '../components/GameCard'
import { GameCover } from '../components/GameCover'
import { useLauncher } from '../components/LaunchFlow'
import { ConfirmDialog } from '../components/Modal'
import { Motif, motifFor } from '../components/Motif'
import { systemStyle } from '../components/SystemCard'
import { useActions, useFocusGroup } from '../input/hooks'
import { systemColor } from '../lib/color'
import { defaultKeyForSystem, isKeyInstalled, keyLabel, refKey } from '../lib/emulators'
import { formatBytes, formatPlayTime, formatRelative } from '../lib/format'
import { systemById, useLibrary } from '../stores/library'
import { useNav } from '../stores/nav'
import { toast } from '../stores/session'
import { useSettings } from '../stores/settings'
import { useUi } from '../stores/ui'

const DEFAULT = '__default__'
const NO_OVERRIDES: Record<string, string> = {}

export function GameDetailScreen({ gameId }: { gameId: string }) {
  const [loaded, setLoaded] = useState<Game | null | undefined>(undefined)
  const patch = useLibrary((s) => s.patches[gameId])
  const version = useLibrary((s) => s.version)
  const systems = useLibrary((s) => s.systems)
  const emulators = useLibrary((s) => s.emulators)
  const systemEmulator = useSettings((s) => s.settings?.systemEmulator ?? NO_OVERRIDES)
  const back = useNav((s) => s.back)
  const setAmbient = useUi((s) => s.setAmbient)
  const { launch, launching, dialog } = useLauncher()
  const [picking, setPicking] = useState(false)
  const [confirmHide, setConfirmHide] = useState(false)

  useFocusGroup('detail-actions', { memory: false })

  useEffect(() => {
    let alive = true
    api.library.getGame(gameId).then((g) => alive && setLoaded(g))
    return () => {
      alive = false
    }
  }, [gameId, version])

  const game = patch ?? loaded
  const system = systemById(systems, game?.systemId)

  useEffect(() => {
    if (system) setAmbient(systemColor(system))
  }, [system, setAmbient])

  useActions({ menu: game ? { label: 'Emulator', run: () => setPicking(true) } : undefined })

  if (game === undefined) return <div className="screen screen--detail is-loading" />
  if (game === null)
    return (
      <div className="screen screen--detail">
        <p className="muted">This game is no longer in your library.</p>
        <Button onPress={back} autoFocus>
          Go back
        </Button>
      </div>
    )

  const art = mediaUrl(game.media.snap ?? game.media.title ?? game.media.boxart)
  const sysDefault = system ? defaultKeyForSystem(system, systemEmulator) : undefined
  const effective = game.emulatorOverride ?? sysDefault
  const emuName = effective ? keyLabel(effective, emulators) : 'No emulator'
  const emuReady = effective ? isKeyInstalled(effective, emulators) : false

  const emuOptions: Option<string>[] = [
    { value: DEFAULT, label: `System default`, hint: sysDefault ? keyLabel(sysDefault, emulators) : undefined },
    ...(system?.emulators ?? []).map((ref) => {
      const key = refKey(ref)
      return { value: key, label: keyLabel(key, emulators), hint: isKeyInstalled(key, emulators) ? 'Installed' : 'Not installed, installs on first play' }
    })
  ]

  const tags = [...game.regions, ...game.tags]

  return (
    <div className="screen screen--detail" style={systemStyle(system ?? { id: game.systemId })}>
      <div className="detail__backdrop" aria-hidden="true">
        {art ? <img src={art} alt="" /> : <Motif kind={motifFor(system?.manufacturer, game.systemId)} className="detail__motif" />}
      </div>
      <div className="detail">
        <div className="detail__cover">
          <GameCover game={game} system={system} />
        </div>
        <div className="detail__info">
          <span className="chip chip--system">
            <i />
            {system?.name ?? game.systemId}
          </span>
          <h1 className={`detail__title ${game.title.length > 30 ? 'is-long' : ''}`}>{game.title}</h1>
          {tags.length > 0 && (
            <div className="detail__tags">
              {tags.map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
            </div>
          )}
          <div className="detail__actions">
            <Button variant="primary" size="xl" icon={Play} autoFocus group="detail-actions" busy={launching === game.id} onPress={() => void launch(game)}>
              Play
            </Button>
            <Button
              size="xl"
              icon={Heart}
              group="detail-actions"
              className={game.favorite ? 'is-fav' : ''}
              onPress={() => void toggleFavorite(game)}
              label={game.favorite ? 'Unfavourite' : 'Favourite'}
            >
              {game.favorite ? 'Favourite' : 'Add to favourites'}
            </Button>
            <Button size="xl" icon={Cpu} group="detail-actions" onPress={() => setPicking(true)} label="Change emulator">
              {emuName}
            </Button>
            <Button size="xl" icon={EyeOff} group="detail-actions" variant="ghost" onPress={() => setConfirmHide(true)} label="Hide game" title="Hide from library" />
          </div>
          {!emuReady && <p className="detail__note">The emulator isn't installed yet. Press Play and RetroDesk will offer to install it.</p>}
          <dl className="stats">
            <div>
              <dt>Play time</dt>
              <dd>{formatPlayTime(game.playTimeSec)}</dd>
            </div>
            <div>
              <dt>Times played</dt>
              <dd>{game.playCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Last played</dt>
              <dd>{formatRelative(game.lastPlayedAt)}</dd>
            </div>
            <div>
              <dt>Added</dt>
              <dd>{formatRelative(game.addedAt)}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{formatBytes(game.sizeBytes)}</dd>
            </div>
          </dl>
          <p className="detail__file" title={game.path}>
            {game.fileName}
          </p>
        </div>
      </div>
      {picking && (
        <PickerModal
          title="Emulator for this game"
          description={`Overrides the ${system?.name ?? 'system'} default for ${game.title} only.`}
          options={emuOptions}
          value={game.emulatorOverride ?? DEFAULT}
          onClose={() => setPicking(false)}
          onPick={async (v) => {
            setPicking(false)
            try {
              await useLibrary.getState().setOverride(game, v === DEFAULT ? null : v)
              toast(v === DEFAULT ? 'Using the system default emulator' : `${game.title} will use ${keyLabel(v, emulators)}`, 'success')
            } catch (e) {
              toast(`Couldn't change emulator: ${e instanceof Error ? e.message : String(e)}`, 'error')
            }
          }}
        />
      )}
      {confirmHide && (
        <ConfirmDialog
          title={`Hide ${game.title}?`}
          description="It disappears from every list but the file stays on disk. You can bring it back from Settings, under Library."
          confirmLabel="Hide game"
          danger
          onCancel={() => setConfirmHide(false)}
          onConfirm={async () => {
            setConfirmHide(false)
            await useLibrary.getState().setHidden(game, true)
            toast(`${game.title} is hidden`, 'info')
            back()
          }}
        />
      )}
      {dialog}
    </div>
  )
}
