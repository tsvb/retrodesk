import { describe, expect, it } from 'vitest'
import { mediaUrl, pathFromMediaUrl } from './media'

describe('mediaUrl', () => {
  const file = 'C:\\Games\\art\\Zelda #1 (USA) 100%?.png'

  it('round-trips a path with characters that need escaping', () => {
    const url = mediaUrl(file)
    expect(url).toBe(`rdmedia://f/${encodeURIComponent(file)}`)
    expect(pathFromMediaUrl(url as string)).toBe(file)
  })

  it('adds an integer width hint that pathFromMediaUrl ignores', () => {
    const url = mediaUrl(file, { w: 399.6 }) as string
    expect(new URL(url).searchParams.get('w')).toBe('400')
    expect(pathFromMediaUrl(url)).toBe(file)
  })

  it('leaves the width off when it is missing or not positive', () => {
    expect(mediaUrl(file, {})).toBe(mediaUrl(file))
    expect(mediaUrl(file, { w: 0 })).toBe(mediaUrl(file))
    expect(mediaUrl(undefined, { w: 400 })).toBeUndefined()
  })
})
