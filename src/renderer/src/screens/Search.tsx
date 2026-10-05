import { useCallback, useEffect, useState } from 'react'
import { Search as SearchIcon } from 'lucide-react'
import type { Game } from '@shared/types'
import { api } from '../api'
import { GameCard } from '../components/GameCard'
import { OnScreenKeyboard, type OskKey } from '../components/OnScreenKeyboard'
import { useActions, useFocusGroup, useTextCapture } from '../input/hooks'
import { systemColor } from '../lib/color'
import { plural } from '../lib/format'
import { systemById, useLibrary } from '../stores/library'
import { useNav } from '../stores/nav'
import { useUi } from '../stores/ui'

const LIMIT = 60

export function SearchScreen() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Game[] | null>(null)
  const systems = useLibrary((s) => s.systems)
  const version = useLibrary((s) => s.version)
  const push = useNav((s) => s.push)
  const setAmbient = useUi((s) => s.setAmbient)
  const total = systems.reduce((n, s) => n + s.gameCount, 0)
  useFocusGroup('search-results', { memory: true })
  // Stable handlers keep the memoized result cards from re-rendering on every keystroke.
  const openGame = useCallback((g: Game) => push({ name: 'game', gameId: g.id }), [push])
  const focusGame = useCallback((g: Game) => setAmbient(systemColor(systemById(systems, g.systemId) ?? { id: g.systemId })), [systems, setAmbient])

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults(null)
      return
    }
    let alive = true
    const t = setTimeout(() => {
      api.library
        .getGames({ search: q, sort: 'title', limit: LIMIT })
        .then((r) => alive && setResults(r))
        .catch(() => alive && setResults([]))
    }, 120)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [query, version])

  const backspace = () => setQuery((q) => q.slice(0, -1))
  const onKey = (k: OskKey) => {
    if (k.type === 'char') setQuery((q) => q + k.value)
    else if (k.type === 'space') setQuery((q) => (q && !q.endsWith(' ') ? `${q} ` : q))
    else if (k.type === 'backspace') backspace()
    else if (k.type === 'clear') setQuery('')
  }

  useTextCapture((key) => {
    if (key === 'Backspace') {
      if (!query) return false
      backspace()
      return true
    }
    if (key.length === 1) {
      setQuery((q) => q + key)
      return true
    }
    return false
  })
  useActions({
    favorite: { label: 'Delete', run: backspace },
    search: { label: 'Space', run: () => onKey({ type: 'space' }) }
  })

  return (
    <div className="screen screen--search">
      <div className="search">
        <div className="search__input">
          <div className="search__field" aria-live="polite">
            <SearchIcon size="1.1em" className="search__icon" />
            <span className={`search__query ${query ? '' : 'is-empty'}`}>{query || 'Search your library'}</span>
            <span className="search__caret" />
          </div>
          <OnScreenKeyboard onKey={onKey} group="search-osk" />
          <p className="search__tip">Typing on a keyboard works too.</p>
        </div>
        <div className="search__results">
          {results === null ? (
            <div className="search__placeholder">
              <h2>Find anything</h2>
              <p>Search titles across all {plural(total, 'game')} in your library.</p>
            </div>
          ) : results.length === 0 ? (
            <div className="search__placeholder">
              <h2>No matches</h2>
              <p>Nothing in your library contains “{query.trim()}”. Try fewer letters.</p>
            </div>
          ) : (
            <>
              <p className="search__count">{results.length >= LIMIT ? `First ${LIMIT} matches` : plural(results.length, 'match', 'matches')}</p>
              <div className="search__grid">
                {results.map((g) => (
                  <GameCard key={g.id} game={g} system={systemById(systems, g.systemId)} group="search-results" showSystem onActivate={openGame} onFocus={focusGame} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
