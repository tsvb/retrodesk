import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { dirSize, extractArchive, findFile, moveMerge, parse7zProgress, removeExcept, sevenZipPath, singleTopFolder } from './extract'

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

  it('rejects corrupt archives', async () => {
    const bad = join(dir, 'bad.7z')
    writeFileSync(bad, 'not an archive')
    await expect(extractArchive(bad, join(dir, 'bad-out'))).rejects.toThrow(/7-Zip failed/)
  })
})
