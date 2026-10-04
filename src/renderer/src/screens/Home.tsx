import { useCallback, useEffect, type CSSProperties } from 'react'
import { mediaUrl } from '@shared/media'
import { FolderPlus, Heart, Info, Play, Upload, Wand2 } from 'lucide-react'
import type { Game, SystemSummary } from '@shared/types'
import { Button } from '../components/Button'
import { GameCard, toggleFavorite } from '../components/GameCard'
import { COVER_THUMB, GameCover } from '../components/GameCover'
import { useLauncher } from '../components/LaunchFlow'
import { Motif, motifFor } from '../components/Motif'
import { Row } from '../components/Row'
import { SystemCard, systemStyle } from '../components/SystemCard'
import { systemColor } from '../lib/color'
import { formatPlayTime, formatRelative, plural } from '../lib/format'
import { addRomFolder, importRomFiles, rescan } from '../lib/libraryActions'
import { systemById, useLibrary, usePatched } from '../stores/library'
import { useNav } from '../stores/nav'
import { useSettings } from '../stores/settings'
import { useUi } from '../stores/ui'

export function HomeScreen() {
  const loaded = useLibrary((s) => s.loaded)
  const systems = useLibrary((s) => s.systems)
  const recent = useLibrary((s) => s.recent)
  const favorites = useLibrary((s) => s.favorites)
  const recentlyAdded = useLibrary((s) => s.recentlyAdded)
  const hideEmpty = useSettings((s) => s.settings?.ui.hideEmptySystems ?? true)
  const push = useNav((s) => s.push)
  const setAmbient = useUi((s) => s.setAmbient)
  const { launch, launching, dialog } = useLauncher()

  const total = systems.reduce((n, s) => n + s.gameCount, 0)
  const hero = recent[0] ?? favorites[0] ?? recentlyAdded[0]
  const heroSystem = systemById(systems, hero?.systemId)
  const shownSystems = systems.filter((s) => !hideEmpty || s.gameCount > 0)

  useEffect(() => {
    setAmbient(heroSystem ? systemColor(heroSystem) : null)
  }, [heroSystem, setAmbient])

  // Stable handlers, so the memoized cards skip re-rendering when Home does.
  const openGame = useCallback((g: Game) => push({ name: 'game', gameId: g.id }), [push])
  const openSystem = useCallback((s: SystemSummary) => push({ name: 'games', systemId: s.id }), [push])
  const focusGame = useCallback((g: Game) => setAmbient(systemColor(systemById(systems, g.systemId) ?? { id: g.systemId })), [systems, setAmbient])
  const focusSystem = useCallback((s: SystemSummary) => setAmbient(systemColor(s)), [setAmbient])

  if (!loaded) return <div className="screen screen--home is-loading" />
  if (total === 0) return <EmptyLibrary />

  return (
    <div className="screen screen--home">
      {hero && <Hero game={hero} system={heroSystem} isRecent={recent[0]?.id === hero.id} busy={launching === hero.id} onPlay={() => launch(hero)} onDetails={() => openGame(hero)} />}

      {recent.length > 1 && (
        <Row id="home-recent" title="Jump back in">
          {recent.slice(1).map((g) => (
            <GameCard key={g.id} game={g} system={systemById(systems, g.systemId)} group="home-recent" showSystem onActivate={openGame} onFocus={focusGame} />
          ))}
        </Row>
      )}
      {favorites.length > 0 && (
        <Row id="home-favs" title="Favourites" aside={plural(favorites.length, 'game')}>
          {favorites.map((g) => (
            <GameCard key={g.id} game={g} system={systemById(systems, g.systemId)} group="home-favs" showSystem onActivate={openGame} onFocus={focusGame} />
          ))}
        </Row>
      )}
      <Row id="home-systems" title="Systems" variant="systems" aside={plural(shownSystems.length, 'system')}>
        {shownSystems.map((s) => (
          <SystemCard key={s.id} system={s} size="sm" group="home-systems" onActivate={openSystem} onFocus={focusSystem} />
        ))}
      </Row>
      {recentlyAdded.length > 0 && (
        <Row id="home-added" title="Recently added">
          {recentlyAdded.map((g) => (
            <GameCard key={g.id} game={g} system={systemById(systems, g.systemId)} group="home-added" showSystem onActivate={openGame} onFocus={focusGame} />
          ))}
        </Row>
      )}
      {dialog}
    </div>
  )
}

function Hero({ game: raw, system, isRecent, busy, onPlay, onDetails }: { game: Game; system?: SystemSummary; isRecent: boolean; busy: boolean; onPlay: () => void; onDetails: () => void }) {
  const game = usePatched(raw)
  const art = mediaUrl(game.media.snap ?? game.media.boxart, { w: COVER_THUMB.backdrop })
  const setAmbient = useUi((s) => s.setAmbient)
  const focusHero = () => setAmbient(systemColor(system ?? { id: game.systemId }))
  return (
    <section className="hero" style={systemStyle(system ?? { id: game.systemId })}>
      <div className="hero__backdrop" aria-hidden="true">
        {art ? <img src={art} alt="" /> : <Motif kind={motifFor(system?.manufacturer, game.systemId)} className="hero__motif" />}
      </div>
      <div className="hero__body">
        <span className="hero__kicker">{isRecent ? 'Continue playing' : 'From your library'}</span>
        <h1 className={`hero__title ${game.title.length > 28 ? 'is-long' : ''}`}>{game.title}</h1>
        <div className="hero__meta">
          <span className="chip chip--system">
            <i style={{ background: 'var(--c-base)' } as CSSProperties} />
            {system?.name ?? game.systemId}
          </span>
          <span>{formatPlayTime(game.playTimeSec)}</span>
          {game.lastPlayedAt && <span>Last played {formatRelative(game.lastPlayedAt).toLowerCase()}</span>}
        </div>
        <div className="hero__actions">
          <Button variant="primary" size="xl" icon={Play} onPress={onPlay} busy={busy} autoFocus onFocus={focusHero} label="Play">
            Play
          </Button>
          <Button variant="secondary" size="xl" icon={Info} onPress={onDetails} onFocus={focusHero}>
            Details
          </Button>
          <Button
            variant="secondary"
            size="xl"
            icon={Heart}
            className={game.favorite ? 'is-fav' : ''}
            onPress={() => void toggleFavorite(game)}
            onFocus={focusHero}
            label={game.favorite ? 'Unfavourite' : 'Favourite'}
            title={game.favorite ? 'Remove from favourites' : 'Add to favourites'}
          />
        </div>
      </div>
      <div className="hero__cover">
        <GameCover game={game} system={system} />
      </div>
    </section>
  )
}

function EmptyLibrary() {
  const push = useNav((s) => s.push)
  const update = useSettings((s) => s.update)
  const folders = useSettings((s) => s.settings?.romFolders.length ?? 0)
  return (
    <div className="screen screen--home">
      <section className="empty">
        <div className="empty__art" aria-hidden="true">
          <Motif kind="cross" className="empty__motif" />
        </div>
        <div className="empty__body">
          <h1 className="empty__title">Your shelf is empty</h1>
          <p className="empty__text">
            {folders
              ? 'RetroDesk is watching your ROM folders but found no games yet. Check that each system has its own sub-folder, then scan again.'
              : 'Point RetroDesk at the folder where you keep your games. Sub-folders named after systems, like snes, psx or Nintendo 64, are recognised automatically.'}
          </p>
          <div className="empty__actions">
            <Button variant="primary" size="lg" icon={FolderPlus} autoFocus onPress={async () => (await addRomFolder()) && (await rescan())}>
              Add ROM folder
            </Button>
            <Button variant="secondary" size="lg" icon={Upload} onPress={() => void importRomFiles()}>
              Import ROM files
            </Button>
            <Button variant="secondary" size="lg" icon={Wand2} onPress={() => void update({ onboarded: false })}>
              Run setup again
            </Button>
          </div>
          <p className="empty__hint">You can also drop ROM files anywhere on this window.</p>
          {folders > 0 && (
            <Button variant="quiet" onPress={() => push({ name: 'settings', tab: 'library' })}>
              Manage ROM folders
            </Button>
          )}
        </div>
      </section>
    </div>
  )
}
