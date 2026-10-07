import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it, vi } from 'vitest'

// These tests describe the Windows builds; macOS cases pass the OS explicitly.
vi.mock('../platform', async (importOriginal) => ({ ...(await importOriginal<typeof import('../platform')>()), hostOs: () => 'windows', isMac: () => false }))
import {
  ensureDirs,
  ensurePortable,
  expandArgs,
  expandDataPath,
  findAppExecutable,
  getStandaloneDef,
  parseSfo,
  provisionStandalone,
  RAW_STANDALONE_DEFS,
  readIniValue,
  resolveRom,
  resolveStandaloneDef,
  STANDALONE_DEFS,
  standaloneDataDir,
  titleIdFromName,
  upsertIni
} from './standalone'
import { isTrustedDownloadUrl } from './download'
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

  it('every macOS build is an app bundle from a trusted host, matched by its own asset pattern', () => {
    for (const arch of ['arm64', 'x64'] as const) {
      for (const raw of RAW_STANDALONE_DEFS) {
        const d = resolveStandaloneDef(raw, 'macos', arch)
        if (!d) continue
        expect(d.exe, d.id).toMatch(/^[^/]+\.app\/Contents\/MacOS\/[^/]+$/)
        expect(d.needsVcRedist).toBe(false)
        expect(d.portable).toEqual([])
        expect(d.args).toEqual(raw.args)
        expect(d.assetPattern, d.id).not.toMatch(/windows|win64|\.exe/i)
        if (d.fallback) {
          expect(isTrustedDownloadUrl(d.fallback.url), d.id).toBe(true)
          // The pinned fallback is a build of the same kind the feed is searched for.
          if (d.source.type !== 'dolphin') expect(d.fallback.url.split('/').pop(), d.id).toMatch(new RegExp(d.assetPattern))
        }
      }
    }
  })

  it('resolves per OS and CPU architecture', () => {
    const raw = (id: string) => RAW_STANDALONE_DEFS.find((d) => d.id === id)!
    expect(resolveStandaloneDef(raw('eden'), 'windows')?.exe).toBe('eden.exe')
    // Eden's macOS build is Apple Silicon only; Vita3K and RPCS3 have one build per architecture.
    expect(resolveStandaloneDef(raw('eden'), 'macos', 'arm64')?.firmware?.[0]?.copyTo).toBe('keys/prod.keys')
    expect(resolveStandaloneDef(raw('eden'), 'macos', 'x64')).toBeUndefined()
    expect(resolveStandaloneDef(raw('vita3k'), 'macos', 'arm64')?.assetPattern).toBe('^macos-arm64-latest\\.dmg$')
    expect(resolveStandaloneDef(raw('vita3k'), 'macos', 'x64')?.assetPattern).toBe('^macos-latest\\.dmg$')
    expect(resolveStandaloneDef(raw('rpcs3'), 'macos', 'arm64')?.source).toEqual({ type: 'github', repo: 'RPCS3/rpcs3-binaries-mac-arm64' })
    expect(new RegExp(resolveStandaloneDef(raw('rpcs3'), 'macos', 'x64')!.assetPattern).test('rpcs3-v0.0.43-20217-ba4a4b56_macos_aarch64.7z')).toBe(false)
    expect(resolveStandaloneDef({ ...raw('azahar'), macos: undefined }, 'macos')).toBeUndefined()
  })

  it('provisions into the data folder a macOS build uses', () => {
    expect(standaloneDataDir({}, '/emu/x')).toBe('/emu/x')
    expect(standaloneDataDir({ dataDir: '~/Library/Application Support/DuckStation' }, '/emu/x', '/Users/me', {})).toBe(join('/Users/me', 'Library', 'Application Support', 'DuckStation'))
    // Eden follows the XDG spec on macOS: ~/.local/share unless XDG_DATA_HOME says otherwise.
    const eden = resolveStandaloneDef(
      RAW_STANDALONE_DEFS.find((d) => d.id === 'eden')!,
      'macos',
      'arm64'
    )!
    expect(standaloneDataDir(eden, '/emu/x', '/Users/me', {})).toBe(join('/Users/me', '.local', 'share', 'eden'))
    expect(standaloneDataDir(eden, '/emu/x', '/Users/me', { XDG_DATA_HOME: '/Volumes/data/xdg' })).toBe(join('/Volumes/data/xdg', 'eden'))
    expect(expandDataPath('~/.config/eden', '/emu/x', '/Users/me', { XDG_DATA_HOME: '/elsewhere' })).toBe(join('/Users/me', '.config', 'eden'))
    expect(expandDataPath('~/.config/eden', '/emu/x', '/Users/me', { XDG_CONFIG_HOME: '/cfg' })).toBe(join('/cfg', 'eden'))
    expect(expandDataPath('user/config', '/emu/x', '/Users/me', {})).toBe(join('/emu/x', 'user', 'config'))
  })

  it('creates the folders an emulator wants to find on first start', async () => {
    const exeDir = join(dir, 'eden-dirs')
    await ensureDirs(getStandaloneDef('eden')!, exeDir)
    expect(existsSync(join(exeDir, 'user', 'config'))).toBe(true)
  })
})

describe('app bundles', () => {
  it('finds the executable an Info.plist names, preferring a bundle named like the emulator', async () => {
    const root = join(dir, 'bundles')
    const app = (name: string, exe: string, plistExe?: string) => {
      mkdirSync(join(root, name, 'Contents', 'MacOS'), { recursive: true })
      writeFileSync(join(root, name, 'Contents', 'MacOS', exe), '')
      if (plistExe) writeFileSync(join(root, name, 'Contents', 'Info.plist'), `<plist><dict><key>CFBundleExecutable</key>\n<string>${plistExe}</string></dict></plist>`)
    }
    app('Helper.app', 'helper')
    app('PCSX2-v2.8.2.app', 'PCSX2', 'PCSX2')
    expect(await findAppExecutable(root, 'PCSX2')).toBe(join(root, 'PCSX2-v2.8.2.app', 'Contents', 'MacOS', 'PCSX2'))
    // No Info.plist: the only file in Contents/MacOS.
    expect(await findAppExecutable(root, 'Helper')).toBe(join(root, 'Helper.app', 'Contents', 'MacOS', 'helper'))
    expect(await findAppExecutable(join(dir, 'nothing-here'), 'x')).toBeUndefined()
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
    const registered = join(exeDir, 'user', 'nand', 'system', 'Contents', 'registered')
    expect(readFileSync(join(registered, 'abc.nca'), 'utf8')).toBe('n')
    expect(readFileSync(join(exeDir, 'user', 'keys', 'prod.keys'), 'utf8')).toBe('k')
    // Eden skips its first-run migration prompt when its config folder is there.
    expect(existsSync(join(exeDir, 'user', 'config'))).toBe(true)

    // A newer dump replaces the installed set, like Eden's own installer: it may sit in a sub folder, and NCAs
    // dumped as <id>.nca/00 folders count as files named after the folder.
    rmSync(join(bios, 'switch', 'firmware', 'abc.nca'))
    writeFileSync(join(registered, 'stale.nca'), 'old')
    const dump = join(bios, 'switch', 'firmware', 'Firmware 20.1.0')
    mkdirSync(join(dump, 'def.nca'), { recursive: true })
    writeFileSync(join(dump, 'def.nca', '00'), 'folder form')
    writeFileSync(join(dump, 'ghi.cnmt.nca'), 'meta')
    writeFileSync(join(dump, 'readme.txt'), 'not firmware')
    expect((await provisionStandalone(getStandaloneDef('eden')!, exeDir, bios)).ok).toBe(true)
    expect(readdirSync(registered).sort()).toEqual(['def.nca', 'ghi.cnmt.nca'])
    expect(readFileSync(join(registered, 'def.nca'), 'utf8')).toBe('folder form')
    // The same set again is left alone.
    writeFileSync(join(registered, 'def.nca'), 'kept')
    expect((await provisionStandalone(getStandaloneDef('eden')!, exeDir, bios)).ok).toBe(true)
    expect(readFileSync(join(registered, 'def.nca'), 'utf8')).toBe('kept')
  })
  it('turns on async shaders in Eden unless the player chose otherwise', async () => {
    const bios = join(dir, 'bios7')
    const exeDir = join(dir, 'eden-cfg')
    mkdirSync(join(bios, 'switch', 'firmware'), { recursive: true })
    writeFileSync(join(bios, 'prod.keys'), 'k')
    writeFileSync(join(bios, 'switch', 'firmware', 'abc.nca'), 'n')
    const ini = join(exeDir, 'user', 'config', 'qt-config.ini')
    // No config yet (first launch): written in Qt's key=value style, with the "touched" marker Eden looks at.
    expect((await provisionStandalone(getStandaloneDef('eden')!, exeDir, bios)).ok).toBe(true)
    let text = readFileSync(ini, 'utf8')
    expect(readIniValue(text, 'Renderer', 'use_asynchronous_shaders')).toBe('true')
    expect(readIniValue(text, 'Renderer', 'use_asynchronous_shaders\\default')).toBe('false')
    expect(text).toContain('use_asynchronous_shaders=true')
    // Eden's own untouched default is replaced too...
    writeFileSync(ini, '[Renderer]\nbackend\\default=true\nbackend=1\nuse_asynchronous_shaders\\default=true\nuse_asynchronous_shaders=false\n')
    await provisionStandalone(getStandaloneDef('eden')!, exeDir, bios)
    text = readFileSync(ini, 'utf8')
    expect(readIniValue(text, 'Renderer', 'use_asynchronous_shaders')).toBe('true')
    expect(readIniValue(text, 'Renderer', 'backend')).toBe('1')
    // ...but a value the player set in Eden stays.
    writeFileSync(ini, '[Renderer]\nuse_asynchronous_shaders\\default=false\nuse_asynchronous_shaders=false\n')
    await provisionStandalone(getStandaloneDef('eden')!, exeDir, bios)
    expect(readIniValue(readFileSync(ini, 'utf8'), 'Renderer', 'use_asynchronous_shaders')).toBe('false')
  })
})
