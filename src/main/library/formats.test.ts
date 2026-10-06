import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { referencedFiles } from './formats'
import { writeFile } from './testutil'

const tmp = mkdtempSync(join(tmpdir(), 'rd-formats-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('referencedFiles', () => {
  it('resolves references next to and below the entry file', async () => {
    const cue = join(tmp, 'game.cue')
    writeFile(cue, 'FILE "game (Track 1).bin" BINARY\nFILE "audio/track 2.bin" BINARY\n')
    expect(await referencedFiles(cue)).toEqual([join(tmp, 'game (Track 1).bin'), join(tmp, 'audio', 'track 2.bin')])
  })

  it('drops references that leave the entry file folder (absolute, UNC, parent)', async () => {
    const cue = join(tmp, 'evil.cue')
    // A drive path is only absolute on Windows; elsewhere the absolute path to try is a POSIX one.
    const absolute = process.platform === 'win32' ? 'C:\\Windows\\win.ini' : '/etc/passwd'
    writeFile(cue, ['FILE "\\\\203.0.113.5\\share\\t.bin" BINARY', `FILE "${absolute}" BINARY`, 'FILE "..\\outside.bin" BINARY', 'FILE "ok.bin" BINARY'].join('\n'))
    expect(await referencedFiles(cue)).toEqual([join(tmp, 'ok.bin')])

    const m3u = join(tmp, 'evil.m3u')
    writeFile(m3u, '//203.0.113.5/share/disc1.cue\ndisc2.cue\n')
    expect(await referencedFiles(m3u)).toEqual([join(tmp, 'disc2.cue')])
  })

  it('reads long entry files whole and skips huge ones', async () => {
    const m3u = join(tmp, 'long.m3u')
    const lines = Array.from({ length: 2000 }, (_, i) => `# padding line ${i} to get past the first read`)
    writeFile(m3u, `﻿first.cue\n${lines.join('\n')}\nlast.cue\n`)
    expect(await referencedFiles(m3u)).toEqual([join(tmp, 'first.cue'), join(tmp, 'last.cue')])

    const huge = join(tmp, 'huge.cue')
    writeFile(huge, `FILE "x.bin" BINARY\n${' '.repeat(1024 * 1024)}`)
    expect(await referencedFiles(huge)).toEqual([])
  })
})
