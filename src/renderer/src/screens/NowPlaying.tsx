import { useEffect, useState } from 'react'
import { mediaUrl } from '@shared/media'
import { Power } from 'lucide-react'
import type { Game, SessionInfo } from '@shared/types'
import { api } from '../api'
import { Button } from '../components/Button'
import { GameCover } from '../components/GameCover'
import { KeyCap, PadButton } from '../components/Glyph'
import { ConfirmDialog } from '../components/Modal'
import { Motif, motifFor } from '../components/Motif'
import { systemStyle } from '../components/SystemCard'
import { useNow } from '../lib/hooks'
import { formatDuration } from '../lib/format'
import { keyLabel } from '../lib/emulators'
import { useInputStore } from '../stores/input'
import { systemById, useLibrary } from '../stores/library'
import { toast } from '../stores/session'
import { useSettingsValue } from '../stores/settings'

/** Shown in the main window while a game runs (the game is normally in front of it). */
export function NowPlaying({ session }: { session: SessionInfo }) {
  const now = useNow(1000)
  const systems = useLibrary((s) => s.systems)
  const emulators = useLibrary((s) => s.emulators)
  const settings = useSettingsValue()
  const family = useInputStore((s) => s.pads[0]?.family ?? 'xbox')
  const [game, setGame] = useState<Game | null>(null)
  const [confirm, setConfirm] = useState(false)
  const system = systemById(systems, session.systemId)

  useEffect(() => {
    void api.library.getGame(session.gameId).then(setGame)
  }, [session.gameId])

  const art = mediaUrl(game?.media.snap ?? game?.media.boxart)
  const combo = settings.hotkeys.quickMenuCombo
  const accel = settings.hotkeys.quickMenu.split('+').map((k) => (k === 'Control' ? 'Ctrl' : k))

  const quit = async () => {
    setConfirm(false)
    try {
      await api.game.quickAction('quit')
    } catch (e) {
      toast(`Couldn't quit the game: ${e instanceof Error ? e.message : String(e)}`, 'error')
    }
  }

  return (
    <div className="nowplaying" style={systemStyle(system ?? { id: session.systemId })}>
      <div className="nowplaying__backdrop" aria-hidden="true">
        {art ? <img src={art} alt="" /> : <Motif kind={motifFor(system?.manufacturer, session.systemId)} className="nowplaying__motif" />}
      </div>
      <div className="nowplaying__inner">
        <div className="nowplaying__cover">
          <GameCover game={game ?? { id: session.gameId, title: session.title, media: {}, systemId: session.systemId }} system={system} />
        </div>
        <div className="nowplaying__info">
          <span className="nowplaying__live">
            <i /> Now playing
          </span>
          <h1 className="nowplaying__title">{session.title}</h1>
          <p className="nowplaying__meta">
            {system?.name ?? session.systemId}, in {keyLabel(session.emulatorId, emulators)}
          </p>
          <span className="nowplaying__timer">{formatDuration(now.getTime() - session.startedAt)}</span>
          <div className="nowplaying__hint">
            <span>Open the quick menu in-game:</span>
            <span className="keys">
              {combo.map((b, i) => (
                <span key={b} className="keys__item">
                  {i > 0 && '+'}
                  <PadButton family={family} index={b} />
                </span>
              ))}
            </span>
            <span>or</span>
            <span className="keys">
              {accel.map((k) => (
                <KeyCap key={k} label={k} />
              ))}
            </span>
          </div>
          <div className="nowplaying__actions">
            <Button variant="danger" size="lg" icon={Power} onPress={() => setConfirm(true)} autoFocus>
              Quit game
            </Button>
          </div>
        </div>
      </div>
      {confirm && (
        <ConfirmDialog
          title={`Quit ${session.title}?`}
          description={settings.retroarch.autoSaveState && session.supportsCommands ? 'Your progress is saved to a quick-resume state first.' : 'Unsaved progress since your last in-game save will be lost.'}
          confirmLabel="Quit game"
          danger
          onCancel={() => setConfirm(false)}
          onConfirm={quit}
        />
      )}
    </div>
  )
}
