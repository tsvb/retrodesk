import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { fileWrittenSince } from './confirm'

const dir = mkdtempSync(join(tmpdir(), 'rd-confirm-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('fileWrittenSince', () => {
  it('ignores files that were already there', async () => {
    const old = join(dir, 'old.state')
    writeFileSync(old, 'x')
    const hourAgo = (Date.now() - 3600_000) / 1000
    utimesSync(old, hourAgo, hourAgo)
    expect(await fileWrittenSince(dir, Date.now(), /\.state\d*$/, 250, 50)).toBe(false)
  })

  it('sees a file written after the command, including one that is overwritten', async () => {
    const since = Date.now()
    setTimeout(() => writeFileSync(join(dir, 'old.state'), 'y'), 120)
    expect(await fileWrittenSince(dir, since, /\.state\d*$/, 2000, 50)).toBe(true)
  })

  it('resolves as soon as a new file appears, not at the timeout', async () => {
    const since = Date.now()
    setTimeout(() => writeFileSync(join(dir, 'new.state3'), 'z'), 50)
    expect(await fileWrittenSince(dir, since, /\.state3$/, 5000, 50)).toBe(true)
    expect(Date.now() - since).toBeLessThan(2500)
  })

  it('sees a write that landed before it started looking', async () => {
    const since = Date.now()
    writeFileSync(join(dir, 'early.state5'), 'z')
    expect(await fileWrittenSince(dir, since, /\.state5$/, 1000, 50)).toBe(true)
  })

  it('only counts files matching the pattern', async () => {
    const since = Date.now()
    writeFileSync(join(dir, 'game.state1.png'), 'thumb')
    expect(await fileWrittenSince(dir, since, /\.state7$/, 200, 50)).toBe(false)
  })

  it('is false for a missing folder', async () => {
    expect(await fileWrittenSince(join(dir, 'nope'), Date.now(), /./, 100, 50)).toBe(false)
  })
})
