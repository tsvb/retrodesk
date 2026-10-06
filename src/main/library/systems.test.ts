import { describe, expect, it } from 'vitest'
import { getSystemDef, getSystemDefs, matchFolderToSystem, normalizeFolderName, systemsForExtension, uniqueSystemForExtension } from '../systems'

describe('systems catalog', () => {
  const defs = getSystemDefs()

  it('has well-formed entries', () => {
    expect(defs.length).toBeGreaterThanOrEqual(41)
    const ids = new Set<string>()
    for (const s of defs) {
      expect(ids.has(s.id)).toBe(false)
      ids.add(s.id)
      expect(s.shortName).toBeTruthy()
      expect(s.color).toMatch(/^#[0-9a-f]{6}$/i)
      for (const e of s.extensions) expect(e).toMatch(/^\.[a-z0-9]+$/)
      for (const a of s.folderAliases ?? []) expect(a).toBe(a.toLowerCase())
      for (const b of s.bios) {
        expect(typeof b.md5).toBe('string')
        if (b.md5) expect(b.md5).toMatch(/^[0-9a-f]{32}$/)
      }
      for (const e of s.emulators) expect(['retroarch', 'standalone']).toContain(e.type)
    }
    expect(getSystemDef('steam')).toMatchObject({ name: 'PC Games (Steam)', extensions: [], emulators: [] })
  })

  it('no alias maps to two systems', () => {
    const owner = new Map<string, string>()
    for (const s of defs) {
      for (const a of [s.id, ...(s.folderAliases ?? [])]) {
        const k = normalizeFolderName(a)
        const prev = owner.get(k)
        if (prev && prev !== s.id) throw new Error(`alias "${a}" claimed by ${prev} and ${s.id}`)
        owner.set(k, s.id)
      }
    }
  })

  it('matches common frontend folder names', () => {
    const cases: Record<string, string> = {
      snes: 'snes',
      SFC: 'snes',
      'Super Nintendo Entertainment System': 'snes',
      'Nintendo - Super Nintendo Entertainment System': 'snes',
      megadrive: 'genesis',
      'Sega Genesis': 'genesis',
      PSX: 'psx',
      'Sony - PlayStation': 'psx',
      'Sony Playstation 2': 'ps2',
      gamecube: 'gc',
      'Nintendo GameCube': 'gc',
      n3ds: '3ds',
      psvita: 'vita',
      tg16: 'pce',
      'tg-cd': 'pcecd',
      fbneo: 'arcade',
      mame: 'arcade',
      neogeo: 'neogeo',
      'wii u': 'wiiu',
      wonderswancolor: 'wsc',
      atarilynx: 'lynx',
      colecovision: 'coleco',
      msx2: 'msx',
      'Game Boy Advance': 'gba',
      mastersystem: 'sms',
      sega32x: '32x',
      segacd: 'segacd',
      'Nintendo DS': 'nds',
      'NEC - PC Engine - TurboGrafx 16': 'pce'
    }
    for (const [folder, id] of Object.entries(cases)) expect(matchFolderToSystem(folder)?.id, folder).toBe(id)
    expect(matchFolderToSystem('My Stuff')).toBeUndefined()
  })

  it('extension helpers', () => {
    expect(uniqueSystemForExtension('.sfc')?.id).toBe('snes')
    expect(uniqueSystemForExtension('.GBA')?.id).toBe('gba')
    expect(uniqueSystemForExtension('.gdi')?.id).toBe('dreamcast')
    expect(uniqueSystemForExtension('.zip')).toBeUndefined()
    expect(uniqueSystemForExtension('.iso')).toBeUndefined()
    expect(uniqueSystemForExtension('.md')).toBeUndefined() // Markdown!
    expect(systemsForExtension('.cue').map((s) => s.id)).toContain('psx')
  })
})
