import { describe, expect, it } from 'vitest'
import { isExcludedSteamApp, parseAppManifest, steamGamePath, appIdFromPath } from './steam'
import { getObject, getString, parseVdf } from './vdf'

const LIBRARY_FOLDERS = `"libraryfolders"
{
	"0"
	{
		"path"		"C:\\\\Program Files (x86)\\\\Steam"
		"label"		""
		"apps"
		{
			"730"		"73984302411"
			"228980"		"132143724"
		}
	}
	"1"
	{
		"path"		"D:\\\\SteamLibrary"
	}
}`

describe('vdf', () => {
  it('parses nested objects and escaped paths', () => {
    const v = parseVdf(LIBRARY_FOLDERS)
    const root = getObject(v, 'libraryfolders')
    expect(getString(getObject(root, '0'), 'path')).toBe('C:\\Program Files (x86)\\Steam')
    expect(getString(getObject(root, '1'), 'path')).toBe('D:\\SteamLibrary')
    expect(getString(getObject(getObject(root, '0'), 'apps'), '730')).toBe('73984302411')
  })

  it('handles comments, unquoted tokens, conditionals and odd case', () => {
    const v = parseVdf(`// comment\nRoot { key value [$WIN32] "q" "a \\"quoted\\" word" Sub { x 1 } }`)
    const root = getObject(v, 'root')
    expect(getString(root, 'KEY')).toBe('value')
    expect(getString(root, 'q')).toBe('a "quoted" word')
    expect(getString(getObject(root, 'sub'), 'x')).toBe('1')
  })

  it('survives truncated input', () => {
    expect(() => parseVdf('"a" { "b" { "c"')).not.toThrow()
  })
})

describe('steam manifests', () => {
  const acf = (id: string, name: string, flags = '4') =>
    `"AppState"\n{\n\t"appid"\t\t"${id}"\n\t"name"\t\t"${name}"\n\t"StateFlags"\t\t"${flags}"\n\t"installdir"\t\t"${name}"\n\t"SizeOnDisk"\t\t"1150526746"\n\t"LastPlayed"\t\t"1789244910"\n}`

  it('reads installed apps', () => {
    expect(parseAppManifest(acf('945360', 'Among Us'), 'C:\\Steam')).toMatchObject({ appid: '945360', name: 'Among Us', sizeOnDisk: 1150526746, installDir: 'Among Us', lastPlayed: 1789244910 })
    expect(parseAppManifest(acf('1', 'Downloading', '1026'), 'C:\\Steam')).toBeUndefined()
    expect(parseAppManifest(acf('2', 'Updating', '6'), 'C:\\Steam')).toBeDefined()
  })

  it('excludes tools and redistributables', () => {
    expect(isExcludedSteamApp('228980', 'Steamworks Common Redistributables')).toBe(true)
    expect(isExcludedSteamApp('250820', 'SteamVR')).toBe(true)
    expect(isExcludedSteamApp('1493710', 'Proton Experimental')).toBe(true)
    expect(isExcludedSteamApp('1', 'Some Game Soundtrack')).toBe(true)
    expect(isExcludedSteamApp('2', 'Some Game Dedicated Server')).toBe(true)
    expect(isExcludedSteamApp('3', 'Source SDK Base 2013')).toBe(true)
    expect(isExcludedSteamApp('730', 'Counter-Strike 2')).toBe(false)
    expect(isExcludedSteamApp('4', 'Hollow Knight')).toBe(false)
  })

  it('path round-trip', () => {
    expect(appIdFromPath(steamGamePath('730'))).toBe('730')
    expect(appIdFromPath('C:\\roms\\x.sfc')).toBeUndefined()
  })
})
