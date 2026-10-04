import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Settings } from '../../shared/types'
import { rom, writeFile } from './testutil'

/**
 * End-to-end: library handlers with a mocked Electron/settings environment, real file system,
 * real thumbnails.libretro.com downloads and real Steam detection (if Steam is installed).
 * Set RD_OFFLINE=1 to skip the network parts.
 */

const env = vi.hoisted(() => {
  const os = require('os') as typeof import('os')
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-e2e-'))
  return {
    root,
    userData: path.join(root, 'userData'),
    settings: {
      dataRoot: path.join(root, 'RetroDesk'),
      romFolders: [] as { path: string; systemId?: string }[],
      scraping: { autoFetchArtwork: false, preferredRegion: 'USA' }
    },
    tasks: [] as { label: string; state: string; detail?: string; kind?: string }[],
    changed: 0,
    quitHandlers: [] as (() => void)[]
  }
})

vi.mock('electron', () => ({
  app: {
    getPath: () => env.userData,
    on: (ev: string, fn: () => void) => {
      if (ev === 'before-quit') env.quitHandlers.push(fn)
    }
  },
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('../settings', () => ({ getSettings: () => env.settings as unknown as Settings, onSettingsChanged: () => () => undefined }))
vi.mock('../emulators', () => ({ isSystemPlayable: (id: string) => id === 'snes' }))
vi.mock('../events', () => ({
  emitLibraryChanged: () => {
    env.changed++
  },
  createTask: (label: string, subject?: { kind: string }) => {
    const t: { label: string; state: string; detail?: string; kind?: string } = { label, state: 'running', kind: subject?.kind }
    env.tasks.push(t)
    return {
      id: String(env.tasks.length),
      update: (_p: number, d?: string) => {
        if (d) t.detail = d
      },
      done: (d?: string) => {
        t.state = 'done'
        t.detail = d
      },
      fail: (e: unknown) => {
        t.state = 'error'
        t.detail = String(e)
      }
    }
  }
}))

const offline = !!process.env.RD_OFFLINE
type Lib = typeof import('./index')
let lib: Lib
const romsA = join(env.root, 'MyRoms')

beforeAll(async () => {
  writeFile(join(romsA, 'SNES', 'Super Mario World (USA).sfc'), rom(4096))
  writeFile(join(romsA, 'SNES', 'Legend of Zelda, The - A Link to the Past (USA) [!].sfc'), rom(4096, 2))
  writeFile(join(romsA, 'SNES', 'Gone (USA).sfc'), rom(4096, 3))
  writeFile(join(env.settings.dataRoot, 'roms', 'gba', 'Golden Sun (USA, Europe).gba'), rom(4096, 4))
  lib = await import('./index')
  await lib.initLibrary()
  env.settings.romFolders.push({ path: romsA })
})

afterAll(() => {
  rmSync(env.root, { recursive: true, force: true })
})

const games = (q = {}) => lib.libraryHandlers.getGames(q)

describe('library e2e', () => {
  it('scans ROM folders, the default roms dir and Steam', async () => {
    const r = await lib.libraryHandlers.scan()
    const all = await games()
    const files = all.filter((g) => g.systemId !== 'steam').map((g) => g.title).sort()
    expect(files).toEqual(['Golden Sun', 'Gone', 'Super Mario World', 'The Legend of Zelda: A Link to the Past'])
    expect(r.added).toBe(all.length)
    expect(r.total).toBe(all.length)
    expect(env.tasks.find((t) => t.label === 'Scanning library')).toMatchObject({ state: 'done', kind: 'scan' })
    const steam = all.filter((g) => g.systemId === 'steam')
    const { findSteamPath } = await import('./steam')
    const sp = await findSteamPath()
    console.log(`Steam: ${sp ?? 'not installed'}; games: ${steam.map((g) => g.title).join(', ') || '-'}`)
    if (sp) {
      expect(steam.every((g) => g.path.startsWith('steam://rungameid/'))).toBe(true)
      expect(steam.some((g) => /redistributable/i.test(g.title))).toBe(false)
    }
    const systems = await lib.libraryHandlers.getSystems()
    expect(systems.find((s) => s.id === 'snes')).toMatchObject({ gameCount: 3, playable: true })
    expect(systems.find((s) => s.id === 'gba')).toMatchObject({ gameCount: 1, playable: false })
    expect(systems.find((s) => s.id === 'steam')?.playable).toBe(!!sp)
  })

  it('updates per-game state and records play sessions', async () => {
    const smw = (await games({ search: 'mario' }))[0]!
    expect((await lib.libraryHandlers.setFavorite(smw.id, true)).favorite).toBe(true)
    expect((await lib.libraryHandlers.setEmulatorOverride(smw.id, 'retroarch:bsnes_libretro')).emulatorOverride).toBe('retroarch:bsnes_libretro')
    lib.recordPlaySession(smw.id, 1000, 90)
    lib.recordPlaySession(smw.id, 2000, 30)
    expect(lib.getGameById(smw.id)).toMatchObject({ playCount: 2, playTimeSec: 120, lastPlayedAt: 2000 })
    expect((await lib.libraryHandlers.getRecent(5)).map((g) => g.id)).toEqual([smw.id])
    const gone = (await games({ search: 'gone' }))[0]!
    await lib.libraryHandlers.setHidden(gone.id, true)
    expect((await games({ systemId: 'snes' })).length).toBe(2)
    expect((await games({ systemId: 'snes', includeHidden: true })).length).toBe(3)
    await expect(lib.libraryHandlers.setFavorite('nope', true)).rejects.toThrow(/not found/)
  })

  it.skipIf(offline)(
    'downloads real artwork from thumbnails.libretro.com',
    async () => {
      const snes = await games({ systemId: 'snes' })
      await lib.libraryHandlers.fetchArtwork(snes.map((g) => g.id))
      const smw = (await games({ search: 'mario' }))[0]!
      const zelda = (await games({ search: 'zelda' }))[0]!
      for (const g of [smw, zelda]) {
        for (const kind of ['boxart', 'snap', 'title'] as const) {
          const p = g.media[kind]
          expect(p, `${g.title} ${kind}`).toBeTruthy()
          const buf = readFileSync(p!)
          expect(buf.subarray(1, 4).toString()).toBe('PNG')
          expect(buf.length).toBeGreaterThan(1000)
        }
      }
      expect(smw.media.boxart).toBe(join(env.settings.dataRoot, 'media', 'snes', 'boxart', 'Super Mario World (USA).png'))
      expect(existsSync(join(env.settings.dataRoot, 'media', '_index', 'Nintendo - Super Nintendo Entertainment System.json'))).toBe(true)
      const t = env.tasks.filter((x) => x.label === 'Downloading artwork').pop()
      console.log('artwork task:', t?.detail)
      expect(t).toMatchObject({ state: 'done', kind: 'artwork' })
    },
    120_000
  )

  it.skipIf(offline)(
    'fetches Steam artwork (local cache or CDN) when Steam is installed',
    async () => {
      const steam = await games({ systemId: 'steam' })
      if (!steam.length) return
      await lib.libraryHandlers.fetchArtwork(steam.map((g) => g.id))
      for (const g of await games({ systemId: 'steam' })) {
        expect(g.media.boxart, g.title).toBeTruthy()
        expect(readFileSync(g.media.boxart!).subarray(0, 2).toString('hex')).toBe('ffd8') // JPEG
      }
    },
    60_000
  )

  it('rescans keep state, drop vanished files, and persist', async () => {
    unlinkSync(join(romsA, 'SNES', 'Gone (USA).sfc'))
    const before = (await games({ search: 'mario' }))[0]!
    const r = await lib.libraryHandlers.scan()
    expect(r).toMatchObject({ added: 0, removed: 1 })
    const after = (await games({ search: 'mario' }))[0]!
    expect(after).toMatchObject({ id: before.id, favorite: true, playTimeSec: 120, emulatorOverride: 'retroarch:bsnes_libretro', media: before.media })
    // Quit flush writes the versioned library file.
    for (const fn of env.quitHandlers) fn()
    const file = JSON.parse(readFileSync(join(env.userData, 'library.json'), 'utf8')) as { version: number; games: { id: string }[] }
    expect(file.version).toBe(1)
    expect(file.games.map((g) => g.id)).toContain(before.id)
  })

  it('keeps games when their ROM folder is offline', async () => {
    env.settings.romFolders.push({ path: join(env.root, 'UnpluggedDrive') })
    const n = (await games()).length
    const r = await lib.libraryHandlers.scan()
    expect(r.removed).toBe(0)
    expect((await games()).length).toBe(n)
    env.settings.romFolders.pop()
  })

  it('imports ROMs (with cue companions) into roms/<system>/ and rescans', async () => {
    const src = join(env.root, 'Downloads')
    writeFile(join(src, 'Advance Wars (USA).gba'), rom(4096, 9))
    writeFile(join(src, 'PSX', 'Crash Bandicoot (USA).cue'), 'FILE "Crash Bandicoot (USA).bin" BINARY\n')
    writeFile(join(src, 'PSX', 'Crash Bandicoot (USA).bin'), rom(8192, 10))
    writeFile(join(src, 'notes.txt'), 'hi')
    const r = await lib.libraryHandlers.importFiles([join(src, 'Advance Wars (USA).gba'), join(src, 'PSX', 'Crash Bandicoot (USA).cue'), join(src, 'PSX', 'Crash Bandicoot (USA).bin'), join(src, 'notes.txt')])
    expect(r.added).toBe(2)
    const roms = join(env.settings.dataRoot, 'roms')
    expect(existsSync(join(roms, 'gba', 'Advance Wars (USA).gba'))).toBe(true)
    expect(existsSync(join(roms, 'psx', 'Crash Bandicoot (USA).bin'))).toBe(true)
    const crash = (await games({ search: 'crash' }))[0]!
    expect(crash).toMatchObject({ systemId: 'psx', fileName: 'Crash Bandicoot (USA).cue' })
    expect(env.tasks.some((t) => t.kind === 'import' && t.state === 'done')).toBe(true)
  })

  it('checks and imports BIOS files', async () => {
    const before = await lib.biosHandlers.check()
    expect(before.find((b) => b.systemId === 'psx' && b.file === 'scph5501.bin')).toMatchObject({ present: false, required: true })
    const f = join(env.root, 'scph5501.bin')
    writeFile(f, rom(512 * 1024, 77))
    const after = await lib.biosHandlers.importFiles([f])
    expect(after.find((b) => b.systemId === 'psx' && b.file === 'scph5501.bin')).toMatchObject({ present: true, valid: false })
    expect(existsSync(join(env.settings.dataRoot, 'bios', 'scph5501.bin'))).toBe(true)
  })
})

