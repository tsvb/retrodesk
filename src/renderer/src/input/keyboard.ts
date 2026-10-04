import { emitAction, emitNav } from './bus'
import type { Action, Direction } from './types'

/** Receives printable characters (length 1) and 'Backspace'. Return true when consumed. */
export type TextCaptureHandler = (key: string) => boolean
const captures: TextCaptureHandler[] = []

export function pushTextCapture(fn: TextCaptureHandler): () => void {
  captures.push(fn)
  return () => {
    const i = captures.lastIndexOf(fn)
    if (i >= 0) captures.splice(i, 1)
  }
}

const DIRS: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }

const KEY_ACTIONS: Record<string, Action> = {
  Enter: 'confirm',
  ' ': 'confirm',
  Escape: 'back',
  Backspace: 'back',
  f: 'favorite',
  '/': 'search',
  q: 'tabPrev',
  e: 'tabNext',
  PageUp: 'tabPrev',
  PageDown: 'tabNext',
  z: 'pageUp',
  c: 'pageDown',
  m: 'menu',
  ContextMenu: 'menu',
  Tab: 'view'
}

function isTextField(t: EventTarget | null): t is HTMLInputElement | HTMLTextAreaElement {
  if (!(t instanceof HTMLElement)) return false
  if (t instanceof HTMLTextAreaElement) return true
  if (t instanceof HTMLInputElement) return !['checkbox', 'radio', 'range', 'button', 'submit', 'color'].includes(t.type)
  return t.isContentEditable
}

export interface KeyboardOptions {
  onFullscreen?: () => void
  /** Extra global handler run before everything else (overlay accelerator). Return true when consumed. */
  onKey?: (e: KeyboardEvent) => boolean
}

export function installKeyboard(opts: KeyboardOptions = {}): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (opts.onKey?.(e)) {
      e.preventDefault()
      return
    }
    if (e.key === 'F11') {
      e.preventDefault()
      opts.onFullscreen?.()
      return
    }
    const inField = isTextField(e.target)
    if (inField) {
      // Native editing wins; only leave the field with Escape / vertical arrows / Enter.
      const field = e.target as HTMLInputElement
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault()
        field.blur()
        return
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        field.blur()
        emitNav(DIRS[e.key] as Direction, 'keyboard')
      }
      return
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      emitAction('search', 'keyboard')
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return

    const dir = DIRS[e.key]
    if (dir) {
      e.preventDefault()
      emitNav(dir, 'keyboard')
      return
    }

    // Text capture (search screen) gets printable characters and Backspace first.
    const top: TextCaptureHandler | undefined = captures[captures.length - 1]
    if (top && (e.key.length === 1 || e.key === 'Backspace') && top(e.key)) {
      e.preventDefault()
      return
    }

    const action = KEY_ACTIONS[e.key.length === 1 ? e.key.toLowerCase() : e.key]
    if (action) {
      e.preventDefault()
      if (e.repeat && action !== 'pageUp' && action !== 'pageDown') return
      emitAction(action, 'keyboard')
    }
  }
  window.addEventListener('keydown', onKeyDown)
  return () => window.removeEventListener('keydown', onKeyDown)
}
