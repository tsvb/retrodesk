import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent
} from 'react'
import { focusManager, ROOT_SCOPE, type FocusNodeOptions } from './focus'
import { pushTextCapture, type TextCaptureHandler } from './keyboard'
import { useInputStore } from '../stores/input'
import type { ActionMap, Hint } from './types'

const ScopeContext = createContext<string>(ROOT_SCOPE)

export function useScopeId(): string {
  return useContext(ScopeContext)
}

/**
 * A navigation layer: a screen, sheet or modal. Only the most recently mounted scope is navigable; when it
 * unmounts the previous scope gets its last focus back.
 */
export function FocusScope({ children, id, isolated = false }: { children: ReactNode; id?: string; isolated?: boolean }) {
  const auto = useId()
  const scopeId = id ?? `scope${auto}`
  useLayoutEffect(() => {
    focusManager.pushScope(scopeId, isolated)
    return () => focusManager.popScope(scopeId)
  }, [scopeId, isolated])
  return <ScopeContext.Provider value={scopeId}>{children}</ScopeContext.Provider>
}

export function useIsScopeActive(): boolean {
  const scope = useScopeId()
  return useSyncExternalStore(focusManager.subscribe, () => focusManager.isScopeActive(scope))
}

export interface FocusableProps<T extends HTMLElement> {
  ref: (el: T | null) => void
  onPointerMove: (e: ReactPointerEvent) => void
  onClick: (e: ReactMouseEvent) => void
  onMouseDown: (e: ReactMouseEvent) => void
  'data-focusable': ''
  /** Focus id, so DOM queries can hand focus to a specific element. */
  'data-fid': string
}

let lastPointer = { x: -1, y: -1 }

/**
 * Register an element as focusable. Returns props to spread on the element plus the focus id.
 * Options are read through a ref, so handlers can change every render without re-registering.
 */
export function useFocusable<T extends HTMLElement = HTMLElement>(
  opts: FocusNodeOptions & { id?: string; keepDomFocus?: boolean } = {}
): { props: FocusableProps<T>; id: string; focused: boolean; focus: () => void } {
  const auto = useId()
  const id = opts.id ?? `f${auto}`
  const scope = useScopeId()
  const optsRef = useRef<FocusNodeOptions>(opts)
  optsRef.current = opts
  const elRef = useRef<T | null>(null)

  const ref = useCallback(
    (el: T | null) => {
      if (elRef.current && elRef.current !== el) focusManager.unregister(id)
      elRef.current = el
      if (el) focusManager.register(id, el, scope, optsRef)
    },
    [id, scope]
  )

  const focused = useSyncExternalStore(focusManager.subscribe, () => focusManager.getFocusedId() === id)

  // Keep the hint bar in sync when this node's labels change while it is focused (e.g. Favourite -> Unfavourite).
  const hintKey = `${opts.onActivate ? (opts.label ?? 'Select') : ''}|${Object.entries(opts.actions ?? {})
    .map(([k, v]) => `${k}:${typeof v === 'function' ? '' : (v?.label ?? '')}`)
    .join(',')}`
  useEffect(() => {
    if (focused) focusManager.touch()
  }, [hintKey, focused])

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      // Only real pointer motion moves focus (Chrome fires synthetic moves while content scrolls).
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return
      if (e.screenX === lastPointer.x && e.screenY === lastPointer.y) return
      lastPointer = { x: e.screenX, y: e.screenY }
      useInputStore.getState().setSource('mouse')
      if (focusManager.getFocusedId() !== id) focusManager.focus(id, { source: 'mouse' })
    },
    [id]
  )
  const onClick = useCallback(
    (e: ReactMouseEvent) => {
      e.stopPropagation()
      useInputStore.getState().setSource('mouse')
      focusManager.focus(id, { source: 'mouse' })
      optsRef.current.onActivate?.()
    },
    [id]
  )
  const keepDom = opts.keepDomFocus === true
  const onMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      // Keep DOM focus off buttons so Enter is only handled by the input system.
      if (!keepDom) e.preventDefault()
    },
    [keepDom]
  )

  return {
    props: { ref, onPointerMove, onClick, onMouseDown, 'data-focusable': '', 'data-fid': id },
    id,
    focused,
    focus: () => focusManager.focus(id, { source: 'program' })
  }
}

/** Configure a navigation group (e.g. rows that remember their last focused card). */
export function useFocusGroup(id: string, cfg: { memory?: boolean }): void {
  useLayoutEffect(() => {
    focusManager.configureGroup(id, cfg)
  }, [id, cfg.memory])
}

/**
 * Register action handlers for the current scope. Bindings with a label show up in the hint bar.
 * Handlers are kept in a ref, so pass a fresh object every render freely.
 */
export function useActions(map: ActionMap, enabled = true): void {
  const scope = useScopeId()
  const ref = useRef<ActionMap>(map)
  ref.current = enabled ? map : {}
  const labelKey = Object.entries(map)
    .map(([k, v]) => `${k}:${typeof v === 'function' ? '' : (v?.label ?? '')}`)
    .join('|')
  useLayoutEffect(() => focusManager.addLayer(scope, ref), [scope])
  useEffect(() => {
    focusManager.touch()
  }, [labelKey, enabled])
}

export function useHints(): Hint[] {
  const version = useSyncExternalStore(focusManager.subscribe, focusManager.getVersion)
  // Derived during render: the version bumps after the change it reports, so the hints are current in this pass.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => focusManager.hints(), [version])
}

export function useFocusedId(): string | null {
  return useSyncExternalStore(focusManager.subscribe, focusManager.getFocusedId)
}

/** Capture printable keys (and Backspace) while this component's scope is active. */
export function useTextCapture(handler: TextCaptureHandler, enabled = true): void {
  const scope = useScopeId()
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!enabled) return
    return pushTextCapture((key) => (focusManager.isScopeActive(scope) ? ref.current(key) : false))
  }, [scope, enabled])
}
