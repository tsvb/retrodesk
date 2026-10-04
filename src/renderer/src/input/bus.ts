import { focusManager } from './focus'
import { playSound } from '../lib/sound'
import { useInputStore } from '../stores/input'
import type { Action, Direction, InputSource } from './types'

export type InputEvent = { kind: 'nav'; dir: Direction } | { kind: 'action'; action: Action }

/** An interceptor sees every event first (controller tester, overlay inactive mode). Return true to consume. */
type Interceptor = (ev: InputEvent, source: InputSource) => boolean
const interceptors: Interceptor[] = []

export function pushInterceptor(fn: Interceptor): () => void {
  interceptors.push(fn)
  return () => {
    const i = interceptors.lastIndexOf(fn)
    if (i >= 0) interceptors.splice(i, 1)
  }
}

export function emitNav(dir: Direction, source: InputSource): void {
  useInputStore.getState().setSource(source)
  const top = interceptors[interceptors.length - 1]
  if (top?.({ kind: 'nav', dir }, source)) return
  focusManager.move(dir, source)
}

export function emitAction(action: Action, source: InputSource): boolean {
  useInputStore.getState().setSource(source)
  const top = interceptors[interceptors.length - 1]
  if (top?.({ kind: 'action', action }, source)) return true
  const handled = focusManager.dispatch(action)
  if (handled) playSound(action === 'confirm' ? 'confirm' : action === 'back' ? 'back' : 'toggle')
  return handled
}
