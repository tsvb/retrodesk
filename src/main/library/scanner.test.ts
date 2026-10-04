import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { detectFileSystem, scanFolders, type ScanOutput, type ScannedGame } from './scanner'
import { sniffSystem } from './sniff'
import { buildSfo, fakeGameCubeIso, fakeIso, rom, writeFile } from './testutil'
import { normPath } from './util'

let tmp: string
let out: ScanOutput
const byName = (n: string): ScannedGame | undefined => out.games.find((g) => g.fileName === n)

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'rd-scan-'))
  const A = join(tmp, 'Roms')
  // SNES: plain cartridge + sidecar cover + nested folder + junk
  writeFile(join(A, 'SNES', 'Super Mario World (USA).sfc'), rom(4096))
  writeFile(join(A, 'SNES', 'Super Mario World (USA).png'), rom(100))
  writeFile(join(A, 'SNES', 'readme.txt'), 'hello')
  writeFile(join(A, 'SNES', 'tiny.zip'), rom(100))
  writeFile(join(A, 'SNES', 'Hacks', 'Some Hack.smc'), rom(2048, 2))
  // PS1: m3u multi-disc, cue/bin, ccd/img/sub, lone bin
  const P = join(A, 'PSX')
  writeFile(join(P, 'Final Fantasy VII (USA).m3u'), 'Final Fantasy VII (USA) (Disc 1).cue\r\nFinal Fantasy VII (USA) (Disc 2).cue\r\n')
  for (const d of [1, 2]) {
    writeFile(join(P, `Final Fantasy VII (USA) (Disc ${d}).cue`), `FILE "Final Fantasy VII (USA) (Disc ${d}).bin" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n`)
    writeFile(join(P, `Final Fantasy VII (USA) (Disc ${d}).bin`), rom(10_000, d))
  }
  writeFile(join(P, 'Crash Bandicoot (USA).cue'), 'FILE "Crash Bandicoot (USA) (Track 1).bin" BINARY\nFILE "Crash Bandicoot (USA) (Track 2).bin" BINARY\n')
  writeFile(join(P, 'Crash Bandicoot (USA) (Track 1).bin'), rom(5000, 3))
  writeFile(join(P, 'Crash Bandicoot (USA) (Track 2).bin'), rom(3000, 4))
  writeFile(join(P, 'Spyro.ccd'), '[CloneCD]\nVersion=3\n')
  writeFile(join(P, 'Spyro.img'), rom(4000, 5))
  writeFile(join(P, 'Spyro.sub'), rom(1000, 6))
  writeFile(join(P, 'Lone Game (USA).bin'), rom(4000, 7))
  // Dreamcast GDI
  const D = join(A, 'dreamcast', 'Sonic Adventure (USA)')
  writeFile(join(D, 'Sonic Adventure (USA).gdi'), '3\n1 0 4 2352 track01.bin 0\n2 450 0 2352 "track02.raw" 0\n3 45000 4 2352 track03.bin 0\n')
  for (const t of ['track01.bin', 'track02.raw', 'track03.bin']) writeFile(join(D, t), rom(3000))
  // Genesis: real ROM with .md vs a README.md
  writeFile(join(A, 'megadrive', 'Sonic the Hedgehog (USA, Europe).md'), rom(4096, 9))
  writeFile(join(A, 'megadrive', 'README.md'), '# My Genesis ROMs\n\nThese are my dumps. '.repeat(100))
  // Unrecognised folder: unique extension, sniffed ISOs, unknown bin, markdown
  const M = join(A, 'misc')
  writeFile(join(M, 'Golden Sun (USA).gba'), rom(4096, 10))
  writeFile(join(M, 'README.md'), '# notes\n'.repeat(400))
  writeFile(join(M, 'Some PSP Game (USA).iso'), fakeIso('PSP GAME'))
  writeFile(join(M, 'Some GC Game (USA).iso'), fakeGameCubeIso())
  writeFile(join(M, 'mystery.bin'), rom(4096, 11))
  writeFile(join(M, 'Panzer Dragoon (Europe).cue'), 'FILE "Panzer Dragoon (Europe).bin" BINARY\n')
  const sat = rom(4096, 12)
  sat.write('SEGA SEGASATURN ', 16, 'latin1')
  writeFile(join(M, 'Panzer Dragoon (Europe).bin'), sat)
  // PS3 folder game, Wii U loose game, Vita folder
  const ps3 = join(A, 'ps3', 'BLUS30443')
  writeFile(join(ps3, 'PS3_GAME', 'USRDIR', 'EBOOT.BIN'), rom(8000))
  writeFile(join(ps3, 'PS3_GAME', 'PARAM.SFO'), buildSfo({ TITLE: "Demon's Souls", TITLE_ID: 'BLUS30443' }))
  writeFile(join(ps3, 'PS3_GAME', 'PIC1.PNG'), rom(500))
  writeFile(join(A, 'ps3', 'Journey.ps3', 'USRDIR', 'EBOOT.BIN'), rom(3000))
  const wiiu = join(A, 'Wii U', 'Mario Kart 8 [AMKE01]')
  writeFile(join(wiiu, 'code', 'Turbo.rpx'), rom(6000))
  writeFile(join(wiiu, 'content', 'data.bin'), rom(2000))
  writeFile(join(wiiu, 'meta', 'meta.xml'), '<?xml version="1.0"?><menu><longname_en type="string" length="512">Mario Kart 8</longname_en></menu>')
  const vita = join(A, 'psvita', 'Persona 4 Golden')
  writeFile(join(vita, 'eboot.bin'), rom(3000))
  writeFile(join(vita, 'sce_sys', 'param.sfo'), buildSfo({ TITLE: 'Persona 4 Golden', TITLE_ID: 'PCSE00120' }))
  // Arcade: games + bios set
  writeFile(join(A, 'fbneo', 'mslug.zip'), rom(4096))
  writeFile(join(A, 'fbneo', 'neogeo.zip'), rom(4096))
  // Skipped places
  writeFile(join(A, '.hidden', 'Secret (USA).gba'), rom(4096))
  writeFile(join(A, 'Emulators', 'RetroArch', 'Bundled (USA).gba'), rom(4096))
  writeFile(join(A, 'SNES', 'media', 'covers', 'x.sfc'), rom(4096))
  writeFile(join(A, 'excluded', 'Excluded (USA).gba'), rom(4096))
  // Second root with a fixed system
  const B = join(tmp, 'GB Stuff')
  writeFile(join(B, 'Tetris (World).gb'), rom(4096))
  writeFile(join(B, 'Zipped (USA).zip'), rom(4096))

  out = await scanFolders({
    roots: [{ path: A }, { path: B, systemId: 'gb' }, { path: join(tmp, 'does-not-exist') }],
    excludeDirs: [join(A, 'excluded')],
    arcadeNames: new Map([['mslug', 'Metal Slug - Super Vehicle-001']])
  })
})

afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('scanFolders', () => {
  it('finds exactly the expected games', () => {
    const names = out.games.map((g) => `${g.systemId}:${g.fileName}`).sort()
    expect(names).toEqual(
      [
        'dreamcast:Sonic Adventure (USA).gdi',
        'gb:Tetris (World).gb',
        'gb:Zipped (USA).zip',
        'gba:Golden Sun (USA).gba',
        'gc:Some GC Game (USA).iso',
        'genesis:Sonic the Hedgehog (USA, Europe).md',
        'arcade:mslug.zip',
        'ps3:BLUS30443',
        'ps3:Journey.ps3',
        'psp:Some PSP Game (USA).iso',
        'psx:Crash Bandicoot (USA).cue',
        'psx:Final Fantasy VII (USA).m3u',
        'psx:Lone Game (USA).bin',
        'psx:Spyro.ccd',
        'saturn:Panzer Dragoon (Europe).cue',
        'snes:Some Hack.smc',
        'snes:Super Mario World (USA).sfc',
        'vita:Persona 4 Golden',
        'wiiu:Turbo.rpx'
      ].sort()
    )
  })

  it('parses titles and regions', () => {
    expect(byName('Super Mario World (USA).sfc')).toMatchObject({ title: 'Super Mario World', regions: ['USA'], rawName: 'Super Mario World (USA)' })
    expect(byName('mslug.zip')).toMatchObject({ title: 'Metal Slug: Super Vehicle-001', rawName: 'mslug' })
  })

  it('uses sidecar images', () => {
    expect(byName('Super Mario World (USA).sfc')?.localMedia.boxart).toMatch(/Super Mario World \(USA\)\.png$/)
  })

  it('sums the size of multi-file games', () => {
    expect(byName('Crash Bandicoot (USA).cue')?.sizeBytes).toBeGreaterThan(8000)
    expect(byName('Final Fantasy VII (USA).m3u')?.sizeBytes).toBeGreaterThan(20_000)
    expect(byName('Spyro.ccd')?.sizeBytes).toBeGreaterThan(5000)
  })

  it('handles directory-format games', () => {
    const ps3 = byName('BLUS30443')
    expect(ps3?.path).toBe(join(tmp, 'Roms', 'ps3', 'BLUS30443'))
    expect(ps3?.title).toBe("Demon's Souls")
    expect(ps3?.localMedia.snap).toMatch(/PIC1\.PNG$/)
    expect(byName('Journey.ps3')?.rawName).toBe('Journey')
    const wiiu = byName('Turbo.rpx')
    expect(wiiu?.path).toBe(join(tmp, 'Roms', 'Wii U', 'Mario Kart 8 [AMKE01]', 'code', 'Turbo.rpx'))
    expect(wiiu).toMatchObject({ title: 'Mario Kart 8', rawName: 'Mario Kart 8 [AMKE01]' })
    expect(byName('Persona 4 Golden')?.path).toBe(join(tmp, 'Roms', 'psvita', 'Persona 4 Golden'))
  })

  it('reports bios sets and unreachable roots', () => {
    expect(out.biosFiles.some((f) => f.endsWith('neogeo.zip'))).toBe(true)
    expect(out.unreachableRoots).toEqual([join(tmp, 'does-not-exist')])
  })

  it('reuses what earlier scans found', async () => {
    const dir = join(tmp, 'rescan', 'stuff')
    const iso = join(dir, 'Disc (USA).iso')
    const sfc = join(dir, 'Cart (USA).sfc')
    writeFile(iso, fakeIso('PSP GAME'))
    writeFile(sfc, rom(4096))
    const isoSize = fakeIso('PSP GAME').length
    const scan = async (known: Map<string, { sizeBytes: number; systemId: string }>, trustKnownSizes = false) => {
      const r = await scanFolders({ roots: [{ path: dir }], known, trustKnownSizes })
      return Object.fromEntries(r.games.map((g) => [g.fileName, `${g.systemId}:${g.sizeBytes}`]))
    }
    // A known system with a matching size is taken as is (the header says PSP: no sniff happened).
    expect(await scan(new Map([[normPath(iso), { sizeBytes: isoSize, systemId: 'ps2' }]]))).toMatchObject({ 'Disc (USA).iso': `ps2:${isoSize}` })
    // The file changed size: sniff again.
    expect(await scan(new Map([[normPath(iso), { sizeBytes: 1, systemId: 'ps2' }]]))).toMatchObject({ 'Disc (USA).iso': `psp:${isoSize}` })
    // Known sizes are measured again unless trusted.
    const known = new Map([[normPath(sfc), { sizeBytes: 123, systemId: 'snes' }]])
    expect(await scan(known)).toMatchObject({ 'Cart (USA).sfc': 'snes:4096' })
    expect(await scan(known, true)).toMatchObject({ 'Cart (USA).sfc': 'snes:123' })
  })

  it('scans 20k files quickly', async () => {
    const big = join(tmp, 'big')
    for (let d = 0; d < 40; d++) {
      const dir = join(big, d % 2 ? 'snes' : 'gba', `set${d}`)
      mkdirSync(dir, { recursive: true })
      for (let i = 0; i < 500; i++) writeFile(join(dir, `Game ${d}-${i} (USA).${d % 2 ? 'sfc' : 'gba'}`), rom(1100, i))
    }
    const t0 = Date.now()
    const r = await scanFolders({ roots: [{ path: big }] })
    const ms = Date.now() - t0
    expect(r.games.length).toBe(20_000)
    expect(ms).toBeLessThan(15_000)
    console.log(`scanned 20k files in ${ms} ms`)
  }, 120_000)
})

describe('detectFileSystem / sniff', () => {
  it('detects by extension, folder and header', async () => {
    const f = (p: string) => join(tmp, 'Roms', p)
    expect(await detectFileSystem(f('SNES/Super Mario World (USA).sfc'))).toBe('snes')
    expect(await detectFileSystem(f('misc/Some PSP Game (USA).iso'))).toBe('psp')
    expect(await detectFileSystem(f('misc/Panzer Dragoon (Europe).cue'))).toBe('saturn')
    expect(await detectFileSystem(f('PSX/Crash Bandicoot (USA).cue'))).toBe('psx')
    expect(await detectFileSystem(f('fbneo/mslug.zip'))).toBe('arcade')
    expect(await detectFileSystem(f('misc/mystery.bin'))).toBeUndefined()
    expect(await detectFileSystem(f('SNES/readme.txt'))).toBeUndefined()
    expect(await sniffSystem(f('misc/Some GC Game (USA).iso'))).toBe('gc')
    const ps2 = join(tmp, 'ps2.iso')
    writeFile(ps2, fakeIso('PLAYSTATION'))
    expect(await sniffSystem(ps2, ['psx', 'ps2'])).toBe('psx') // CD-sized, no SYSTEM.CNF
  })
})
