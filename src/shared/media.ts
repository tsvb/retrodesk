/** Custom protocol used to serve local image/video files (artwork, screenshots) to the renderer. */
export const MEDIA_SCHEME = 'rdmedia'

/** Build a renderer-loadable URL for an absolute local file path. */
export function mediaUrl(absPath: string | undefined | null): string | undefined {
  if (!absPath) return undefined
  return `${MEDIA_SCHEME}://f/${encodeURIComponent(absPath)}`
}

export function pathFromMediaUrl(url: string): string {
  const u = new URL(url)
  return decodeURIComponent(u.pathname.replace(/^\//, ''))
}
