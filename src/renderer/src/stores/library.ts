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
  /** Latest copy of games changed from this window (favourite, override), keyed by id. */
  patches: Record<string, Game>
  refresh(): Promise<void>
  refreshEmulators(): Promise<void>
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
        const [systems, recent, favorites, recentlyAdded, emulators] = await Promise.all([
          api.library.getSystems(),
          api.library.getRecent(16),
          api.library.getGames({ favoritesOnly: true, sort: 'lastPlayed', limit: 30 }),
          api.library.getGames({ sort: 'added', limit: 16 }),
          api.emulators.list()
        ])
        set((s) => ({ loaded: true, systems, recent, favorites, recentlyAdded, emulators, version: s.version + 1, patches: {} }))
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
