import { mkdtempSync, readdirSync, writeFileSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { FocusHelper } from './focus'

// Runs the real PowerShell helper (Windows only). This process has no window, so a focus request answers NOWINDOW.
describe.skipIf(process.platform !== 'win32')('FocusHelper', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rd-focus-'))
  const helpers: FocusHelper[] = []
  const helper = () => {
    const h = new FocusHelper({ cacheDir: () => dir })
    helpers.push(h)
    return h
  }
  afterAll(async () => {
    for (const h of helpers) h.stop()
    // The DLL stays locked until the helpers have exited (async, so their EXIT line actually gets written).
    await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 })
  })

  it('compiles the helper once, then loads the cached DLL', async () => {
    writeFileSync(join(dir, 'rdfocus-000000000000.dll'), 'stale')
    const a = helper()
    expect(await a.focus(process.pid, 15_000)).toBe('NOWINDOW')
    const dlls = readdirSync(dir).filter((f) => f.endsWith('.dll'))
    expect(dlls).toHaveLength(1)
    expect(dlls[0]).not.toBe('rdfocus-000000000000.dll')
    a.stop()
    expect(await helper().focus(process.pid, 15_000)).toBe('NOWINDOW')
  }, 40_000)

  it('does not hand a late reply to the next request', async () => {
    const h = helper()
    expect(await h.start()).toBe(true)
    // "-1" is not a valid pid: its (late) reply is an ERR line.
    expect(await h.focus(-1, 1)).toBe('TIMEOUT')
    expect(await h.focus(process.pid)).toBe('NOWINDOW')
  }, 40_000)

  it('keeps a newer helper when an old one exits', async () => {
    const h = helper()
    expect(await h.start()).toBe(true)
    h.stop()
    expect(await h.start()).toBe(true)
    const conn = (h as unknown as { conn: unknown }).conn
    // Give the old process time to exit; its exit must not drop (and so orphan) the new one.
    await new Promise((r) => setTimeout(r, 2000))
    expect((h as unknown as { conn: unknown }).conn).toBe(conn)
    expect(await h.focus(process.pid)).toBe('NOWINDOW')
  }, 40_000)
})
