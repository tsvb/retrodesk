import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Game } from '../../shared/types'
import { firstSorted, GameStore, sanitizeGame } from './store'
import { gameIdForPath } from './util'

const tmp = mkdtempSync(join(tmpdir(), 'rd-store-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

function game(title: string, extra: Partial<Game> = {}): Game {
  const path = `C:\\roms\\${extra.systemId ?? 'snes'}\\${title}.sfc`
  return {
    id: gameIdForPath(path),
    systemId: 'snes',
    path,
    fileName: `${title}.sfc`,
    title,
    rawName: title,
    regions: [],
    tags: [],
    sizeBytes: 1,
    addedAt: 1,
    playTimeSec: 0,
    playCount: 0,
    favorite: false,
    hidden: false,
    media: {},
    ...extra
  }
}

describe('gameIdForPath', () => {
  // Drive letters and backslashes only mean something on Windows.
  it.runIf(process.platform === 'win32')('is case/separator-insensitive and 16 hex chars', () => {
    const a = gameIdForPath('C:\\Roms\\SNES\\Game.sfc')
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(gameIdForPath('c:/roms/snes/game.sfc')).toBe(a)
    expect(gameIdForPath('C:\\Roms\\SNES\\Other.sfc')).not.toBe(a)
  })

  it.skipIf(process.platform === 'win32')('is case-insensitive, ignores a trailing slash and is 16 hex chars (macOS)', () => {
    const a = gameIdForPath('/Users/me/Roms/SNES/Game.sfc')
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(gameIdForPath('/users/me/roms/snes/game.sfc/')).toBe(a)
    expect(gameIdForPath('/Users/me/Roms/SNES/Other.sfc')).not.toBe(a)
  })
})

describe('GameStore', () => {
  it('queries with filters, diacritic-insensitive search, sorting and limit', () => {
    const s = new GameStore(join(tmp, 'q.json'))
    s.put(game('Pokémon Stadium', { systemId: 'n64', favorite: true, playTimeSec: 50, lastPlayedAt: 300, addedAt: 3 }))
    s.put(game('The Legend of Zelda: A Link to the Past', { rawName: 'Legend of Zelda, The - A Link to the Past (USA)', playTimeSec: 100, lastPlayedAt: 200, addedAt: 2 }))
    s.put(game('Super Mario World', { hidden: true, addedAt: 5 }))
    s.put(game('Game 10', { addedAt: 4 }))
    s.put(game('Game 9', { addedAt: 1 }))
    const titles = (q: Parameters<GameStore['query']>[0]) => s.query(q).map((g) => g.title)
    expect(titles({})).toEqual(['Game 9', 'Game 10', 'Pokémon Stadium', 'The Legend of Zelda: A Link to the Past'])
    expect(titles({ includeHidden: true })).toContain('Super Mario World')
    expect(titles({ search: 'pokemon' })).toEqual(['Pokémon Stadium'])
    expect(titles({ search: 'ZELDA link' })).toEqual(['The Legend of Zelda: A Link to the Past'])
    expect(titles({ search: 'legend usa' })).toHaveLength(1) // rawName is searched too
    expect(titles({ favoritesOnly: true })).toEqual(['Pokémon Stadium'])
    expect(titles({ systemId: 'n64' })).toEqual(['Pokémon Stadium'])
    expect(titles({ sort: 'playTime', limit: 1 })).toEqual(['The Legend of Zelda: A Link to the Past'])
    expect(titles({ sort: 'lastPlayed' })[0]).toBe('Pokémon Stadium')
    expect(titles({ sort: 'added' })[0]).toBe('Game 10')
    expect(titles({ sort: 'system' })[3]).toBe('Pokémon Stadium') // catalog order: nes, snes, n64
    expect(s.recent(10).map((g) => g.title)).toEqual(['Pokémon Stadium', 'The Legend of Zelda: A Link to the Past'])
  })

  it('persists atomically with a version and reloads', async () => {
    const file = join(tmp, 'lib.json')
    const s = new GameStore(file, 10)
    s.put(game('A', { favorite: true, media: { boxart: 'C:\\x.png' }, emulatorOverride: 'retroarch:snes9x_libretro' }))
    await s.flush()
    const data = JSON.parse(readFileSync(file, 'utf8')) as { version: number; games: Game[] }
    expect(data.version).toBe(1)
    expect(data.games).toHaveLength(1)
    const s2 = new GameStore(file)
    s2.load()
    expect(s2.all()[0]).toMatchObject({ title: 'A', favorite: true, media: { boxart: 'C:\\x.png' }, emulatorOverride: 'retroarch:snes9x_libretro' })
    s2.update(s2.all()[0]!.id, (g) => (g.playCount = 3))
    s2.flushSync()
    const s3 = new GameStore(file)
    s3.load()
    expect(s3.all()[0]?.playCount).toBe(3)
    expect(existsSync(`${file}.tmp`)).toBe(false)
    const s4 = new GameStore(file)
    await s4.loadAsync()
    expect(s4.all()[0]?.playCount).toBe(3)
    const empty = new GameStore(join(tmp, 'missing.json'))
    await empty.loadAsync()
    expect(empty.size).toBe(0)
  })

  it('debounces saves', async () => {
    const file = join(tmp, 'debounce.json')
    const s = new GameStore(file, 30)
    s.put(game('X'))
    expect(existsSync(file)).toBe(false)
    await new Promise((r) => setTimeout(r, 120))
    expect(existsSync(file)).toBe(true)
  })

  it('saves at least every maxWait while changes keep coming', async () => {
    const file = join(tmp, 'maxwait.json')
    const s = new GameStore(file, 50, 120)
    const g = game('Busy')
    s.put(g)
    // A change every 20 ms never leaves the 50 ms quiet gap the debounce waits for.
    let savedWhileBusy = false
    for (let i = 0; i < 20 && !savedWhileBusy; i++) {
      await new Promise((r) => setTimeout(r, 20))
      s.update(g.id, (x) => (x.playCount = i))
      savedWhileBusy = existsSync(file)
    }
    expect(savedWhileBusy).toBe(true)
    await s.flush()
  })

  it('picks the first of a sort order without sorting everything, like sort + slice', () => {
    const rnd = (() => {
      let x = 7
      return () => (x = (x * 1103515245 + 12345) >>> 0) % 50
    })()
    const items = Array.from({ length: 500 }, (_, i) => ({ i, v: rnd() }))
    const cmp = (a: { v: number }, b: { v: number }): number => a.v - b.v
    for (const k of [0, 1, 16, 30, 499, 500, 900]) {
      expect(firstSorted(items, k, cmp)).toEqual(items.slice().sort(cmp).slice(0, k))
    }
  })

  it('moves a corrupt file aside and repairs bad entries', () => {
    const file = join(tmp, 'corrupt.json')
    writeFileSync(file, '{"version":1,"games":[')
    const s = new GameStore(file)
    s.load()
    expect(s.size).toBe(0)
    expect(existsSync(file)).toBe(false)
    expect(sanitizeGame({ id: 'x' })).toBeUndefined()
    expect(sanitizeGame({ id: 'x', systemId: 'snes', path: 'C:\\a.sfc', favorite: 'yes', media: { boxart: 5 } })).toMatchObject({ favorite: false, media: {}, title: 'C:\\a.sfc' })
  })
})
