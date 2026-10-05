import { createHash } from 'crypto'
import { nativeImage } from 'electron'
import { mkdir, rename, rm, stat, writeFile } from 'fs/promises'
import { dirname, extname, join } from 'path'
import { createLimiter } from './limiter'
import { normPath } from './util'

/**
 * Downscaled cover images for the grid. rdmedia://f/<path>?w=<px> is served from <media>/.thumbs/<width>/<key>.jpg
 * (.png when the image has transparency), made on first request. The key hashes the source's path, size and
 * mtime, so a re-downloaded or edited image simply gets a new thumb: the old one is orphaned rather than deleted
 * (a few KB each; the whole folder can be removed at any time and is rebuilt as covers are shown).
 *
 * Electron's decoder is synchronous on the main thread (about 5-25 ms per cover; createThumbnailFromPath is no
 * better on Windows, it blocks too and is slower), so thumbs are made one at a time, yielding in between so other
 * requests and IPC keep flowing. That cost is paid once per cover and width.
 */

/** Widths thumbs are made at. A request is rounded up to one of these; wider than the last gets the original. */
export const THUMB_WIDTHS = [160, 320, 480, 640] as const
/** Formats nativeImage decodes (it cannot read webp/bmp; those are served as they are). */
const THUMBABLE = new Set(['.png', '.jpg', '.jpeg'])
const JPEG_QUALITY = 85
/** Remembered "serve the original" decisions per session, before the memo is reset. */
const MAX_ORIGINALS = 20_000

/** The thumb width for a requested width, or undefined for nonsense / wider than the largest bucket. */
export function thumbBucket(requested: number): number | undefined {
  if (!Number.isFinite(requested) || requested <= 0) return undefined
  return THUMB_WIDTHS.find((w) => w >= requested)
}

/** Thumb width asked for by an rdmedia:// URL (`?w=`), if any. */
export function thumbWidth(url: string): number | undefined {
  let raw: string | null
  try {
    raw = new URL(url).searchParams.get('w')
  } catch {
    return undefined
  }
  return raw && /^\d{1,5}$/.test(raw) ? thumbBucket(Number(raw)) : undefined
}

export function isThumbable(p: string): boolean {
  return THUMBABLE.has(extname(p).toLowerCase())
}

/** Cache file name for one version of a source image (changes when the file does). */
export function thumbKey(p: string, size: number, mtimeMs: number): string {
  return createHash('sha1')
    .update(`${normPath(p)}|${size}|${mtimeMs}`)
    .digest('hex')
    .slice(0, 32)
}

/** True when any pixel of a 32-bit bitmap (BGRA or RGBA: alpha is the 4th byte either way) is not opaque. */
export function hasTransparency(bitmap: Buffer): boolean {
  for (let i = 3; i < bitmap.length; i += 4) if ((bitmap[i] as number) < 255) return true
  return false
}

export interface EncodedThumb {
  data: Buffer
  ext: 'jpg' | 'png'
}

/** Downscale `src` to `width` px wide. Undefined when it is not wider than that (never upscale). Throws on failure. */
export type ThumbEncoder = (src: string, width: number) => Promise<EncodedThumb | undefined>

/**
 * JPEG keeps cover thumbs small and quick to decode; box art is opaque. Some PNG covers do have transparent edges
 * (3D box renders), which JPEG would turn black, so those stay PNG.
 */
export const nativeImageEncoder: ThumbEncoder = async (src, width) => {
  const img = nativeImage.createFromPath(src)
  if (img.isEmpty()) throw new Error(`Cannot decode ${src}`)
  if (img.getSize().width <= width) return undefined
  const small = img.resize({ width, quality: 'good' })
  if (extname(src).toLowerCase() === '.png' && hasTransparency(small.toBitmap())) return { data: small.toPNG(), ext: 'png' }
  return { data: small.toJPEG(JPEG_QUALITY), ext: 'jpg' }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile()
  } catch {
    return false
  }
}

export class ThumbCache {
  /** Thumbs being made, so concurrent requests for the same one share the work. */
  private pending = new Map<string, Promise<string | undefined>>()
  /** Sources served as they are at a width (narrower than it, or undecodable), so they are not decoded again. */
  private originals = new Set<string>()
  private limit = createLimiter(1)

  constructor(
    /** <media>/.thumbs for the current data root. */
    private readonly dir: () => string,
    private readonly encode: ThumbEncoder = nativeImageEncoder
  ) {}

  /** The file to serve for `src` at `width`: its cached thumb (made now if needed) or, on any problem, `src` itself. */
  async file(src: string, width: number): Promise<string> {
    if (!isThumbable(src)) return src
    try {
      const st = await stat(src)
      if (!st.isFile()) return src
      const key = thumbKey(src, st.size, st.mtimeMs)
      const id = `${width}/${key}`
      if (this.originals.has(id)) return src
      const base = join(this.dir(), String(width), key)
      for (const ext of ['jpg', 'png']) if (await isFile(`${base}.${ext}`)) return `${base}.${ext}`
      let job = this.pending.get(id)
      if (!job) {
        job = this.limit(() => this.make(src, width, base)).finally(() => this.pending.delete(id))
        this.pending.set(id, job)
      }
      const made = await job.catch(() => undefined)
      if (!made) this.remember(id)
      return made ?? src
    } catch {
      return src
    }
  }

  private remember(id: string): void {
    if (this.originals.size >= MAX_ORIGINALS) this.originals.clear()
    this.originals.add(id)
  }

  private async make(src: string, width: number, base: string): Promise<string | undefined> {
    // Let queued requests (cache hits, IPC) run before this blocks the main thread for a decode.
    await new Promise((r) => setImmediate(r))
    const thumb = await this.encode(src, width)
    if (!thumb) return undefined
    const dest = `${base}.${thumb.ext}`
    await mkdir(dirname(dest), { recursive: true })
    const tmp = `${dest}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    try {
      await writeFile(tmp, thumb.data)
      await rename(tmp, dest)
    } catch (e) {
      await rm(tmp, { force: true }).catch(() => undefined)
      throw e
    }
    return dest
  }
}
