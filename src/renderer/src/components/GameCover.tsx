import { memo, useState, type CSSProperties } from 'react'
import { mediaUrl } from '@shared/media'
import type { Game, MediaKind, SystemDef } from '@shared/types'
import { paletteFor, systemColor, variantOf } from '../lib/color'
import { Motif, motifFor } from './Motif'

interface CoverProps {
  game: Pick<Game, 'id' | 'title' | 'media' | 'systemId'>
  system?: Pick<SystemDef, 'id' | 'color' | 'shortName' | 'name' | 'manufacturer'>
  kind?: MediaKind
  className?: string
  /** Fill the parent (object-fit cover) instead of letterboxing the art. */
  fill?: boolean
  /**
   * Load a downscaled copy no wider than this (px) instead of the full-size file. Tiles pass roughly twice
   * their CSS width; covers shown large and sharp leave it out.
   */
  thumb?: number
}

/**
 * Thumbnail widths (px) for art shown small or blurred: shelf/grid tiles, list rows, and the heavily blurred
 * backdrops behind the hero, game details and Now Playing (where detail would be wasted).
 */
export const COVER_THUMB = { tile: 400, list: 160, backdrop: 160 } as const

/** Boxart when available, otherwise a generated cover in the system's colours. */
export const GameCover = memo(function GameCover({ game, system, kind = 'boxart', className = '', fill = false, thumb }: CoverProps) {
  const src = mediaUrl(game.media[kind] ?? (kind !== 'boxart' ? game.media.boxart : undefined), { w: thumb })
  const [failed, setFailed] = useState<string | null>(null)
  // The src whose art turned out landscape once loaded; only that art gets the blurred backdrop.
  const [wideSrc, setWideSrc] = useState<string | null>(null)
  const color = systemColor(system ?? { id: game.systemId })
  if (src && failed !== src) {
    const wide = !fill && wideSrc === src
    return (
      <div className={`cover cover--art ${fill ? 'cover--fill' : ''} ${wide ? 'is-wide' : ''} ${className}`} style={{ '--sys': color } as CSSProperties}>
        {wide && <img className="cover__backdrop" src={src} alt="" aria-hidden decoding="async" draggable={false} />}
        <img
          className="cover__img"
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={(e) => setWideSrc(e.currentTarget.naturalWidth > e.currentTarget.naturalHeight ? src : null)}
          onError={() => setFailed(src)}
        />
      </div>
    )
  }
  return <GeneratedCover title={game.title} system={system} systemId={game.systemId} className={className} />
})

export const GeneratedCover = memo(function GeneratedCover({
  title,
  system,
  systemId,
  className = ''
}: {
  title: string
  system?: CoverProps['system']
  systemId: string
  className?: string
}) {
  const p = paletteFor(variantOf(systemColor(system ?? { id: systemId }), title))
  const style = {
    '--c-light': p.light,
    '--c-base': p.base,
    '--c-deep': p.deep,
    '--c-ink': p.ink
  } as CSSProperties
  const len = title.length
  const sizeClass = len > 34 ? 'is-long' : len > 18 ? 'is-mid' : 'is-short'
  return (
    <div className={`cover cover--generated ${className}`} style={style}>
      <Motif kind={motifFor(system?.manufacturer, systemId)} className="cover__motif" />
      <span className="cover__system">{system?.shortName ?? system?.name ?? systemId.toUpperCase()}</span>
      <span className={`cover__title ${sizeClass}`}>{title}</span>
    </div>
  )
})
