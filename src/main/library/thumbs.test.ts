import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { writeFile } from './testutil'
import { hasTransparency, thumbBucket, thumbKey, thumbWidth, ThumbCache } from './thumbs'

vi.mock('electron', () => ({ nativeImage: {} }))

const tmp = mkdtempSync(join(tmpdir(), 'rd-thumbs-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('thumb widths', () => {
  it('rounds up to a bucket; nonsense or wider than the largest bucket means the original', () => {
    expect(thumbBucket(1)).toBe(160)
    expect(thumbBucket(160)).toBe(160)
    expect(thumbBucket(170)).toBe(320)
    expect(thumbBucket(640)).toBe(640)
    expect(thumbBucket(641)).toBeUndefined()
    expect(thumbBucket(0)).toBeUndefined()
    expect(thumbBucket(-5)).toBeUndefined()
    expect(thumbBucket(Number.NaN)).toBeUndefined()
  })

  it('reads ?w= from media URLs', () => {
    const base = `rdmedia://f/${encodeURIComponent('C:\\Data\\media\\snes\\boxart\\Game (USA).png')}`
    expect(thumbWidth(`${base}?w=340`)).toBe(480)
    expect(thumbWidth(base)).toBeUndefined()
    for (const w of ['abc', '1e3', '-1', '12.5', '', '999999']) expect(thumbWidth(`${base}?w=${w}`), w).toBeUndefined()
    expect(thumbWidth('not a url')).toBeUndefined()
  })
})

describe('thumbKey', () => {
  it('changes with the file, not with path case', () => {
    const k = thumbKey('C:\\Data\\a.png', 100, 1000)
    expect(k).toMatch(/^[0-9a-f]{32}$/)
    expect(thumbKey('c:\\data\\A.PNG', 100, 1000)).toBe(k)
    expect(thumbKey('C:\\Data\\a.png', 101, 1000)).not.toBe(k)
    expect(thumbKey('C:\\Data\\a.png', 100, 1001)).not.toBe(k)
  })
})

describe('hasTransparency', () => {
  it('looks at every alpha byte', () => {
    expect(hasTransparency(Buffer.from([1, 2, 3, 255, 4, 5, 6, 255]))).toBe(false)
    expect(hasTransparency(Buffer.from([1, 2, 3, 255, 4, 5, 6, 254]))).toBe(true)
  })
})

describe('ThumbCache', () => {
  const thumbsDir = join(tmp, 'media', '.thumbs')
  const fakeEncoder = () => {
    const calls: string[] = []
    const encode = async (src: string, width: number) => {
      calls.push(`${src}@${width}`)
      const text = readFileSync(src, 'utf8')
      if (text === 'broken') throw new Error('cannot decode')
      if (text === 'small') return undefined
      return { data: Buffer.from(`${text}@${width}`), ext: text === 'alpha' ? ('png' as const) : ('jpg' as const) }
    }
    return { calls, encode }
  }

  it('makes a thumb once, shares concurrent requests and serves it from disk afterwards', async () => {
    const src = join(tmp, 'roms', 'a.png')
    writeFile(src, 'cover')
    const { calls, encode } = fakeEncoder()
    const cache = new ThumbCache(() => thumbsDir, encode)
    const [a, b] = await Promise.all([cache.file(src, 320), cache.file(src, 320)])
    expect(a).toBe(b)
    expect(a.startsWith(join(thumbsDir, '320'))).toBe(true)
    expect(a.endsWith('.jpg')).toBe(true)
    expect(readFileSync(a, 'utf8')).toBe('cover@320')
    expect(calls).toHaveLength(1)
    // A new instance (next app run) finds it on disk.
    const again = new ThumbCache(() => thumbsDir, encode)
    expect(await again.file(src, 320)).toBe(a)
    expect(calls).toHaveLength(1)
    // Written atomically: nothing but the thumb in the folder.
    expect(readdirSync(join(thumbsDir, '320')).every((f) => /^[0-9a-f]{32}\.(jpg|png)$/.test(f))).toBe(true)
  })

  it('makes a new thumb when the source changes', async () => {
    const src = join(tmp, 'roms', 'b.png')
    writeFile(src, 'v1')
    const { calls, encode } = fakeEncoder()
    const cache = new ThumbCache(() => thumbsDir, encode)
    const first = await cache.file(src, 160)
    writeFile(src, 'v2')
    utimesSync(src, new Date(), new Date(Date.now() + 5000))
    const second = await cache.file(src, 160)
    expect(second).not.toBe(first)
    expect(readFileSync(second, 'utf8')).toBe('v2@160')
    expect(calls).toHaveLength(2)
  })

  it('keeps transparent images as PNG', async () => {
    const src = join(tmp, 'roms', 'c.png')
    writeFile(src, 'alpha')
    const cache = new ThumbCache(() => thumbsDir, fakeEncoder().encode)
    expect((await cache.file(src, 480)).endsWith('.png')).toBe(true)
  })

  it('serves the original when it is small, undecodable or not an image format it handles, and remembers that', async () => {
    const small = join(tmp, 'roms', 'small.png')
    const broken = join(tmp, 'roms', 'broken.jpg')
    const webp = join(tmp, 'roms', 'd.webp')
    writeFile(small, 'small')
    writeFile(broken, 'broken')
    writeFile(webp, 'cover')
    const { calls, encode } = fakeEncoder()
    const cache = new ThumbCache(() => thumbsDir, encode)
    expect(await cache.file(small, 640)).toBe(small)
    expect(await cache.file(broken, 640)).toBe(broken)
    expect(await cache.file(webp, 640)).toBe(webp)
    expect(await cache.file(join(tmp, 'roms', 'missing.png'), 640)).toBe(join(tmp, 'roms', 'missing.png'))
    expect(calls).toHaveLength(2)
    await cache.file(small, 640)
    await cache.file(broken, 640)
    expect(calls).toHaveLength(2)
  })
})
