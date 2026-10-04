/** Human-friendly play time: "Not played yet", "12 min", "4 h 12 min", "312 h". */
export function formatPlayTime(sec: number): string {
  if (!sec || sec < 60) return sec > 0 ? 'Under a minute' : 'Not played yet'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h >= 100 || m === 0) return `${h} h`
  return `${h} h ${m} min`
}

/** Clock-style duration for a running session: 4:05 or 1:04:05. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

// Only the en-US Chromium locale ships, so `undefined` would mean en-US for everyone: dates, clock and numbers use
// the OS regional format instead (setLocale at boot).
let locale: string | undefined
let rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

export function setLocale(l: string | undefined): void {
  try {
    rtf = new Intl.RelativeTimeFormat(l, { numeric: 'auto' })
    locale = l
  } catch {
    /* not a valid locale tag: keep the default */
  }
}

export function formatNumber(n: number): string {
  return n.toLocaleString(locale)
}

/** "Just now", "5 minutes ago", "yesterday", "3 weeks ago", or a date for older times. */
export function formatRelative(ts: number | undefined, now = Date.now()): string {
  if (!ts) return 'Never'
  const diff = (ts - now) / 1000
  const abs = Math.abs(diff)
  if (abs < 60) return 'Just now'
  if (abs < 3600) return capitalise(rtf.format(Math.round(diff / 60), 'minute'))
  if (abs < 86400) return capitalise(rtf.format(Math.round(diff / 3600), 'hour'))
  if (abs < 86400 * 7) return capitalise(rtf.format(Math.round(diff / 86400), 'day'))
  if (abs < 86400 * 35) return capitalise(rtf.format(Math.round(diff / (86400 * 7)), 'week'))
  return new Date(ts).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return '–'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

export function formatClock(d: Date): string {
  return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

export function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`
}

/** First letter used for alphabet jumping; digits and symbols collapse into "#". */
export function letterOf(title: string): string {
  const c = title.trim().charAt(0).toUpperCase()
  return c >= 'A' && c <= 'Z' ? c : '#'
}
