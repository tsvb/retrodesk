export type Direction = 'up' | 'down' | 'left' | 'right'

/** Semantic actions produced by any input device. */
export type Action =
  | 'confirm' // A (xbox layout) / Enter
  | 'back' // B / Escape
  | 'favorite' // X / F
  | 'search' // Y / "/"
  | 'tabPrev' // LB / Q
  | 'tabNext' // RB / E
  | 'pageUp' // LT / Z
  | 'pageDown' // RT / C
  | 'menu' // Start / M
  | 'view' // Back/Select / Tab

export type InputSource = 'pad' | 'keyboard' | 'mouse'

/** Order in which hints are shown in the bottom bar. */
export const HINT_ORDER: Action[] = ['confirm', 'back', 'favorite', 'search', 'view', 'menu', 'tabPrev', 'tabNext', 'pageUp', 'pageDown']

export interface ActionBinding {
  /** Shown in the button-hint bar when present. */
  label?: string
  /** Return false to let the action fall through to lower layers. */
  run: () => boolean | void
}

export type ActionMap = Partial<Record<Action, ActionBinding | (() => boolean | void)>>

export interface Hint {
  action: Action
  label: string
}

export type PadFamily = 'xbox' | 'playstation' | 'nintendo' | 'generic'
