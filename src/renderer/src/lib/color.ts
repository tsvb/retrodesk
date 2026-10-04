/** Small colour helpers used for generated covers, system cards and the ambient background. */

export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100
  const lig = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = sat * Math.min(lig, 1 - lig)
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const to = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim()
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  const n = parseInt(h.slice(0, 6), 16)
  if (Number.isNaN(n)) return [124, 92, 255]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(r: number, g: number, b: number): string {
  const to = (x: number) =>
    Math.max(0, Math.min(255, Math.round(x)))
      .toString(16)
      .padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

/** Linear mix of two hex colours; t=0 -> a, t=1 -> b. */
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t)
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Deterministic colour for anything that has an id but no explicit colour. */
export function colorFromId(id: string): string {
  const h = hashString(id)
  return hslToHex(h % 360, 58 + (h % 17), 52 + ((h >> 8) % 8))
}

export function systemColor(system: { id: string; color?: string } | undefined | null): string {
  if (!system) return '#7c5cff'
  return system.color && /^#[0-9a-f]{3,8}$/i.test(system.color) ? system.color : colorFromId(system.id)
}

/** A two-stop palette for gradients derived from a base colour. */
export function paletteFor(base: string): { light: string; base: string; deep: string; ink: string } {
  return {
    light: mix(base, '#ffffff', 0.28),
    base,
    deep: mix(base, '#07060f', 0.62),
    ink: luminance(base) > 0.45 ? '#141221' : '#ffffff'
  }
}

export function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
  else if (max === g) h = ((b - r) / d + 2) * 60
  else h = ((r - g) / d + 4) * 60
  return [h, s * 100, l * 100]
}

/** A sibling colour for per-game variety: same family, hue nudged by a stable hash of the key. */
export function variantOf(base: string, key: string, spread = 26): string {
  const [h, s, l] = hexToHsl(base)
  const n = hashString(key)
  const dh = ((n % 1000) / 1000 - 0.5) * spread
  const dl = (((n >> 10) % 1000) / 1000 - 0.5) * 12
  return hslToHex((h + dh + 360) % 360, s, Math.max(22, Math.min(72, l + dl)))
}
