import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import type { SystemDef } from '../../shared/types'
import { biosEntryPresent, missingBios } from './bios'

const bios = mkdtempSync(join(tmpdir(), 'rd-bios-'))
afterAll(() => rmSync(bios, { recursive: true, force: true }))

const sys = (id: string, files: [string, boolean][], emulators: SystemDef['emulators'] = []): SystemDef =>
  ({ id, name: id.toUpperCase(), manufacturer: '', year: 0, extensions: [], emulators, bios: files.map(([file, required]) => ({ file, required, md5: '', description: file })) }) as SystemDef

describe('biosEntryPresent', () => {
  it('handles files, dirs and globs', () => {
    expect(biosEntryPresent(bios, 'ps2/*.bin')).toBe(false)
    mkdirSync(join(bios, 'ps2'))
    writeFileSync(join(bios, 'ps2', 'SCPH-39001.BIN'), '')
    expect(biosEntryPresent(bios, 'ps2/*.bin')).toBe(true)
    mkdirSync(join(bios, 'Machines'))
    expect(biosEntryPresent(bios, 'Machines/')).toBe(false)
    writeFileSync(join(bios, 'Machines', 'x'), '')
    expect(biosEntryPresent(bios, 'Machines/')).toBe(true)
    expect(biosEntryPresent(bios, 'Complex_4627*.bin')).toBe(false)
  })
})

describe('missingBios', () => {
  const psx = sys('psx', [
    ['scph5501.bin', true],
    ['scph5502.bin', false]
  ])
  it('accepts region alternatives and HLE cores', () => {
    const ref = { type: 'retroarch' as const, core: 'mednafen_psx_hw_libretro' }
    expect(missingBios({ system: psx, ref, biosDir: bios }).map((b) => b.file)).toEqual(['scph5501.bin'])
    expect(missingBios({ system: psx, ref: { type: 'retroarch', core: 'pcsx_rearmed_libretro' }, biosDir: bios })).toEqual([])
    writeFileSync(join(bios, 'scph5502.bin'), '')
    expect(missingBios({ system: psx, ref, biosDir: bios })).toEqual([])
  })
  it('only requires core asset packs for the core that needs them', () => {
    const psp = sys('psp', [['PPSSPP/ppge_atlas.zim', true]])
    expect(missingBios({ system: psp, ref: { type: 'standalone', id: 'ppsspp' }, biosDir: bios })).toEqual([])
    expect(missingBios({ system: psp, ref: { type: 'retroarch', core: 'ppsspp_libretro' }, biosDir: bios })).toHaveLength(1)
  })
  it('finds neogeo.zip next to the ROM', () => {
    const neo = sys('neogeo', [['neogeo.zip', true]])
    const romDir = join(bios, 'roms')
    mkdirSync(romDir)
    const ref = { type: 'retroarch' as const, core: 'fbneo_libretro' }
    expect(missingBios({ system: neo, ref, biosDir: bios, romPath: join(romDir, 'mslug.zip') })).toHaveLength(1)
    writeFileSync(join(romDir, 'neogeo.zip'), '')
    expect(missingBios({ system: neo, ref, biosDir: bios, romPath: join(romDir, 'mslug.zip') })).toEqual([])
  })
  it('leaves firmware checks of provisioned standalones to provisionStandalone', () => {
    const ps3 = sys('ps3', [['PS3UPDAT.PUP', true]])
    expect(missingBios({ system: ps3, ref: { type: 'standalone', id: 'rpcs3' }, biosDir: bios })).toEqual([])
  })
})
