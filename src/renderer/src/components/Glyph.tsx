import type { Action, PadFamily } from '../input/types'
import { useGlyphFamily } from '../stores/input'
import { useSettings } from '../stores/settings'

/** Physical button index (standard mapping) for an action, honouring the A/B layout swap. */
export function buttonForAction(action: Action, layout: 'xbox' | 'nintendo'): number {
  switch (action) {
    case 'confirm':
      return layout === 'nintendo' ? 1 : 0
    case 'back':
      return layout === 'nintendo' ? 0 : 1
    case 'favorite':
      return 2
    case 'search':
      return 3
    case 'tabPrev':
      return 4
    case 'tabNext':
      return 5
    case 'pageUp':
      return 6
    case 'pageDown':
      return 7
    case 'view':
      return 8
    case 'menu':
      return 9
  }
}

const KEYS: Record<Action, string> = {
  confirm: 'Enter',
  back: 'Esc',
  favorite: 'F',
  search: '/',
  tabPrev: 'Q',
  tabNext: 'E',
  pageUp: 'Z',
  pageDown: 'C',
  view: 'Tab',
  menu: 'M'
}

interface FaceDef {
  label: string
  color?: string
  shape: 'face' | 'shoulder' | 'meta'
}

const FACE: Record<Exclude<PadFamily, 'generic'>, Record<number, FaceDef>> = {
  xbox: {
    0: { label: 'A', color: '#5cc72d', shape: 'face' },
    1: { label: 'B', color: '#ec4a4f', shape: 'face' },
    2: { label: 'X', color: '#3b8ee6', shape: 'face' },
    3: { label: 'Y', color: '#f2c12e', shape: 'face' },
    4: { label: 'LB', shape: 'shoulder' },
    5: { label: 'RB', shape: 'shoulder' },
    6: { label: 'LT', shape: 'shoulder' },
    7: { label: 'RT', shape: 'shoulder' },
    8: { label: '⧉', shape: 'meta' },
    9: { label: '≡', shape: 'meta' },
    16: { label: 'Xbox', shape: 'meta' }
  },
  playstation: {
    0: { label: '✕', color: '#8fb3ff', shape: 'face' },
    1: { label: '○', color: '#ff7b8f', shape: 'face' },
    2: { label: '□', color: '#f29bd8', shape: 'face' },
    3: { label: '△', color: '#4fdcb0', shape: 'face' },
    4: { label: 'L1', shape: 'shoulder' },
    5: { label: 'R1', shape: 'shoulder' },
    6: { label: 'L2', shape: 'shoulder' },
    7: { label: 'R2', shape: 'shoulder' },
    8: { label: 'Create', shape: 'meta' },
    9: { label: 'Options', shape: 'meta' },
    16: { label: 'PS', shape: 'meta' }
  },
  nintendo: {
    0: { label: 'B', shape: 'face' },
    1: { label: 'A', shape: 'face' },
    2: { label: 'Y', shape: 'face' },
    3: { label: 'X', shape: 'face' },
    4: { label: 'L', shape: 'shoulder' },
    5: { label: 'R', shape: 'shoulder' },
    6: { label: 'ZL', shape: 'shoulder' },
    7: { label: 'ZR', shape: 'shoulder' },
    8: { label: '−', shape: 'face' },
    9: { label: '+', shape: 'face' },
    16: { label: 'Home', shape: 'meta' }
  }
}

export function padButtonDef(family: PadFamily, index: number): FaceDef {
  const set = FACE[family === 'generic' ? 'xbox' : family]
  return set[index] ?? { label: String(index), shape: 'meta' }
}

export function PadButton({ family, index, size = 'md' }: { family: PadFamily; index: number; size?: 'sm' | 'md' | 'lg' }) {
  const def = padButtonDef(family, index)
  return (
    <span className={`glyph glyph--${def.shape} glyph--${size}`} style={def.color ? { color: def.color, borderColor: def.color } : undefined}>
      {def.label}
    </span>
  )
}

export function KeyCap({ label, size = 'md' }: { label: string; size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`glyph glyph--key glyph--${size}`}>{label}</span>
}

/** Glyph for an action using the connected controller's family (or keyboard keys). */
export function Glyph({ action, size = 'md' }: { action: Action; size?: 'sm' | 'md' | 'lg' }) {
  const family = useGlyphFamily()
  const layout = useSettings((s) => s.settings?.ui.buttonLayout ?? 'xbox')
  if (family === 'keyboard') return <KeyCap label={KEYS[action]} size={size} />
  return <PadButton family={family} index={buttonForAction(action, layout)} size={size} />
}
