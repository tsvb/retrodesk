import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Game } from '../../shared/types'
import { buildThumbIndex, fetchArtworkForGames, LibretroIndexCache, matchThumbnail, parseFbneoDat, parseListing, pickBest, thumbnailUrl } from './artwork'
import { writeFile } from './testutil'

const tmp = mkdtempSync(join(tmpdir(), 'rd-art-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('fetchArtworkForGames', () => {
  it('brings artwork left under a previous data folder into the media folder without downloading', async () => {
    const old = join(tmp, 'old-data', 'media', 'snes')
    const mediaDir = join(tmp, 'new-data', 'media')
    const media = {
      boxart: join(old, 'boxart', 'Game (USA).png'),
      snap: join(old, 'snap', 'Game (USA).png'),
      title: join(old, 'title', 'Game (USA).jpg')
    }
    for (const [kind, p] of Object.entries(media)) writeFile(p, kind)
    const game = { id: 'g1', systemId: 'snes', path: 'C:\\roms\\snes\\Game (USA).sfc', rawName: 'Game (USA)', title: 'Game', media } as Game

    const res = await fetchArtworkForGames([game], { mediaDir, isServable: (p) => p.startsWith(mediaDir) })

    expect(res.downloaded).toBe(0)
    expect(res.errors).toEqual([])
    const moved = res.updates.get('g1')
    expect(moved).toEqual({
      boxart: join(mediaDir, 'snes', 'boxart', 'Game (USA).png'),
      snap: join(mediaDir, 'snes', 'snap', 'Game (USA).png'),
      title: join(mediaDir, 'snes', 'title', 'Game (USA).jpg')
    })
    expect(readFileSync(moved!.title!, 'utf8')).toBe('title')
  })

  it('leaves servable artwork alone', async () => {
    const mediaDir = join(tmp, 'kept', 'media')
    const media = {
      boxart: join(mediaDir, 'snes', 'boxart', 'Kept (USA).png'),
      snap: join(mediaDir, 'snes', 'snap', 'Kept (USA).png'),
      title: join(mediaDir, 'snes', 'title', 'Kept (USA).png')
    }
    for (const p of Object.values(media)) writeFile(p, 'img')
    const game = { id: 'g2', systemId: 'snes', path: 'C:\\roms\\snes\\Kept (USA).sfc', rawName: 'Kept (USA)', title: 'Kept', media } as Game
    const res = await fetchArtworkForGames([game], { mediaDir, isServable: () => true })
    expect(res.updates.size).toBe(0)
    expect(res.downloaded).toBe(0)
  })
})

const LISTING = `<tr><td><a href="/Nintendo%20-%20Super%20Nintendo%20Entertainment%20System/">Parent Directory</a></td></tr>
<tr><td><a href="?C=N;O=D">Name</a></td></tr>
<tr><td><a href="Legend%20of%20Zelda%2C%20The%20-%20A%20Link%20to%20the%20Past%20(USA).png">x</a></td></tr>
<tr><td><a href="Legend%20of%20Zelda%2C%20The%20-%20A%20Link%20to%20the%20Past%20(Europe).png">x</a></td></tr>
<tr><td><a href="Zelda%20no%20Densetsu%20-%20Kamigami%20no%20Triforce%20(Japan).png">x</a></td></tr>
<tr><td><a href="Super%20Mario%20World%20(USA).png">x</a></td></tr>
<tr><td><a href="Super%20Mario%20World%20(Europe)%20(Rev%201).png">x</a></td></tr>
<tr><td><a href="Super%20Mario%20World%20(USA)%20(Beta).png">x</a></td></tr>
<tr><td><a href="Advanced%20Dungeons%20_%20Dragons%20-%20Eye%20of%20the%20Beholder%20(USA).png">x</a></td></tr>
<tr><td><a href="Final%20Fantasy%20VII%20(USA)%20(Disc%201).png">x</a></td></tr>
<tr><td><a href="Final%20Fantasy%20VII%20(USA)%20(Disc%202).png">x</a></td></tr>
<tr><td><a href="Final%20Fantasy%20VII%20(Japan)%20(Disc%201).png">x</a></td></tr>`

describe('libretro listing + matching', () => {
  const names = parseListing(LISTING)
  const idx = buildThumbIndex(names)
  const g = (regions: string[] = [], tags: string[] = [], title = '') => ({ regions, tags, title })

  it('parses hrefs', () => {
    expect(names).toHaveLength(10)
    expect(names[0]).toBe('Legend of Zelda, The - A Link to the Past (USA)')
  })

  it('exact match, including [!] and substituted characters', () => {
    expect(matchThumbnail(idx, ['Super Mario World (USA)'], g(['USA']))).toBe('Super Mario World (USA)')
    expect(matchThumbnail(idx, ['Super Mario World (USA) [!]'], g(['USA']))).toBe('Super Mario World (USA)')
    expect(matchThumbnail(idx, ['Advanced Dungeons & Dragons - Eye of the Beholder (USA)'], g(['USA']))).toBe('Advanced Dungeons _ Dragons - Eye of the Beholder (USA)')
  })

  it('fuzzy match prefers own region, then preferred region, and avoids betas', () => {
    expect(matchThumbnail(idx, ['Super Mario World (USA) (Rev 2)'], g(['USA'], ['Rev 2']))).toBe('Super Mario World (USA)')
    expect(matchThumbnail(idx, ['Super Mario World'], g(), 'Europe')).toBe('Super Mario World (Europe) (Rev 1)')
    expect(matchThumbnail(idx, ['super mario world'], g(), 'USA')).toBe('Super Mario World (USA)')
    expect(matchThumbnail(idx, ['The Legend of Zelda - A Link to the Past'], g())).toBe('Legend of Zelda, The - A Link to the Past (USA)')
    expect(matchThumbnail(idx, ['Legend of Zelda, The - A Link to the Past (France)'], g(['France']), 'Europe')).toBe('Legend of Zelda, The - A Link to the Past (Europe)')
    expect(matchThumbnail(idx, ['Unknown Game (USA)'], g(['USA']))).toBeUndefined()
  })

  it('multi-disc: m3u matches disc 1, discs match themselves', () => {
    expect(matchThumbnail(idx, ['Final Fantasy VII (USA)'], g(['USA']))).toBe('Final Fantasy VII (USA) (Disc 1)')
    expect(pickBest(['Final Fantasy VII (USA) (Disc 1)', 'Final Fantasy VII (USA) (Disc 2)'], { regions: ['USA'], tags: ['Disc 2'] })).toBe('Final Fantasy VII (USA) (Disc 2)')
  })

  it('falls back to the display title (e.g. PS3 PARAM.SFO title)', () => {
    expect(matchThumbnail(idx, ['BLUS99999'], g([], [], 'Super Mario World'))).toBe('Super Mario World (USA)')
  })

  it('builds encoded URLs', () => {
    expect(thumbnailUrl('Nintendo - Super Nintendo Entertainment System', 'boxart', 'Super Mario World (USA)')).toBe(
      'https://thumbnails.libretro.com/Nintendo%20-%20Super%20Nintendo%20Entertainment%20System/Named_Boxarts/Super%20Mario%20World%20(USA).png'
    )
  })
})

describe('LibretroIndexCache', () => {
  it('caches listings on disk per folder and kind', async () => {
    let calls = 0
    const fetcher = async (url: string): Promise<string> => {
      calls++
      return url.includes('Named_Boxarts') ? LISTING : '<a href="Super%20Mario%20World%20(USA).png">'
    }
    const dir = join(tmp, '_index')
    const c1 = new LibretroIndexCache(dir, fetcher)
    expect((await c1.get('Nintendo - Super Nintendo Entertainment System', 'boxart'))?.names).toHaveLength(10)
    expect((await c1.get('Nintendo - Super Nintendo Entertainment System', 'snap'))?.names).toHaveLength(1)
    await c1.get('Nintendo - Super Nintendo Entertainment System', 'boxart')
    expect(calls).toBe(2)
    const onDisk = JSON.parse(readFileSync(join(dir, 'Nintendo - Super Nintendo Entertainment System.json'), 'utf8')) as { kinds: Record<string, string[]> }
    expect(Object.keys(onDisk.kinds).sort()).toEqual(['Named_Boxarts', 'Named_Snaps'])
    // A new cache instance (next app run) reads from disk.
    const c2 = new LibretroIndexCache(dir, async () => {
      throw new Error('offline')
    })
    expect((await c2.get('Nintendo - Super Nintendo Entertainment System', 'boxart'))?.names).toHaveLength(10)
    expect(await c2.get('Sega - Saturn', 'boxart')).toBeUndefined()
    expect(c2.errors[0]).toMatch(/offline/)
  })
})

describe('FBNeo DAT', () => {
  it('maps short names to descriptions', () => {
    const m = parseFbneoDat('<game name="mslug" romof="neogeo"><description>Metal Slug - Super Vehicle-001</description></game><game name="sf2"><description>Street Fighter II - The World Warrior (World 910522)</description></game><game name="x"><description>A &amp; B</description></game>')
    expect(m.get('mslug')).toBe('Metal Slug - Super Vehicle-001')
    expect(m.get('x')).toBe('A & B')
  })
})
