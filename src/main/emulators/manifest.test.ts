import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'rd-manifest-'))
let emulators = join(root, 'a', 'emulators')

vi.mock('electron', () => ({ app: { getPath: () => root } }))
vi.mock('../paths', () => ({
  getPaths: () => ({ emulators, downloads: join(root, 'dl'), bios: join(root, 'bios') })
}))

import { getEntry, getInstalled, loadManifest, manifestPath, recordInstall, removeEntry, resetManifestCache, resolveExePath } from './manifest'

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('install manifest', () => {
  beforeEach(() => {
    emulators = join(root, 'a', 'emulators')
    mkdirSync(join(emulators, 'ppsspp'), { recursive: true })
    resetManifestCache()
  })

  it('records entries with exe paths relative to the emulators dir', () => {
    const exe = join(emulators, 'ppsspp', 'PPSSPPWindows64.exe')
    writeFileSync(exe, '')
    recordInstall({ id: 'ppsspp', version: '1.20.4', installedAt: 1, exePath: exe, sizeBytes: 42 })
    const raw = JSON.parse(readFileSync(manifestPath(), 'utf8'))
    expect(raw.version).toBe(1)
    expect(raw.emulators.ppsspp.exePath).toBe(join('ppsspp', 'PPSSPPWindows64.exe'))
    expect(getInstalled('ppsspp')?.absExePath).toBe(exe)
    expect(resolveExePath(getEntry('ppsspp')!)).toBe(exe)
  })

  it('reports not installed when the exe vanished, and survives a moved data root', () => {
    rmSync(join(emulators, 'ppsspp', 'PPSSPPWindows64.exe'), { force: true })
    expect(getEntry('ppsspp')).toBeDefined()
    expect(getInstalled('ppsspp')).toBeUndefined()
    writeFileSync(join(emulators, 'ppsspp', 'PPSSPPWindows64.exe'), '')

    // Move the whole data root: relative exe paths still resolve.
    const moved = join(root, 'b', 'emulators')
    mkdirSync(join(moved, 'ppsspp'), { recursive: true })
    writeFileSync(join(moved, 'ppsspp', 'PPSSPPWindows64.exe'), '')
    writeFileSync(join(moved, 'manifest.json'), readFileSync(manifestPath()))
    emulators = moved
    expect(getInstalled('ppsspp')?.absExePath).toBe(join(moved, 'ppsspp', 'PPSSPPWindows64.exe'))
  })

  it('removes entries and tolerates a corrupt file', () => {
    removeEntry('ppsspp')
    expect(getEntry('ppsspp')).toBeUndefined()
    writeFileSync(manifestPath(), '{ not json')
    resetManifestCache()
    expect(loadManifest().emulators).toEqual({})
  })
})
