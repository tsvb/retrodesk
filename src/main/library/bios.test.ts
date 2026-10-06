import { createHash } from 'crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { SystemDef } from '../../shared/types'
import { checkBios, globToRegExp, importBiosFiles } from './bios'
import { rom, writeFile } from './testutil'

const tmp = mkdtempSync(join(tmpdir(), 'rd-bios-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const good = rom(2048, 42)
const goodMd5 = createHash('md5').update(good).digest('hex')

const defs: SystemDef[] = [
  {
    id: 'psx',
    name: 'PS',
    manufacturer: 'Sony',
    year: 1994,
    extensions: [],
    emulators: [],
    bios: [
      { file: 'scph5501.bin', md5: goodMd5, required: true, description: 'US' },
      { file: 'scph5502.bin', md5: 'ffffffffffffffffffffffffffffffff', required: false, description: 'EU' }
    ]
  },
  {
    id: 'dreamcast',
    name: 'DC',
    manufacturer: 'Sega',
    year: 1998,
    extensions: [],
    emulators: [],
    bios: [{ file: 'dc/dc_boot.bin', md5: '', required: false, description: 'boot' }]
  },
  {
    id: 'ps2',
    name: 'PS2',
    manufacturer: 'Sony',
    year: 2000,
    extensions: [],
    emulators: [],
    bios: [{ file: 'ps2/*.bin', md5: '', required: true, description: 'any' }]
  },
  {
    id: 'msx',
    name: 'MSX',
    manufacturer: 'MS',
    year: 1983,
    extensions: [],
    emulators: [],
    bios: [{ file: 'Machines/', md5: '', required: true, description: 'blueMSX' }]
  },
  {
    id: 'switch',
    name: 'Switch',
    manufacturer: 'Nintendo',
    year: 2017,
    extensions: [],
    emulators: [],
    bios: [{ file: 'switch/firmware/**/*.nca', md5: '', required: true, description: 'firmware' }]
  },
  {
    id: 'neogeo',
    name: 'NG',
    manufacturer: 'SNK',
    year: 1990,
    extensions: [],
    emulators: [],
    bios: [{ file: 'neogeo.zip', md5: '', required: true, description: 'bios' }]
  }
]

describe('bios', () => {
  const biosDir = join(tmp, 'bios')

  it('reports missing files', async () => {
    const st = await checkBios(defs, biosDir)
    expect(st.every((s) => !s.present && !s.valid)).toBe(true)
    expect(st.map((s) => s.file)).toEqual(['scph5501.bin', 'scph5502.bin', 'dc/dc_boot.bin', 'ps2/*.bin', 'Machines/', 'switch/firmware/**/*.nca', 'neogeo.zip'])
  })

  it('finds Switch firmware in a sub folder, as files or as <id>.nca/00 folders, and imports a folder of it', async () => {
    const dir = join(tmp, 'bios-switch')
    const by = async (f: string) => (await checkBios(defs, dir)).find((s) => s.file === f)
    writeFile(join(dir, 'switch', 'firmware', 'notes.txt'), 'x')
    expect(await by('switch/firmware/**/*.nca')).toMatchObject({ present: false })
    writeFile(join(dir, 'switch', 'firmware', 'Firmware 20.1.0', 'abc.nca', '00'), 'n')
    expect(await by('switch/firmware/**/*.nca')).toMatchObject({ present: true, valid: true })

    const picked = join(tmp, 'picked-fw', 'Firmware 19.0.1')
    writeFile(join(picked, 'def.nca'), 'n')
    const res = await importBiosFiles([join(tmp, 'picked-fw', 'Firmware 19.0.1')], defs, join(tmp, 'bios-switch2'))
    expect(res.imported).toEqual(['switch/firmware/Firmware 19.0.1/'])
    expect(existsSync(join(tmp, 'bios-switch2', 'switch', 'firmware', 'Firmware 19.0.1', 'def.nca'))).toBe(true)
    expect((await checkBios(defs, join(tmp, 'bios-switch2'))).find((s) => s.file === 'switch/firmware/**/*.nca')).toMatchObject({ present: true })
  })

  it('imports by md5 (renaming), by name, by glob/heuristic and folders', async () => {
    const src = join(tmp, 'picked')
    writeFile(join(src, 'PS1 BIOS (USA) v3.0.rom'), good) // md5 match -> scph5501.bin
    writeFile(join(src, 'SCPH5502.BIN'), rom(1024, 7)) // name match (md5 mismatch -> present, invalid)
    writeFile(join(src, 'dc_boot.bin'), rom(512, 8)) // name match into sub folder
    writeFile(join(src, 'SCPH-70012_BIOS_V12_USA_200.BIN'), rom(4 * 1024 * 1024, 9)) // ps2 glob
    writeFile(join(src, 'Machines', 'MSX2', 'config.ini'), 'x') // folder entry
    writeFile(join(src, 'random.txt'), 'nope')
    const res = await importBiosFiles(
      ['PS1 BIOS (USA) v3.0.rom', 'SCPH5502.BIN', 'dc_boot.bin', 'SCPH-70012_BIOS_V12_USA_200.BIN', 'Machines', 'random.txt', 'missing.bin'].map((n) => join(src, n)),
      defs,
      biosDir
    )
    expect(res.imported.sort()).toEqual(['Machines/', 'dc/dc_boot.bin', 'ps2/SCPH-70012_BIOS_V12_USA_200.BIN', 'scph5501.bin', 'scph5502.bin'].sort())
    expect(res.skipped).toEqual([join(src, 'random.txt')])
    expect(res.errors).toHaveLength(1) // missing.bin
    expect(existsSync(join(biosDir, 'scph5501.bin'))).toBe(true)

    const st = await checkBios(defs, biosDir)
    const by = (f: string) => st.find((s) => s.file === f)
    expect(by('scph5501.bin')).toMatchObject({ present: true, valid: true })
    expect(by('scph5502.bin')).toMatchObject({ present: true, valid: false })
    expect(by('dc/dc_boot.bin')).toMatchObject({ present: true, valid: true })
    expect(by('ps2/*.bin')).toMatchObject({ present: true, valid: true })
    expect(by('Machines/')).toMatchObject({ present: true, valid: true })
    expect(by('neogeo.zip')).toMatchObject({ present: false })
  })

  it('accepts arcade bios sets found next to ROMs', async () => {
    const z = join(tmp, 'roms', 'neogeo', 'neogeo.zip')
    writeFile(z, rom(4096))
    const st = await checkBios(defs, biosDir, [z])
    expect(st.find((s) => s.file === 'neogeo.zip')).toMatchObject({ present: true, valid: true })
  })

  it('keeps md5s across restarts and re-hashes files that changed', async () => {
    const dir = join(tmp, 'bios-cache')
    const cacheFile = join(tmp, 'cache', 'bios-md5.json')
    const bin = join(dir, 'scph5501.bin')
    writeFile(bin, good)
    expect((await checkBios(defs, dir, [], cacheFile))[0]).toMatchObject({ present: true, valid: true })
    const saved = JSON.parse(readFileSync(cacheFile, 'utf8')) as Record<string, { md5: string }>
    expect(saved[bin.toLowerCase()]?.md5).toBe(goodMd5)

    // A fresh module (next app run) trusts the saved md5 for the unchanged file: no re-hash.
    saved[bin.toLowerCase()]!.md5 = 'ffffffffffffffffffffffffffffffff'
    writeFileSync(cacheFile, JSON.stringify(saved))
    vi.resetModules()
    const fresh = await import('./bios')
    const st = await fresh.checkBios(defs, dir, [], cacheFile)
    expect(st.find((s) => s.file === 'scph5501.bin')).toMatchObject({ present: true, valid: false })
    expect(st.find((s) => s.file === 'scph5502.bin')).toMatchObject({ present: false })

    // Once the file changes (here only its mtime), it is hashed again.
    utimesSync(bin, new Date(), new Date(Date.now() + 5000))
    expect((await fresh.checkBios(defs, dir, [], cacheFile))[0]).toMatchObject({ present: true, valid: true })
  })

  it('glob helper', () => {
    expect(globToRegExp('Complex_4627*.bin').test('complex_4627v1.03.bin')).toBe(true)
    expect(globToRegExp('*.nca').test('a.nca.txt')).toBe(false)
  })
})
