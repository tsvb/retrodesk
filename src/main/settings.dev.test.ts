import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

// A dev build (`npm run dev`) whose source folder is the clone at ~/retrodesk: on macOS and Windows the same
// folder as the default data folder ~/RetroDesk.
const source = join(homedir(), 'retrodesk')
vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), isPackaged: false, getAppPath: () => source }, BrowserWindow: { getAllWindows: () => [] } }))

import { conform, defaultSettings, isInsideDevSource } from './settings'

describe('dev source folder guard', () => {
  it('recognizes the source folder and what is inside it, whatever the case', () => {
    expect(isInsideDevSource(join(homedir(), 'RetroDesk'))).toBe(true)
    expect(isInsideDevSource(join(source, 'emulators'))).toBe(true)
    expect(isInsideDevSource(join(homedir(), 'RetroDesk Data'))).toBe(false)
    expect(isInsideDevSource(homedir())).toBe(false)
  })

  it('defaults the data folder to one beside the clone', () => {
    const env = process.env['RETRODESK_DATA_ROOT']
    delete process.env['RETRODESK_DATA_ROOT']
    try {
      expect(defaultSettings().dataRoot).toBe(join(homedir(), 'RetroDesk Data'))
    } finally {
      if (env !== undefined) process.env['RETRODESK_DATA_ROOT'] = env
    }
  })

  it('refuses a data folder inside the source folder', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(conform(defaultSettings(), { dataRoot: join(homedir(), 'RetroDesk') })).toEqual({})
    expect(conform(defaultSettings(), { dataRoot: join(source, 'data') })).toEqual({})
    expect(conform(defaultSettings(), { dataRoot: join(homedir(), 'Games', 'RetroDesk') })).toEqual({ dataRoot: join(homedir(), 'Games', 'RetroDesk') })
  })
})
