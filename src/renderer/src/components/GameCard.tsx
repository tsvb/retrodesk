import { memo } from 'react'
import { Heart } from 'lucide-react'
import type { Game, SystemSummary } from '@shared/types'
import { useFocusable } from '../input/hooks'
import { useLibrary, usePatched } from '../stores/library'
import { toast } from '../stores/session'
import { COVER_THUMB, GameCover } from './GameCover'

interface Props {
  game: Game
  system?: SystemSummary
  group?: string
  autoFocus?: boolean
  showSystem?: boolean
  onActivate: (game: Game) => void
  onFocus?: (game: Game) => void
}

export async function toggleFavorite(game: Game): Promise<void> {
  try {
    const g = await useLibrary.getState().setFavorite(game, !game.favorite)
    toast(g.favorite ? `Added ${g.title} to favorites` : `Removed ${g.title} from favorites`, 'success')
  } catch (e) {
    toast(`Couldn't update favorites: ${e instanceof Error ? e.message : String(e)}`, 'error')
  }
}

/** A cover tile used in rows, grids and search results. */
export const GameCard = memo(function GameCard({ game: raw, system, group, autoFocus, showSystem, onActivate, onFocus }: Props) {
  const game = usePatched(raw)
  const { props } = useFocusable<HTMLDivElement>({
    group,
    autoFocus,
    label: 'Open',
    onActivate: () => onActivate(game),
    onFocus: () => onFocus?.(game),
    actions: { favorite: { label: game.favorite ? 'Unfavorite' : 'Favorite', run: () => void toggleFavorite(game) } }
  })
  return (
    <div className="game-card" role="button" aria-label={game.title} {...props}>
      <div className="game-card__frame">
        <GameCover game={game} system={system} thumb={COVER_THUMB.tile} />
        {game.favorite && (
          <span className="game-card__fav" aria-label="Favorite">
            <Heart size="1em" fill="currentColor" strokeWidth={0} />
          </span>
        )}
      </div>
      <div className="game-card__caption">
        <span className="game-card__title">{game.title}</span>
        {showSystem && system && <span className="game-card__meta">{system.shortName ?? system.name}</span>}
      </div>
    </div>
  )
})
