import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { importRomFiles } from './importer'
import { rom, writeFile } from './testutil'

const tmp = mkdtempSync(join(tmpdir(), 'rd-import-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

/** A Dreamcast GDI dump with the generic file names real dumps use. */
function gdiGame(dir: string, seed: number): { gdi: string; track1: Buffer; track3: Buffer } {
  const track1 = rom(4096 + seed, seed)
  const track3 = rom(8192 + seed, seed + 1)
  writeFile(join(dir, 'disc.gdi'), `2\n1 0 4 2352 track01.bin 0\n3 45000 4 2352 track03.bin 0\n`)
  writeFile(join(dir, 'track01.bin'), track1)
  writeFile(join(dir, 'track03.bin'), track3)
  return { gdi: join(dir, 'disc.gdi'), track1, track3 }
}

describe('importRomFiles', () => {
  it('keeps two games apart when their companion files share names', async () => {
    const roms = join(tmp, 'a', 'roms')
    const first = gdiGame(join(tmp, 'a', 'src', 'Game One'), 1)
    const second = gdiGame(join(tmp, 'a', 'src', 'Game Two'), 2)

    await importRomFiles([first.gdi], roms)
    const r = await importRomFiles([second.gdi], roms)

    expect(r.errors).toEqual([])
    const dc = join(roms, 'dreamcast')
    // The first game is untouched...
    expect(readFileSync(join(dc, 'track01.bin')).equals(first.track1)).toBe(true)
    expect(readFileSync(join(dc, 'track03.bin')).equals(first.track3)).toBe(true)
    // ...and the second one is complete, in a folder of its own.
    expect(readFileSync(join(dc, 'disc', 'track01.bin')).equals(second.track1)).toBe(true)
    expect(readFileSync(join(dc, 'disc', 'track03.bin')).equals(second.track3)).toBe(true)
    expect(existsSync(join(dc, 'disc', 'disc.gdi'))).toBe(true)
  })

  it('skips a game that is already imported', async () => {
    const roms = join(tmp, 'b', 'roms')
    const game = gdiGame(join(tmp, 'b', 'src'), 3)
    const once = await importRomFiles([game.gdi], roms)
    const twice = await importRomFiles([game.gdi], roms)
    expect(once.copied).toHaveLength(3)
    expect(twice.copied).toEqual([])
    expect(twice.skipped).toHaveLength(3)
    expect(existsSync(join(roms, 'dreamcast', 'disc'))).toBe(false)
  })

  it('does not overwrite a different single-file ROM of the same name', async () => {
    const roms = join(tmp, 'c', 'roms')
    const original = rom(4096, 5)
    writeFile(join(tmp, 'c', 'one', 'Game.gba'), original)
    writeFile(join(tmp, 'c', 'two', 'Game.gba'), rom(8192, 6))

    await importRomFiles([join(tmp, 'c', 'one', 'Game.gba')], roms)
    const r = await importRomFiles([join(tmp, 'c', 'two', 'Game.gba')], roms)

    expect(r.copied).toEqual([])
    expect(r.errors).toHaveLength(1)
    expect(readFileSync(join(roms, 'gba', 'Game.gba')).equals(original)).toBe(true)
  })
})
