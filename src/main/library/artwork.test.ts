import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Game } from '../../shared/types'
import { ArtworkMissCache, buildThumbIndex, fetchArtworkForGames, LibretroIndexCache, listingVersion, matchThumbnail, parseFbneoDat, parseListing, pickBest, thumbnailUrl } from './artwork'
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

  const SNES = 'Nintendo - Super Nintendo Entertainment System'
  const listings = (snaps: string): ((url: string) => Promise<string>) => async (url) => (url.includes('Named_Snaps') ? snaps : LISTING)

  it("downloads a game's images in parallel, snap and title following the boxart's match", async () => {
    const mediaDir = join(tmp, 'parallel', 'media')
    const index = new LibretroIndexCache(join(mediaDir, '_index'), listings(LISTING))
    const urls: string[] = []
    let active = 0
    let peak = 0
    const download = async (url: string, dest: string): Promise<boolean> => {
      urls.push(decodeURIComponent(url))
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      writeFile(dest, 'png')
      return true
    }
    const game = { id: 'g3', systemId: 'snes', path: 'C:\\roms\\Super Mario World.sfc', rawName: 'Super Mario World', title: 'Super Mario World', regions: [], tags: [], media: {} } as unknown as Game
    const res = await fetchArtworkForGames([game], { mediaDir, index, download, preferredRegion: 'Europe' })
    expect(res.downloaded).toBe(3)
    expect(peak).toBe(3)
    expect(urls.every((u) => u.endsWith('/Super Mario World (Europe) (Rev 1).png'))).toBe(true)
    expect(res.updates.get('g3')?.title).toBe(join(mediaDir, 'snes', 'title', 'Super Mario World.png'))
  })

  it('remembers artwork libretro does not have until the listing changes', async () => {
    const mediaDir = join(tmp, 'misses', 'media')
    const game = { id: 'g4', systemId: 'snes', path: 'C:\\roms\\Super Mario World (USA).sfc', rawName: 'Super Mario World (USA)', title: 'Super Mario World', regions: ['USA'], tags: [], media: {} } as unknown as Game
    const calls: string[] = []
    // Listed but every download is a 404 (or, for snaps, not listed at all).
    const download = async (url: string): Promise<boolean> => {
      calls.push(url)
      return false
    }
    const run = (snaps: string, force = false) => fetchArtworkForGames([game], { mediaDir, index: new LibretroIndexCache(join(mediaDir, '_index'), listings(snaps)), download, force })

    const first = await run('<a href="Other%20Game%20(USA).png">')
    expect(first.notFound).toBe(1)
    expect(calls).toHaveLength(2) // boxart + title; the snap had no match
    const saved = JSON.parse(readFileSync(join(mediaDir, '_index', 'misses.json'), 'utf8')) as Record<string, unknown>
    expect(Object.keys(saved)).toHaveLength(3)

    calls.length = 0
    await run('<a href="Other%20Game%20(USA).png">')
    expect(calls).toEqual([])
    // An explicit refresh searches again.
    await run('<a href="Other%20Game%20(USA).png">', true)
    expect(calls).toHaveLength(2)
    // So does a run after the listings were refreshed with new content (the cached ones are still within 24h here,
    // so drop them to simulate the refresh).
    calls.length = 0
    rmSync(join(mediaDir, '_index', `${SNES}.json`))
    await run('<a href="Super%20Mario%20World%20(USA).png">')
    expect(calls.filter((u) => u.includes('Named_Snaps'))).toHaveLength(1)
    expect(calls.filter((u) => !u.includes('Named_Snaps'))).toEqual([])
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

  it('stores the match keys and reuses them on the next run', async () => {
    const dir = join(tmp, '_index_keys')
    const folder = 'Nintendo - Super Nintendo Entertainment System'
    const fresh = await new LibretroIndexCache(dir, async () => LISTING).get(folder, 'boxart')
    const onDisk = JSON.parse(readFileSync(join(dir, `${folder}.json`), 'utf8')) as { v: number; keys: Record<string, string[]>; versions: Record<string, string> }
    expect(onDisk.v).toBe(2)
    expect(onDisk.keys['Named_Boxarts']).toEqual(fresh?.keys)
    expect(onDisk.versions['Named_Boxarts']).toBe(listingVersion(parseListing(LISTING)))
    // Cached keys are used as they are (not recomputed).
    onDisk.keys['Named_Boxarts'] = onDisk.keys['Named_Boxarts']!.map(() => 'samekey')
    writeFile(join(dir, `${folder}.json`), JSON.stringify(onDisk))
    const reread = await new LibretroIndexCache(dir, async () => '').get(folder, 'boxart')
    expect(reread?.byKey.get('samekey')).toHaveLength(10)
  })

  it('upgrades a cache written by an older version without going to the network', async () => {
    const dir = join(tmp, '_index_v1')
    const folder = 'Nintendo - Super Nintendo Entertainment System'
    writeFile(join(dir, `${folder}.json`), JSON.stringify({ fetchedAt: Date.now(), kinds: { Named_Boxarts: parseListing(LISTING), Named_Snaps: ['Super Mario World (USA)'] } }))
    const c = new LibretroIndexCache(dir, async () => {
      throw new Error('no network expected')
    })
    const idx = await c.get(folder, 'boxart')
    expect(idx?.byKey.get('supermarioworld')).toHaveLength(3)
    expect(c.errors).toEqual([])
    const onDisk = JSON.parse(readFileSync(join(dir, `${folder}.json`), 'utf8')) as { v: number; kinds: Record<string, string[]>; keys: Record<string, string[]> }
    expect(onDisk.v).toBe(2)
    expect(onDisk.keys['Named_Boxarts']).toHaveLength(10)
    // The other kind keeps its names and is upgraded when it is next used.
    expect(onDisk.kinds['Named_Snaps']).toEqual(['Super Mario World (USA)'])
    expect((await c.get(folder, 'snap'))?.names).toEqual(['Super Mario World (USA)'])
  })
})

describe('ArtworkMissCache', () => {
  it('expires entries when the listing version changes and persists across runs', async () => {
    const file = join(tmp, 'misses-unit', 'misses.json')
    const k = ArtworkMissCache.key('Sega - Saturn', 'boxart', ['Game (USA)'], 'Game')
    expect(ArtworkMissCache.key('Sega - Saturn', 'boxart', ['Game (USA)', 'Other'], 'Game')).not.toBe(k)
    const a = new ArtworkMissCache(file)
    a.add(k, 'v1')
    expect(a.has(k, 'v1')).toBe(true)
    expect(a.has(k, 'v2')).toBe(false)
    await a.save()
    const b = new ArtworkMissCache(file)
    await b.load()
    expect(b.has(k, 'v1')).toBe(true)
    b.delete(k)
    expect(b.has(k, 'v1')).toBe(false)
  })
})

describe('FBNeo DAT', () => {
  it('maps short names to descriptions', () => {
    const m = parseFbneoDat('<game name="mslug" romof="neogeo"><description>Metal Slug - Super Vehicle-001</description></game><game name="sf2"><description>Street Fighter II - The World Warrior (World 910522)</description></game><game name="x"><description>A &amp; B</description></game>')
    expect(m.get('mslug')).toBe('Metal Slug - Super Vehicle-001')
    expect(m.get('x')).toBe('A & B')
  })
})
