import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownUp, Download, Heart, LayoutGrid, List } from 'lucide-react'
import type { Game, SortKey, SystemSummary } from '@shared/types'
import { api } from '../api'
import { Button } from '../components/Button'
import { toggleFavorite } from '../components/GameCard'
import { COVER_THUMB, GameCover } from '../components/GameCover'
import { systemStyle } from '../components/SystemCard'
import { VirtualGrid, type VirtualGridApi } from '../components/VirtualGrid'
import { useActions, useFocusGroup } from '../input/hooks'
import { systemColor } from '../lib/color'
import { formatPlayTime, formatRelative, letterOf, plural } from '../lib/format'
import { feedback } from '../lib/feedback'
import { systemById, useLibrary } from '../stores/library'
import { useNav } from '../stores/nav'
import { toast } from '../stores/session'
import { useSettings } from '../stores/settings'
import { useUi } from '../stores/ui'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'lastPlayed', label: 'Last played' },
  { key: 'playTime', label: 'Play time' },
  { key: 'added', label: 'Recently added' }
]

export function GameListScreen({ systemId }: { systemId: string }) {
  const system = useLibrary((s) => systemById(s.systems, systemId))
  const version = useLibrary((s) => s.version)
  const patches = useLibrary((s) => s.patches)
  const density = useSettings((s) => s.settings?.ui.density ?? 'comfortable')
  const push = useNav((s) => s.push)
  const setAmbient = useUi((s) => s.setAmbient)

  const [sort, setSort] = useState<SortKey>('title')
  const [favOnly, setFavOnly] = useState(false)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [raw, setRaw] = useState<Game[] | null>(null)
  const [index, setIndex] = useState(0)
  const [letterFlash, setLetterFlash] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const gridApi = useRef<VirtualGridApi | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useFocusGroup('gl-controls', { memory: true })

  useEffect(() => {
    if (system) setAmbient(systemColor(system))
  }, [system, setAmbient])

  useEffect(() => {
    let alive = true
    api.library
      .getGames({ systemId, sort, favoritesOnly: favOnly })
      .then((g) => alive && setRaw(g))
      .catch((e: unknown) => toast(`Couldn't load games: ${e instanceof Error ? e.message : String(e)}`, 'error'))
    return () => {
      alive = false
    }
  }, [systemId, sort, favOnly, version])

  const games = useMemo(() => {
    if (!raw) return []
    const list = raw.map((g) => patches[g.id] ?? g)
    return favOnly ? list.filter((g) => g.favorite) : list
  }, [raw, patches, favOnly])

  // Alphabet index for LT/RT when sorted by title.
  const letters = useMemo(() => {
    if (sort !== 'title') return []
    const out: { letter: string; start: number }[] = []
    games.forEach((g, i) => {
      const l = letterOf(g.title)
      if (out[out.length - 1]?.letter !== l) out.push({ letter: l, start: i })
    })
    return out
  }, [games, sort])

  const flash = (l: string) => {
    setLetterFlash(l)
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setLetterFlash(null), 750)
  }
  const jumpLetter = (dir: 1 | -1) => {
    if (!letters.length) return
    const curIdx = letters.findLastIndex((x) => x.start <= index)
    const target = letters[Math.min(letters.length - 1, Math.max(0, curIdx + dir))]
    if (!target) return
    gridApi.current?.jumpTo(target.start)
    flash(target.letter)
  }

  const cycleSort = () => {
    const i = SORTS.findIndex((s) => s.key === sort)
    const next = SORTS[(i + 1) % SORTS.length]
    if (next) {
      setSort(next.key)
      setIndex(0)
    }
  }
  const toggleView = () => setView((v) => (v === 'grid' ? 'list' : 'grid'))

  useActions({
    view: { label: view === 'grid' ? 'List view' : 'Grid view', run: toggleView },
    menu: { label: 'Sort', run: cycleSort }
  })

  const install = async () => {
    if (!system) return
    setInstalling(true)
    try {
      await api.emulators.installForSystem(system.id)
      await useLibrary.getState().refreshEmulators()
      toast(`${system.name} is ready to play`, 'success')
    } catch (e) {
      feedback('error')
      toast(`Install failed: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setInstalling(false)
    }
  }

  const onReady = useCallback((a: VirtualGridApi) => {
    gridApi.current = a
  }, [])

  // Stable grid callbacks: moving focus re-renders this screen, and the memoised cells should not follow.
  const getKey = useCallback((g: Game) => g.id, [])
  const onActivate = useCallback((g: Game) => push({ name: 'game', gameId: g.id }), [push])
  const itemActions = useCallback((g: Game) => ({ favorite: { label: g.favorite ? 'Unfavourite' : 'Favourite', run: () => void toggleFavorite(g) } }), [])
  const renderCell = useCallback(
    (g: Game, focused: boolean) => {
      if (!system) return null
      return view === 'grid' ? <GridCell game={g} system={system} focused={focused} /> : <ListCell game={g} system={system} focused={focused} />
    },
    [view, system]
  )

  if (!system) return <div className="screen screen--games"><p className="muted">This system isn't in your library.</p></div>

  const sortLabel = SORTS.find((s) => s.key === sort)?.label ?? 'Title'
  const focusedGame = games[Math.min(index, games.length - 1)]

  return (
    <div className="screen screen--games" style={systemStyle(system)}>
      <header className="gl-head">
        <div className="gl-head__id">
          <span className="gl-head__short">{system.shortName ?? system.name}</span>
          <div className="gl-head__text">
            <h1 className="gl-head__title">{system.name}</h1>
            <p className="gl-head__sub">
              {system.manufacturer}, {system.year}. {raw ? plural(games.length, favOnly ? 'favourite' : 'game') : 'Loading'}
            </p>
          </div>
        </div>
        <div className="gl-head__controls">
          {!system.playable && (
            <Button variant="primary" icon={Download} group="gl-controls" onPress={install} busy={installing}>
              Install emulator
            </Button>
          )}
          <Button icon={ArrowDownUp} group="gl-controls" onPress={cycleSort} label="Change sort">
            {sortLabel}
          </Button>
          <Button icon={Heart} group="gl-controls" className={favOnly ? 'is-active' : ''} onPress={() => { setFavOnly((f) => !f); setIndex(0) }} label={favOnly ? 'Show all' : 'Favourites only'}>
            Favourites
          </Button>
          <Button icon={view === 'grid' ? List : LayoutGrid} group="gl-controls" onPress={toggleView} label={view === 'grid' ? 'List view' : 'Grid view'} title={view === 'grid' ? 'List view' : 'Grid view'} />
        </div>
      </header>

      {raw && games.length === 0 ? (
        <EmptySystem system={system} favOnly={favOnly} />
      ) : (
        <VirtualGrid
          key={view}
          items={games}
          getKey={getKey}
          layout={view}
          minCellRem={density === 'compact' ? 8.2 : 10.5}
          cellAspect={4 / 3}
          captionRem={density === 'compact' ? 2.2 : 2.6}
          gapRem={density === 'compact' ? 1.1 : 1.5}
          index={index}
          onIndexChange={setIndex}
          onActivate={onActivate}
          autoFocus
          onReady={onReady}
          itemActions={itemActions}
          pageActions={
            sort === 'title' && letters.length > 1
              ? { pageUp: { label: 'Jump letter', run: () => jumpLetter(-1) }, pageDown: { label: 'Jump letter', run: () => jumpLetter(1) } }
              : undefined
          }
          renderCell={renderCell}
        />
      )}
      {sort === 'title' && letters.length > 1 && (
        <div className="letter-rail" aria-hidden="true">
          {letters.map((l) => (
            <span key={l.letter} className={focusedGame && letterOf(focusedGame.title) === l.letter ? 'is-current' : ''}>
              {l.letter}
            </span>
          ))}
        </div>
      )}
      {letterFlash && (
        <div className="letter-flash" key={letterFlash}>
          {letterFlash}
        </div>
      )}
    </div>
  )
}

const GridCell = memo(function GridCell({ game, system, focused }: { game: Game; system: SystemSummary; focused: boolean }) {
  return (
    <div className={`game-card game-card--grid ${focused ? 'is-focused' : ''}`}>
      <div className="game-card__frame">
        <GameCover game={game} system={system} thumb={COVER_THUMB.tile} />
        {game.favorite && (
          <span className="game-card__fav">
            <Heart size="1em" fill="currentColor" strokeWidth={0} />
          </span>
        )}
      </div>
      <div className="game-card__caption">
        <span className="game-card__title">{game.title}</span>
      </div>
    </div>
  )
})

const ListCell = memo(function ListCell({ game, system, focused }: { game: Game; system: SystemSummary; focused: boolean }) {
  return (
    <div className={`list-item ${focused ? 'is-focused' : ''}`}>
      <div className="list-item__thumb">
        <GameCover game={game} system={system} thumb={COVER_THUMB.list} />
      </div>
      <div className="list-item__main">
        <span className="list-item__title">
          {game.title}
          {game.favorite && <Heart className="list-item__fav" size="0.8em" fill="currentColor" strokeWidth={0} />}
        </span>
        <span className="list-item__tags">
          {[...game.regions, ...game.tags].map((t) => (
            <span key={t} className="tag">
              {t}
            </span>
          ))}
        </span>
      </div>
      <span className="list-item__stat">{game.playTimeSec > 0 ? formatPlayTime(game.playTimeSec) : ''}</span>
      <span className="list-item__stat list-item__stat--dim">{game.lastPlayedAt ? formatRelative(game.lastPlayedAt) : 'Never played'}</span>
    </div>
  )
})

function EmptySystem({ system, favOnly }: { system: SystemSummary; favOnly: boolean }) {
  const dataRoot = useSettings((s) => s.settings?.dataRoot ?? '')
  const folder = system.folderAliases?.[0] ?? system.id
  return (
    <div className="gl-empty">
      {favOnly ? (
        <>
          <h2>No favourites here yet</h2>
          <p>Press the favourite button on any {system.shortName ?? system.name} game to pin it here.</p>
        </>
      ) : (
        <>
          <h2>No {system.name} games yet</h2>
          <p>
            Put {system.extensions.join(', ')} files in <code>{dataRoot ? `${dataRoot}\\roms\\${folder}` : `roms\\${folder}`}</code> or any ROM folder sub-folder named <code>{folder}</code>, then rescan from Settings.
          </p>
        </>
      )}
    </div>
  )
}
