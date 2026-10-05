import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { ensurePortable, expandArgs, getStandaloneDef, parseSfo, provisionStandalone, readIniValue, resolveRom, STANDALONE_DEFS, titleIdFromName, upsertIni } from './standalone'
import { parseEmulatorKey, resolveGameRef } from './keys'
import type { SystemDef } from '../../shared/types'

const dir = mkdtempSync(join(tmpdir(), 'rd-sa-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** Build a minimal PARAM.SFO with string entries. */
function makeSfo(entries: Record<string, string>): Buffer {
  const keys = Object.keys(entries)
  const keyTable = Buffer.concat(keys.map((k) => Buffer.from(`${k}\0`)))
  const datas = keys.map((k) => {
    const b = Buffer.alloc(Math.ceil((entries[k]!.length + 1) / 4) * 4)
    b.write(entries[k]!)
    return b
  })
  const headerLen = 20 + keys.length * 16
  const keyStart = headerLen
  const dataStart = keyStart + keyTable.length
  const h = Buffer.alloc(headerLen)
  h.writeUInt32BE(0x00505346, 0)
  h.writeUInt32LE(0x101, 4)
  h.writeUInt32LE(keyStart, 8)
  h.writeUInt32LE(dataStart, 12)
  h.writeUInt32LE(keys.length, 16)
  let ko = 0
  let dofs = 0
  keys.forEach((k, i) => {
    const e = 20 + i * 16
    h.writeUInt16LE(ko, e)
    h.writeUInt16LE(0x0204, e + 2)
    h.writeUInt32LE(entries[k]!.length + 1, e + 4)
    h.writeUInt32LE(datas[i]!.length, e + 8)
    h.writeUInt32LE(dofs, e + 12)
    ko += k.length + 1
    dofs += datas[i]!.length
  })
  return Buffer.concat([h, keyTable, ...datas])
}

describe('definitions', () => {
  it('every def has an exe, args with {rom}/{titleId} and a source', () => {
    for (const d of STANDALONE_DEFS) {
      expect(d.exe).toMatch(/\.exe$/i)
      expect(d.args.some((a) => a.includes('{rom}') || a.includes('{titleId}'))).toBe(true)
      expect(() => new RegExp(d.assetPattern)).not.toThrow()
    }
    expect(getStandaloneDef('ppsspp')?.exe).toBe('PPSSPPWindows64.exe')
  })
})

describe('expandArgs', () => {
  it('substitutes placeholders and keeps paths with spaces as single args', () => {
    expect(expandArgs(['-full-screen', '-dvd_path', '{rom}'], { rom: 'D:\\Xbox Games\\Halo.iso' })).toEqual(['-full-screen', '-dvd_path', 'D:\\Xbox Games\\Halo.iso'])
    expect(expandArgs(['-F', '-r', '{titleId}'], { titleId: 'PCSE00123' })).toEqual(['-F', '-r', 'PCSE00123'])
    expect(expandArgs(['--user={exeDir}\\user'], { exeDir: 'C:\\emu' })).toEqual(['--user=C:\\emu\\user'])
  })
  it('drops empty placeholders', () => {
    expect(expandArgs(['--fullscreen', '{rom}'], {})).toEqual(['--fullscreen'])
  })
})

describe('emulator keys', () => {
  const sys = {
    id: 'psx',
    emulators: [
      { type: 'retroarch', core: 'mednafen_psx_hw_libretro', default: true },
      { type: 'standalone', id: 'duckstation' }
    ]
  } as unknown as SystemDef
  it('parses all key formats', () => {
    expect(parseEmulatorKey('retroarch:snes9x_libretro')).toEqual({ type: 'retroarch', core: 'snes9x_libretro' })
    expect(parseEmulatorKey('core:snes9x')).toEqual({ type: 'retroarch', core: 'snes9x' })
    expect(parseEmulatorKey('standalone:dolphin')).toEqual({ type: 'standalone', id: 'dolphin' })
    expect(parseEmulatorKey('dolphin')).toEqual({ type: 'standalone', id: 'dolphin' })
    expect(parseEmulatorKey('')).toBeUndefined()
  })
  it('resolves override -> settings -> default', () => {
    expect(resolveGameRef({}, sys, { systemEmulator: {} })).toEqual({ type: 'retroarch', core: 'mednafen_psx_hw_libretro' })
    expect(resolveGameRef({}, sys, { systemEmulator: { psx: 'standalone:duckstation' } })).toEqual({ type: 'standalone', id: 'duckstation' })
    expect(resolveGameRef({ emulatorOverride: 'retroarch:swanstation_libretro' }, sys, { systemEmulator: { psx: 'standalone:duckstation' } })).toEqual({
      type: 'retroarch',
      core: 'swanstation_libretro'
    })
  })
})

describe('ROM resolution', () => {
  it('finds EBOOT.BIN in PS3 folders', async () => {
    const g = join(dir, 'Demon Souls [BLUS30443]')
    mkdirSync(join(g, 'PS3_GAME', 'USRDIR'), { recursive: true })
    writeFileSync(join(g, 'PS3_GAME', 'USRDIR', 'EBOOT.BIN'), '')
    const r = await resolveRom(getStandaloneDef('rpcs3')!, g)
    expect(r.vars.rom).toBe(join(g, 'PS3_GAME', 'USRDIR', 'EBOOT.BIN'))
  })
  it('finds code/*.rpx in Wii U folders', async () => {
    const g = join(dir, 'Zelda BotW')
    mkdirSync(join(g, 'code'), { recursive: true })
    writeFileSync(join(g, 'code', 'U-King.rpx'), '')
    expect((await resolveRom(getStandaloneDef('cemu')!, g)).vars.rom).toBe(join(g, 'code', 'U-King.rpx'))
    await expect(resolveRom(getStandaloneDef('cemu')!, dir)).rejects.toThrow(/rpx/)
  })
  it('gets Vita title IDs from param.sfo, names, or falls back to content install', async () => {
    const g = join(dir, 'vita-game')
    mkdirSync(join(g, 'sce_sys'), { recursive: true })
    writeFileSync(join(g, 'sce_sys', 'param.sfo'), makeSfo({ TITLE: 'Persona 4 Golden', TITLE_ID: 'PCSE00120' }))
    const vita = getStandaloneDef('vita3k')!
    expect((await resolveRom(vita, g)).vars.titleId).toBe('PCSE00120')
    expect((await resolveRom(vita, join(dir, 'Gravity Rush [PCSA00011].vpk'))).vars.titleId).toBe('PCSA00011')
    expect((await resolveRom(vita, join(dir, 'Tearaway.vpk'))).argsOverride).toEqual(['-F', join(dir, 'Tearaway.vpk')])
    await expect(resolveRom(vita, join(dir, 'Game.pkg'))).rejects.toThrow(/zRIF/)
    expect(titleIdFromName('foo (PCSB00245)')).toBe('PCSB00245')
    expect(titleIdFromName('Mario 64')).toBeUndefined()
  })
  it('parses PARAM.SFO', () => {
    expect(parseSfo(makeSfo({ TITLE_ID: 'BLUS30443', TITLE: "Demon's Souls" }))).toEqual({ TITLE_ID: 'BLUS30443', TITLE: "Demon's Souls" })
    expect(() => parseSfo(Buffer.from('nope nope nope nope nope'))).toThrow()
  })
})

describe('ini upsert', () => {
  it('adds sections/keys and replaces existing values without touching others', () => {
    let t = upsertIni('', 'UI', 'SetupWizardIncomplete', 'false')
    expect(t).toBe('[UI]\nSetupWizardIncomplete = false\n')
    t = upsertIni('[UI]\r\nTheme = dark\r\nSetupWizardIncomplete = true\r\n\r\n[Folders]\r\nBios = bios\r\n', 'UI', 'SetupWizardIncomplete', 'false')
    expect(t).toBe('[UI]\r\nTheme = dark\r\nSetupWizardIncomplete = false\r\n\r\n[Folders]\r\nBios = bios\r\n')
    t = upsertIni(t, 'UI', 'ConfirmShutdown', 'false')
    expect(t).toContain('SetupWizardIncomplete = false\r\nConfirmShutdown = false\r\n\r\n[Folders]')
    t = upsertIni(t, 'Filenames', 'BIOS', 'scph70012.bin')
    expect(readIniValue(t, 'Filenames', 'BIOS')).toBe('scph70012.bin')
    expect(readIniValue(t, 'Folders', 'Bios')).toBe('bios')
  })
})

describe('provisioning', () => {
  it('copies PS2 BIOS into PCSX2 and writes PCSX2.ini', async () => {
    const bios = join(dir, 'bios1')
    const exeDir = join(dir, 'pcsx2')
    mkdirSync(join(bios, 'ps2'), { recursive: true })
    mkdirSync(exeDir, { recursive: true })
    const missing = await provisionStandalone(getStandaloneDef('pcsx2')!, exeDir, bios)
    expect(missing.ok).toBe(false)
    writeFileSync(join(bios, 'ps2', 'SCPH-70012.bin'), Buffer.alloc(16))
    expect((await provisionStandalone(getStandaloneDef('pcsx2')!, exeDir, bios)).ok).toBe(true)
    const ini = readFileSync(join(exeDir, 'inis', 'PCSX2.ini'), 'utf8')
    expect(readIniValue(ini, 'Filenames', 'BIOS')).toBe('SCPH-70012.bin')
    expect(readIniValue(ini, 'UI', 'SetupWizardIncomplete')).toBe('false')
  })
  it('writes xemu.toml paths and reports missing files', async () => {
    const bios = join(dir, 'bios2')
    const exeDir = join(dir, 'xemu')
    mkdirSync(bios, { recursive: true })
    mkdirSync(exeDir, { recursive: true })
    writeFileSync(join(bios, 'mcpx_1.0.bin'), '')
    writeFileSync(join(bios, 'Complex_4627v1.03.bin'), '')
    const r = await provisionStandalone(getStandaloneDef('xemu')!, exeDir, bios)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/xbox_hdd\.qcow2/)
    const toml = readFileSync(join(exeDir, 'xemu.toml'), 'utf8')
    expect(readIniValue(toml, 'sys.files', 'bootrom_path')).toBe(join(bios, 'mcpx_1.0.bin'))
    expect(readIniValue(toml, 'sys.files', 'flashrom_path')).toBe(join(bios, 'Complex_4627v1.03.bin'))
  })
  it('points DuckStation at the BIOS dir from its declared config', async () => {
    const bios = join(dir, 'bios4')
    const exeDir = join(dir, 'duck')
    mkdirSync(exeDir, { recursive: true })
    expect((await provisionStandalone(getStandaloneDef('duckstation')!, exeDir, bios)).ok).toBe(true)
    const ini = readFileSync(join(exeDir, 'settings.ini'), 'utf8')
    expect(readIniValue(ini, 'BIOS', 'SearchDirectory')).toBe(bios)
    expect(readIniValue(ini, 'Main', 'ConfirmPowerOff')).toBe('false')
  })
  it('tells apart missing PS3 firmware, firmware to install by hand, and installed firmware', async () => {
    const bios = join(dir, 'bios5')
    const exeDir = join(dir, 'rpcs3')
    mkdirSync(bios, { recursive: true })
    mkdirSync(exeDir, { recursive: true })
    const rpcs3 = getStandaloneDef('rpcs3')!
    expect((await provisionStandalone(rpcs3, exeDir, bios)).error).toMatch(/playstation\.com/)
    writeFileSync(join(bios, 'PS3UPDAT.PUP'), '')
    expect((await provisionStandalone(rpcs3, exeDir, bios)).error).toContain(`Install Firmware with ${join(bios, 'PS3UPDAT.PUP')}`)
    mkdirSync(join(exeDir, 'dev_flash', 'vsh', 'module'), { recursive: true })
    expect((await provisionStandalone(rpcs3, exeDir, bios)).ok).toBe(true)
  })
  it('accepts Vita firmware that is either dumped or already installed', async () => {
    const bios = join(dir, 'bios6')
    const exeDir = join(dir, 'vita3k')
    mkdirSync(join(bios, 'vita'), { recursive: true })
    mkdirSync(exeDir, { recursive: true })
    const vita = getStandaloneDef('vita3k')!
    expect((await provisionStandalone(vita, exeDir, bios)).error).toMatch(/PSVUPDAT\.PUP/)
    writeFileSync(join(bios, 'vita', 'PSVUPDAT.PUP'), '')
    expect((await provisionStandalone(vita, exeDir, bios)).ok).toBe(true)
  })
  it('creates portable markers with their declared content', async () => {
    const exeDir = join(dir, 'xemu-portable')
    mkdirSync(exeDir, { recursive: true })
    await ensurePortable(getStandaloneDef('xemu')!, exeDir)
    expect(readFileSync(join(exeDir, 'xemu.toml'), 'utf8')).toContain('show_welcome = false')
  })
  it('installs Switch keys + firmware NCAs into Eden', async () => {
    const bios = join(dir, 'bios3')
    const exeDir = join(dir, 'eden')
    mkdirSync(join(bios, 'switch', 'firmware'), { recursive: true })
    mkdirSync(exeDir, { recursive: true })
    expect((await provisionStandalone(getStandaloneDef('eden')!, exeDir, bios)).error).toMatch(/prod\.keys/)
    writeFileSync(join(bios, 'prod.keys'), 'k')
    expect((await provisionStandalone(getStandaloneDef('eden')!, exeDir, bios)).error).toMatch(/firmware/)
    writeFileSync(join(bios, 'switch', 'firmware', 'abc.nca'), 'n')
    expect((await provisionStandalone(getStandaloneDef('eden')!, exeDir, bios)).ok).toBe(true)
    expect(readFileSync(join(exeDir, 'user', 'nand', 'system', 'Contents', 'registered', 'abc.nca'), 'utf8')).toBe('n')
    expect(readFileSync(join(exeDir, 'user', 'keys', 'prod.keys'), 'utf8')).toBe('k')
  })
})
