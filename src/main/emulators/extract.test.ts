import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { dirSize, extractArchive, extractorFor, findFile, moveMerge, parse7zProgress, removeExcept, sevenZipPath, singleTopFolder } from './extract'

const dir = mkdtempSync(join(tmpdir(), 'rd-extract-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('7za progress parsing', () => {
  it('takes the last percentage in a chunk', () => {
    expect(parse7zProgress('  0%\b\b\b\b  12% 3 - a.dll\b\b\b 47% 9 - b.dll')).toBe(0.47)
    expect(parse7zProgress('Everything is Ok')).toBeUndefined()
  })
  it('maps app.asar to app.asar.unpacked', () => {
    expect(sevenZipPath()).not.toMatch(/app\.asar[\\/]/)
  })
})

describe('macOS archives', () => {
  it('uses the system tools that keep bundle symlinks, and 7za for the rest', () => {
    expect(extractorFor('RetroArch-1.22.2.dmg', 'macos')).toBe('hdiutil')
    expect(extractorFor('azahar-macos-universal-2126.1.2.zip', 'macos')).toBe('ditto')
    expect(extractorFor('pcsx2-v2.8.2-macos-Qt.tar.xz', 'macos')).toBe('tar')
    expect(extractorFor('rpcs3_macos_aarch64.7z', 'macos')).toBe('7za')
    expect(extractorFor('RetroArch.7z', 'windows')).toBe('7za')
    expect(extractorFor('emu.zip', 'windows')).toBe('7za')
  })

  it('never flattens or merges into an app bundle', async () => {
    const out = join(dir, 'bundle-out')
    mkdirSync(join(out, 'Emu.app', 'Contents', 'MacOS'), { recursive: true })
    writeFileSync(join(out, 'Emu.app', 'Contents', 'MacOS', 'Emu'), 'new')
    expect(await singleTopFolder(out)).toBe(out)

    const install = join(dir, 'bundle-install')
    mkdirSync(join(install, 'Emu.app', 'Contents', 'Resources'), { recursive: true })
    writeFileSync(join(install, 'Emu.app', 'Contents', 'Resources', 'stale.dat'), 'old version only')
    mkdirSync(join(install, 'cores'), { recursive: true })
    writeFileSync(join(install, 'cores', 'a_libretro.dylib'), 'core')
    await moveMerge(out, install)
    expect(readFileSync(join(install, 'Emu.app', 'Contents', 'MacOS', 'Emu'), 'utf8')).toBe('new')
    expect(existsSync(join(install, 'Emu.app', 'Contents', 'Resources', 'stale.dat'))).toBe(false)
    expect(existsSync(join(install, 'cores', 'a_libretro.dylib'))).toBe(true)
  })
})

describe('extractArchive + install helpers', () => {
  it('extracts a 7z with a single top folder, flattens and merges', async () => {
    const src = join(dir, 'src', 'Emu-x64')
    mkdirSync(join(src, 'sub'), { recursive: true })
    writeFileSync(join(src, 'emu.exe'), 'new exe')
    writeFileSync(join(src, 'sub', 'data.bin'), 'data')
    const archive = join(dir, 'emu.7z')
    execFileSync(sevenZipPath(), ['a', '-bd', archive, join(dir, 'src', 'Emu-x64')], { windowsHide: true })

    const progress: number[] = []
    const out = join(dir, 'out')
    await extractArchive(archive, out, { onProgress: (f) => progress.push(f) })
    expect(progress.at(-1)).toBe(1)
    const root = await singleTopFolder(out)
    expect(root).toBe(join(out, 'Emu-x64'))

    const install = join(dir, 'install')
    mkdirSync(join(install, 'user'), { recursive: true })
    writeFileSync(join(install, 'user', 'save.dat'), 'keep me')
    writeFileSync(join(install, 'emu.exe'), 'old exe')
    await moveMerge(root, install)
    expect(readFileSync(join(install, 'emu.exe'), 'utf8')).toBe('new exe')
    expect(readFileSync(join(install, 'user', 'save.dat'), 'utf8')).toBe('keep me')
    expect(await findFile(install, 'DATA.BIN')).toBe(join(install, 'sub', 'data.bin'))
    expect(await dirSize(install)).toBe('new exe'.length + 'data'.length + 'keep me'.length)

    expect(await removeExcept(install, ['user'])).toBe(true)
    expect(existsSync(join(install, 'emu.exe'))).toBe(false)
    expect(existsSync(join(install, 'user', 'save.dat'))).toBe(true)
    expect(await removeExcept(install, [])).toBe(false)
    expect(existsSync(install)).toBe(false)
  })

  it('sizes a wide, deep tree', async () => {
    const root = join(dir, 'tree')
    let expected = 0
    for (let a = 0; a < 5; a++) {
      for (let b = 0; b < 5; b++) {
        const d = join(root, `a${a}`, `b${b}`)
        mkdirSync(d, { recursive: true })
        for (let f = 0; f < 10; f++) {
          writeFileSync(join(d, `f${f}.bin`), 'x'.repeat(a + b + f))
          expected += a + b + f
        }
      }
    }
    writeFileSync(join(root, 'top.txt'), 'top')
    expect(await dirSize(root)).toBe(expected + 3)
    expect(await dirSize(join(root, 'top.txt'))).toBe(3)
    expect(await dirSize(join(root, 'missing'))).toBe(0)
  })

  it('runs several extractions at once without losing any', async () => {
    const src = join(dir, 'many-src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'a.txt'), 'a')
    const archive = join(dir, 'many.7z')
    execFileSync(sevenZipPath(), ['a', '-bd', archive, join(src, 'a.txt')], { windowsHide: true })
    let queued = 0
    await Promise.all([0, 1, 2, 3].map((i) => extractArchive(archive, join(dir, `many-${i}`), { onQueued: () => queued++ })))
    expect(queued).toBe(2)
    for (const i of [0, 1, 2, 3]) expect(readFileSync(join(dir, `many-${i}`, 'a.txt'), 'utf8')).toBe('a')
  })

  it('rejects corrupt archives', async () => {
    const bad = join(dir, 'bad.7z')
    writeFileSync(bad, 'not an archive')
    await expect(extractArchive(bad, join(dir, 'bad-out'))).rejects.toThrow(/7-Zip failed/)
  })
})
