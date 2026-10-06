import { memo, type CSSProperties } from 'react'
import { Download } from 'lucide-react'
import type { SystemSummary } from '@shared/types'
import { useFocusable } from '../input/hooks'
import { paletteFor, systemColor } from '../lib/color'
import { plural } from '../lib/format'
import { Motif, motifFor } from './Motif'

interface Props {
  system: SystemSummary
  size?: 'lg' | 'sm'
  group?: string
  autoFocus?: boolean
  onActivate: (s: SystemSummary) => void
  onFocus?: (s: SystemSummary) => void
}

export function systemStyle(system: { id: string; color?: string }): CSSProperties {
  const p = paletteFor(systemColor(system))
  return { '--c-light': p.light, '--c-base': p.base, '--c-deep': p.deep, '--c-ink': p.ink } as CSSProperties
}

/** A system rendered as a stylized cartridge: colored label with a geometric motif, grip ridges below. */
export const SystemCard = memo(function SystemCard({ system, size = 'lg', group, autoFocus, onActivate, onFocus }: Props) {
  const { props } = useFocusable<HTMLDivElement>({
    group,
    autoFocus,
    label: 'Browse',
    onActivate: () => onActivate(system),
    onFocus: () => onFocus?.(system)
  })
  const short = system.shortName ?? system.name
  const empty = system.gameCount === 0
  return (
    <div className={`cart cart--${size} ${empty ? 'is-empty' : ''}`} style={systemStyle(system)} role="button" aria-label={system.name} {...props}>
      <div className="cart__shell">
        <div className="cart__label">
          <Motif kind={motifFor(system.manufacturer, system.id)} className="cart__motif" />
          <div className="cart__top">
            <span>{system.manufacturer}</span>
            <span>{system.year}</span>
          </div>
          <span className={`cart__short ${short.length > 4 ? 'is-wide' : ''}`}>{short}</span>
        </div>
        <div className="cart__foot">
          <span className="cart__name">{system.name}</span>
          <span className="cart__count">{empty ? 'No games yet' : plural(system.gameCount, 'game')}</span>
        </div>
      </div>
      {!system.playable && (
        <span className="cart__badge">
          <Download size="0.9em" strokeWidth={2.5} /> Install
        </span>
      )}
    </div>
  )
})
