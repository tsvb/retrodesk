import { create } from 'zustand'
import type { EmulatorStatus, Game, SystemSummary } from '@shared/types'
import { api } from '../api'

interface LibraryState {
  loaded: boolean
  systems: SystemSummary[]
  recent: Game[]
  favorites: Game[]
  recentlyAdded: Game[]
  emulators: EmulatorStatus[]
  /** Bumped whenever the backend says the library changed; screens holding their own lists refetch. */
  version: number
  /** Latest copy of games changed since the last refresh (favorite, override from this window; artwork), keyed by id. */
  patches: Record<string, Game>
  refresh(): Promise<void>
  refreshEmulators(): Promise<void>
  /** Games whose artwork changed: patch them in place, without a refresh. */
  applyMedia(games: Game[]): void
  setFavorite(game: Game, favorite: boolean): Promise<Game>
  setOverride(game: Game, emulator: string | null): Promise<Game>
  setHidden(game: Game, hidden: boolean): Promise<Game>
}

let refreshing: Promise<void> | null = null

export const useLibrary = create<LibraryState>((set, get) => ({
  loaded: false,
  systems: [],
  recent: [],
  favorites: [],
  recentlyAdded: [],
  emulators: [],
  version: 0,
  patches: {},
  async refresh() {
    if (refreshing) return refreshing
    refreshing = (async () => {
      try {
        const before = get().patches
        const [systems, recent, favorites, recentlyAdded, emulators] = await Promise.all([
          api.library.getSystems(),
          api.library.getRecent(16),
          api.library.getGames({ favoritesOnly: true, sort: 'lastPlayed', limit: 30 }),
          api.library.getGames({ sort: 'added', limit: 16 }),
          api.emulators.list()
        ])
        // Patches that arrived while loading may be newer than what was loaded: keep those.
        const patches = Object.fromEntries(Object.entries(get().patches).filter(([id, g]) => before[id] !== g))
        set((s) => ({ loaded: true, systems, recent, favorites, recentlyAdded, emulators, version: s.version + 1, patches }))
      } finally {
        refreshing = null
      }
    })()
    return refreshing
  },
  async refreshEmulators() {
    const [emulators, systems] = await Promise.all([api.emulators.list(), api.library.getSystems()])
    set({ emulators, systems })
  },
  applyMedia(games) {
    if (!games.length) return
    const byId = new Map(games.map((g) => [g.id, g]))
    const swap = (list: Game[]): Game[] => (list.some((g) => byId.has(g.id)) ? list.map((g) => byId.get(g.id) ?? g) : list)
    set((s) => ({
      patches: { ...s.patches, ...Object.fromEntries(byId) },
      recent: swap(s.recent),
      favorites: swap(s.favorites),
      recentlyAdded: swap(s.recentlyAdded)
    }))
  },
  async setFavorite(game, favorite) {
    const updated = await api.library.setFavorite(game.id, favorite)
    const favorites = await api.library.getGames({ favoritesOnly: true, sort: 'lastPlayed', limit: 30 })
    set((s) => ({
      patches: { ...s.patches, [updated.id]: updated },
      favorites,
      recent: s.recent.map((g) => (g.id === updated.id ? updated : g)),
      recentlyAdded: s.recentlyAdded.map((g) => (g.id === updated.id ? updated : g))
    }))
    return updated
  },
  async setOverride(game, emulator) {
    const updated = await api.library.setEmulatorOverride(game.id, emulator)
    set((s) => ({ patches: { ...s.patches, [updated.id]: updated } }))
    return updated
  },
  async setHidden(game, hidden) {
    const updated = await api.library.setHidden(game.id, hidden)
    set((s) => ({ patches: { ...s.patches, [updated.id]: updated } }))
    void get().refresh()
    return updated
  }
}))

/**
 * Keep the store in step with the backend's libraryChanged events: artwork-only changes are patched in at once,
 * anything else refreshes (debounced, bursts arrive during scans). Returns the unsubscribe function.
 */
export function followLibraryChanges(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const off = api.on.libraryChanged((change) => {
    if (change && change.media) {
      useLibrary.getState().applyMedia(change.media)
      return
    }
    clearTimeout(timer)
    timer = setTimeout(() => void useLibrary.getState().refresh(), 250)
  })
  return () => {
    off()
    clearTimeout(timer)
  }
}

/** Apply locally-known patches to a game from a cached list. */
export function usePatched(game: Game): Game
export function usePatched(game: Game | null | undefined): Game | null | undefined
export function usePatched(game: Game | null | undefined): Game | null | undefined {
  const patch = useLibrary((s) => (game ? s.patches[game.id] : undefined))
  return patch ?? game
}

export function systemById(systems: SystemSummary[], id: string | undefined): SystemSummary | undefined {
  return id ? systems.find((s) => s.id === id) : undefined
}
