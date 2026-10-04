import { rmSync } from 'fs'
import { join } from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryChange } from '../../shared/api'
import type { Game, Settings } from '../../shared/types'
import { rom, writeFile } from './testutil'

/** Library orchestration with artwork downloads and Steam stubbed out: change events, rescans, imports. */

const env = vi.hoisted(() => {
  const os = require('os') as typeof import('os')
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-lib-'))
  return {
    root,
    settings: {
      dataRoot: path.join(root, 'RetroDesk'),
      romFolders: [] as { path: string; systemId?: string }[],
      scraping: { autoFetchArtwork: false, preferredRegion: 'USA' }
    },
    reloads: 0,
    deltas: [] as LibraryChange[],
    artwork: (_games: Game[], _onUpdate: (id: string, media: Game['media']) => void): Promise<void> => Promise.resolve()
  }
})

vi.mock('electron', () => ({ app: { getPath: () => join(env.root, 'userData'), on: () => undefined } }))
vi.mock('../settings', () => ({ getSettings: () => env.settings as unknown as Settings, onSettingsChanged: () => () => undefined }))
vi.mock('../emulators', () => ({ isSystemPlayable: () => false }))
vi.mock('../events', () => ({
  emitLibraryChanged: () => {
    env.reloads++
  },
  broadcast: (name: string, payload: LibraryChange) => {
    if (name === 'libraryChanged') env.deltas.push(payload)
  },
  createTask: () => ({ id: '1', update: () => undefined, done: () => undefined, fail: () => undefined })
}))
vi.mock('./steam', async (orig) => ({
  ...(await orig<typeof import('./steam')>()),
  findSteamPath: async () => undefined,
  listSteamGames: async () => ({ apps: [], complete: false })
}))
vi.mock('./artwork', () => ({
  loadArcadeNames: async () => undefined,
  fetchArtworkForGames: async (games: Game[], o: { onUpdate: (id: string, media: Game['media']) => void }) => {
    await env.artwork(games, o.onUpdate)
    return { downloaded: 0, notFound: 0, failed: 0, errors: [] }
  }
}))

type Lib = typeof import('./index')
let lib: Lib
const roms = join(env.root, 'Roms')

beforeAll(async () => {
  writeFile(join(roms, 'SNES', 'Super Mario World (USA).sfc'), rom(4096))
  writeFile(join(roms, 'SNES', 'F-Zero (USA).sfc'), rom(4096, 2))
  env.settings.romFolders.push({ path: roms })
  lib = await import('./index')
  await lib.initLibrary()
  await lib.libraryHandlers.scan()
})

afterAll(() => rmSync(env.root, { recursive: true, force: true }))

beforeEach(() => {
  env.reloads = 0
  env.deltas = []
})

describe('library change events', () => {
  it('sends artwork updates as one batched delta, not a reload per game', async () => {
    const games = await lib.libraryHandlers.getGames({ systemId: 'snes' })
    let release = (): void => undefined
    env.artwork = (list, onUpdate) => {
      for (const g of list) onUpdate(g.id, { boxart: join(env.settings.dataRoot, 'media', `${g.rawName}.png`) })
      return new Promise<void>((r) => (release = r))
    }
    const run = lib.fetchArtwork(games.map((g) => g.id))
    await vi.waitFor(() => expect(env.deltas).toHaveLength(1), { timeout: 3000, interval: 50 })
    expect(env.reloads).toBe(0)
    expect(env.deltas[0]!.media.map((g) => g.id).sort()).toEqual(games.map((g) => g.id).sort())
    expect(env.deltas[0]!.media.every((g) => g.media.boxart?.endsWith('.png'))).toBe(true)
    release()
    await run
    expect(env.reloads).toBe(1) // the end of the run
  })
})
