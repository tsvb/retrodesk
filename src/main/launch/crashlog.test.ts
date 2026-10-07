import { appendFileSync, mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { watchCrashLog } from './crashlog'

const tmp = mkdtempSync(join(tmpdir(), 'rd-crashlog-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('watchCrashLog', () => {
  it('ignores the previous run, then reports the first fatal line of the new log once', async () => {
    const file = join(tmp, 'eden_log.txt')
    writeFileSync(file, '[old] Debug.Emulated <Critical> Emulated program broke execution!\n')
    const old = new Date(Date.now() - 60_000)
    utimesSync(file, old, old)
    const since = Date.now()
    const hits: string[] = []
    const watch = watchCrashLog({ file, patterns: ['Emulated program broke execution', '<Critical>'], since, onMatch: (l) => hits.push(l), intervalMs: 20 })
    await tick(80)
    expect(hits).toEqual([])

    // The emulator rotates the log and starts a fresh one.
    renameSync(file, join(tmp, 'eden_log.txt.old.txt'))
    writeFileSync(file, '[0.1] Frontend <Info> starting\n[0.2] Service <Warning> stubbed\n')
    await tick(80)
    expect(hits).toEqual([])
    appendFileSync(file, '[3.5] Debug.Emulated <Critical> svc_exception.cpp:102:Break: Emulated program broke execution! reason=0xE401\n')
    appendFileSync(file, '[3.6] Core.ARM <Error> Backtrace\n[3.7] Debug <Critical> again\n')
    await tick(120)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toContain('reason=0xE401')
    expect(await watch.check()).toBe(true)
    watch.stop()
  })

  it('catches a fatal line written just before the emulator dies, when checked at exit', async () => {
    const file = join(tmp, 'sudden.txt')
    const hits: string[] = []
    // A long interval stands in for the poll that never comes because the process is already gone.
    const watch = watchCrashLog({ file, patterns: ['<Critical>'], since: 0, onMatch: (l) => hits.push(l), intervalMs: 60_000 })
    writeFileSync(file, '[1.0] boot\n[3.2] Debug <Critical> assert !is_executing\n')
    expect(await watch.check()).toBe(true)
    expect(hits).toEqual(['[3.2] Debug <Critical> assert !is_executing'])
    watch.stop()
    expect(await watch.check()).toBe(true)
  })

  it('stops when told to', async () => {
    const file = join(tmp, 'quiet.txt')
    const hits: string[] = []
    const watch = watchCrashLog({ file, patterns: ['<Critical>'], since: 0, onMatch: (l) => hits.push(l), intervalMs: 20 })
    watch.stop()
    writeFileSync(file, 'x <Critical> y\n')
    await tick(80)
    expect(hits).toEqual([])
    expect(await watch.check()).toBe(false)
  })
})
