import { memo } from 'react'
import { hashString } from '../lib/color'

export type MotifKind = 'cross' | 'shapes' | 'arcs' | 'buttons' | 'stripes' | 'pixels' | 'handheld'

const HANDHELDS = new Set(['gb', 'gbc', 'gba', 'nds', '3ds', 'psp', 'psvita', 'vita', 'gamegear', 'gg', 'lynx', 'ngp', 'ngpc', 'wonderswan', 'wsc', 'virtualboy', 'pokemini'])

/** Pick a geometric motif from the manufacturer (no logo assets, just a family resemblance). */
export function motifFor(manufacturer: string | undefined, id: string): MotifKind {
  const m = (manufacturer ?? '').toLowerCase()
  if (HANDHELDS.has(id.toLowerCase())) return 'handheld'
  if (m.includes('nintendo')) return 'cross'
  if (m.includes('sony')) return 'shapes'
  if (m.includes('sega')) return 'arcs'
  if (m.includes('arcade') || m.includes('finalburn') || m.includes('mame') || m.includes('snk') || m.includes('capcom')) return 'buttons'
  const kinds: MotifKind[] = ['stripes', 'pixels', 'arcs']
  return kinds[hashString(id) % kinds.length] ?? 'stripes'
}

/**
 * Decorative SVG motif. Drawn with currentColor so the parent controls tint and opacity.
 * viewBox is 100x100; the parent positions/crops it.
 */
export const Motif = memo(function Motif({ kind, className }: { kind: MotifKind; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      {kind === 'cross' && (
        <>
          <path d="M38 14h24v24h24v24H62v24H38V62H14V38h24z" />
          <circle cx="50" cy="50" r="5" />
          <path d="M50 22v6M50 72v6M22 50h6M72 50h6" opacity="0.6" />
        </>
      )}
      {kind === 'handheld' && (
        <>
          <rect x="22" y="6" width="56" height="88" rx="8" />
          <rect x="31" y="15" width="38" height="30" rx="2" />
          <path d="M34 62h12M40 56v12" />
          <circle cx="62" cy="64" r="3.5" />
          <circle cx="68" cy="57" r="3.5" />
          <path d="M44 82h5M53 82h5" opacity="0.7" />
        </>
      )}
      {kind === 'shapes' && (
        <>
          <path d="M50 10 72 46H28z" />
          <circle cx="76" cy="70" r="14" />
          <rect x="12" y="58" width="26" height="26" rx="2" />
          <path d="M44 62l16 16M60 62 44 78" />
        </>
      )}
      {kind === 'arcs' && (
        <>
          <path d="M8 92a84 84 0 0 1 84-84" />
          <path d="M24 92a68 68 0 0 1 68-68" />
          <path d="M40 92a52 52 0 0 1 52-52" />
          <path d="M56 92a36 36 0 0 1 36-36" />
          <path d="M72 92a20 20 0 0 1 20-20" />
        </>
      )}
      {kind === 'buttons' && (
        <>
          {[0, 1, 2].map((r) =>
            [0, 1, 2].map((c) => <circle key={`${r}${c}`} cx={22 + c * 28 + (r % 2) * 8} cy={24 + r * 26} r="9" />)
          )}
          <path d="M14 92h72" />
        </>
      )}
      {kind === 'stripes' && (
        <>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <path key={i} d={`M${-20 + i * 18} 100 L${40 + i * 18} 0`} />
          ))}
        </>
      )}
      {kind === 'pixels' && (
        <g fill="currentColor" stroke="none">
          {[
            [2, 0], [3, 0], [1, 1], [2, 1], [3, 1], [4, 1], [0, 2], [1, 2], [3, 2], [4, 2], [5, 2], [0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [2, 4], [3, 4], [1, 5], [4, 5]
          ].map(([x, y]) => (
            <rect key={`${x}-${y}`} x={20 + (x ?? 0) * 10} y={20 + (y ?? 0) * 10} width="9" height="9" rx="1" />
          ))}
        </g>
      )}
    </svg>
  )
})
