/** Custom protocol used to serve local image/video files (artwork, screenshots) to the renderer. */
export const MEDIA_SCHEME = 'rdmedia'

export interface MediaUrlOptions {
  /**
   * Ask for a downscaled copy no wider than this many pixels (grid tiles, blurred backdrops). The main process
   * serves a cached thumbnail, or the original when it can't make one.
   */
  w?: number
}

/** Build a renderer-loadable URL for an absolute local file path. */
export function mediaUrl(absPath: string | undefined | null, opts?: MediaUrlOptions): string | undefined {
  if (!absPath) return undefined
  const url = `${MEDIA_SCHEME}://f/${encodeURIComponent(absPath)}`
  const w = opts?.w !== undefined ? Math.round(opts.w) : 0
  return w > 0 ? `${url}?w=${w}` : url
}

/** The file path inside a media URL. Any query (such as `?w=`) is not part of it. */
export function pathFromMediaUrl(url: string): string {
  const u = new URL(url)
  return decodeURIComponent(u.pathname.replace(/^\//, ''))
}
