import { useHints } from '../input/hooks'
import { emitAction } from '../input/bus'
import type { Action, Hint } from '../input/types'
import { Glyph } from './Glyph'

const PAIRS: [Action, Action][] = [
  ['tabPrev', 'tabNext'],
  ['pageUp', 'pageDown']
]

type Item = { actions: Action[]; label: string }

function group(hints: Hint[]): Item[] {
  const out: Item[] = []
  const used = new Set<Action>()
  for (const h of hints) {
    if (used.has(h.action)) continue
    const pair = PAIRS.find((p) => p[0] === h.action)
    const partner = pair ? hints.find((x) => x.action === pair[1]) : undefined
    if (pair && partner && partner.label === h.label) {
      out.push({ actions: [h.action, partner.action], label: h.label })
      used.add(partner.action)
    } else {
      out.push({ actions: [h.action], label: h.label })
    }
    used.add(h.action)
  }
  return out
}

/** Contextual button hints. Each hint is also clickable for mouse users. */
export function HintBar({ className = '' }: { className?: string }) {
  const hints = useHints()
  const items = group(hints)
  return (
    <footer className={`hintbar ${className}`}>
      <div className="hintbar__items">
        {items.map((it) => (
          <button
            key={it.actions.join('+')}
            type="button"
            tabIndex={-1}
            className="hint"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => emitAction(it.actions[it.actions.length - 1] as Action, 'mouse')}
          >
            {it.actions.map((a) => (
              <Glyph key={a} action={a} />
            ))}
            <span className="hint__label">{it.label}</span>
          </button>
        ))}
      </div>
    </footer>
  )
}
