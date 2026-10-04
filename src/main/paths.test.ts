import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ settings: { dataRoot: '', romFolders: [] as { path: string }[] } }))
vi.mock('./settings', () => ({ getSettings: () => h.settings }))

import { getPaths, invalidatePaths, isManagedPath, managedPathPredicate } from './paths'

const tmp = mkdtempSync(join(tmpdir(), 'rd-paths-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
afterEach(() => {
  vi.useRealTimers()
  invalidatePaths()
})

describe('getPaths', () => {
  it('creates the data folders once and reuses them', () => {
    h.settings.dataRoot = join(tmp, 'a')
    const p = getPaths()
    expect(existsSync(p.saves)).toBe(true)
    rmSync(p.saves, { recursive: true })
    expect(getPaths()).toBe(p)
    expect(existsSync(p.saves)).toBe(false) // not re-made on every call
  })

  it('follows a data root change', () => {
    h.settings.dataRoot = join(tmp, 'b')
    const a = getPaths()
    h.settings.dataRoot = join(tmp, 'c')
    const b = getPaths()
    expect(b.roms).toBe(join(tmp, 'c', 'roms'))
    expect(existsSync(b.media)).toBe(true)
    expect(a.roms).toBe(join(tmp, 'b', 'roms'))
  })

  it('makes deleted folders again after a while', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    h.settings.dataRoot = join(tmp, 'd')
    const p = getPaths()
    rmSync(p.states, { recursive: true })
    vi.setSystemTime(Date.now() + 60_000)
    getPaths()
    expect(existsSync(p.states)).toBe(true)
  })

  it('does not remember a data root that could not be created', () => {
    h.settings.dataRoot = join(tmp, 'e')
    getPaths()
    h.settings.dataRoot = join(tmp, 'e', 'x\0bad') // mkdir rejects it, as it would an unplugged drive
    expect(() => getPaths()).toThrow()
    expect(() => getPaths()).toThrow()
  })
})

describe('managedPathPredicate', () => {
  it('matches the data root and ROM folders like isManagedPath', () => {
    h.settings.dataRoot = 'C:\\RetroDesk'
    h.settings.romFolders = [{ path: 'D:\\Games\\ROMs\\' }, { path: '' }]
    const servable = managedPathPredicate()
    const cases = [
      'C:\\RetroDesk\\media\\snes\\boxart\\a.png',
      'c:\\retrodesk',
      'D:\\Games\\ROMs\\snes\\b.sfc',
      'C:\\RetroDeskOther\\a.png',
      'E:\\elsewhere\\a.png',
      'relative\\a.png'
    ]
    expect(cases.map(servable)).toEqual([true, true, true, false, false, false])
    expect(cases.map(isManagedPath)).toEqual(cases.map(servable))
    h.settings.romFolders = []
  })
})
