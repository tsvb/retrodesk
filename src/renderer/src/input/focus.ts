import { playSound } from '../lib/sound'
import { HINT_ORDER, type Action, type ActionBinding, type ActionMap, type Direction, type Hint, type InputSource } from './types'

/**
 * Focus manager for a controller-first UI.
 *
 * - Focusable elements register with a scope (the screen or modal they live in). Only the top-most scope
 *   is navigable; when a scope is popped the previous one gets its last focus back.
 * - Directional moves use geometry: nearest candidate in the half-plane of the direction, weighted to
 *   prefer elements aligned with the current one. Nodes may belong to a group; a group with `memory`
 *   restores its last focused member when re-entered (rows on Home remember their position).
 * - Nodes may implement `handleDirection` to navigate internally (the virtualised game grid does this)
 *   and fall back to the spatial search at their edges.
 * - Action layers (useActions) are tied to scopes, which lets the bottom hint bar be derived from
 *   what is actually handled right now.
 */

export interface FocusNodeOptions {
  group?: string
  autoFocus?: boolean
  disabled?: boolean
  /** Label for the confirm hint, e.g. "Play". Defaults to "Select". */
  label?: string
  onActivate?: () => void
  onFocus?: (source: InputSource | 'program') => void
  actions?: ActionMap
  /** Custom navigation inside the node. Return true when consumed. */
  handleDirection?: (dir: Direction) => boolean
  /** Rect used for spatial search (defaults to the element rect). */
  getRect?: () => DOMRect
  /** How to bring the node into view on keyboard/pad focus. */
  scroll?: 'nearest' | 'center' | 'none'
}

interface FocusNode {
  id: string
  el: HTMLElement
  scope: string
  opts: { current: FocusNodeOptions }
}

interface Scope {
  id: string
  lastFocused?: string
  /** Isolated scopes (modals) do not fall through to root-scope actions such as tab switching. */
  isolated?: boolean
}

interface GroupConfig {
  memory: boolean
}

interface ActionLayer {
  key: number
  scope: string
  map: { current: ActionMap }
}

type Listener = () => void

export const ROOT_SCOPE = 'root'

class FocusManager {
  private nodes = new Map<string, FocusNode>()
  private scopes: Scope[] = [{ id: ROOT_SCOPE }]
  private groups = new Map<string, GroupConfig>()
  private groupMemory = new Map<string, string>()
  private layers: ActionLayer[] = []
  private layerSeq = 0
  private focusedId: string | null = null
  private lastRect: DOMRect | null = null
  private listeners = new Set<Listener>()
  private ensureQueued = false
  private version = 0
  private lastScroll = 0

  // ---------- subscriptions ----------
  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  getFocusedId = (): string | null => this.focusedId
  /** Bumped whenever focus, scopes or action layers change (drives the hint bar). */
  getVersion = (): number => this.version
  private emit(): void {
    this.version++
    for (const l of this.listeners) l()
  }

  // ---------- scopes ----------
  get activeScope(): string {
    return this.scopes[this.scopes.length - 1]?.id ?? ROOT_SCOPE
  }
  pushScope(id: string, isolated = false): void {
    if (this.scopes.some((s) => s.id === id)) return
    const current = this.scopes[this.scopes.length - 1]
    if (current && this.focusedId) current.lastFocused = this.focusedId
    this.scopes.push({ id, isolated })
    this.queueEnsure()
    this.emit()
  }
  popScope(id: string): void {
    const idx = this.scopes.findIndex((s) => s.id === id)
    if (idx <= 0) return
    const wasTop = idx === this.scopes.length - 1
    this.scopes.splice(idx, 1)
    if (wasTop) {
      const top = this.scopes[this.scopes.length - 1]
      const restore = top?.lastFocused && this.nodes.get(top.lastFocused)
      if (restore && restore.el.isConnected) this.focus(restore.id, { source: 'program', scroll: false })
      else {
        this.setFocused(null)
        this.queueEnsure()
      }
    }
    this.emit()
  }
  isScopeActive(id: string): boolean {
    return this.activeScope === id
  }

  // ---------- groups ----------
  configureGroup(id: string, cfg: Partial<GroupConfig>): void {
    this.groups.set(id, { memory: false, ...this.groups.get(id), ...cfg })
  }
  forgetGroup(id: string): void {
    this.groupMemory.delete(id)
  }

  // ---------- registration ----------
  register(id: string, el: HTMLElement, scope: string, opts: { current: FocusNodeOptions }): void {
    this.nodes.set(id, { id, el, scope, opts })
    if (this.focusedId === id) el.setAttribute('data-focused', '')
    if (scope === this.activeScope) this.queueEnsure()
  }
  unregister(id: string): void {
    const node = this.nodes.get(id)
    this.nodes.delete(id)
    if (this.focusedId === id) {
      this.lastRect = node ? safeRect(node) : this.lastRect
      this.focusedId = null
      this.queueEnsure(true)
      this.emit()
    }
  }

  // ---------- focus ----------
  focus(id: string, o: { source?: InputSource | 'program'; scroll?: boolean } = {}): void {
    const node = this.nodes.get(id)
    if (!node || node.opts.current.disabled) return
    if (node.scope !== this.activeScope) return
    const changed = this.focusedId !== id
    this.setFocused(id)
    const scope = this.scopes.find((s) => s.id === node.scope)
    if (scope) scope.lastFocused = id
    const g = node.opts.current.group
    if (g) this.groupMemory.set(g, id)
    if (changed) node.opts.current.onFocus?.(o.source ?? 'program')
    if (o.scroll !== false && o.source !== 'mouse') this.scrollIntoView(node)
    if (changed) this.emit()
  }

  private setFocused(id: string | null): void {
    if (this.focusedId === id) return
    const prev = this.focusedId ? this.nodes.get(this.focusedId) : undefined
    prev?.el.removeAttribute('data-focused')
    this.focusedId = id
    const next = id ? this.nodes.get(id) : undefined
    next?.el.setAttribute('data-focused', '')
  }

  /** Re-run scroll for the focused node (e.g. after layout changes). */
  scrollFocused(): void {
    const n = this.focusedId ? this.nodes.get(this.focusedId) : undefined
    if (n) this.scrollIntoView(n)
  }

  private scrollIntoView(node: FocusNode): void {
    const mode = node.opts.current.scroll ?? 'nearest'
    if (mode === 'none') return
    // Rapid repeats (held direction) jump instantly so the view never trails the focus.
    const now = performance.now()
    const rapid = now - this.lastScroll < 160
    this.lastScroll = now
    node.el.scrollIntoView({ behavior: rapid || prefersReducedMotion() ? 'auto' : 'smooth', block: mode, inline: mode === 'center' ? 'center' : 'nearest' })
  }

  /** Make sure the active scope has something focused. */
  queueEnsure(nearLastRect = false): void {
    if (this.ensureQueued) return
    this.ensureQueued = true
    requestAnimationFrame(() => {
      this.ensureQueued = false
      this.ensureFocus(nearLastRect)
    })
  }

  ensureFocus(nearLastRect = false): void {
    const scopeId = this.activeScope
    const current = this.focusedId ? this.nodes.get(this.focusedId) : undefined
    if (current && current.scope === scopeId && current.el.isConnected && !current.opts.current.disabled) return
    const candidates = this.candidates(scopeId)
    if (!candidates.length) {
      if (current && current.scope !== scopeId) this.setFocused(null)
      return
    }
    const scope = this.scopes.find((s) => s.id === scopeId)
    const remembered = scope?.lastFocused ? candidates.find((c) => c.id === scope.lastFocused) : undefined
    let pick = remembered
    if (!pick && nearLastRect && this.lastRect) {
      const lr = this.lastRect
      pick = minBy(candidates, (c) => {
        const r = safeRect(c)
        return Math.hypot(r.left + r.width / 2 - (lr.left + lr.width / 2), r.top + r.height / 2 - (lr.top + lr.height / 2))
      })
    }
    if (!pick) pick = candidates.filter((c) => c.opts.current.autoFocus).pop()
    if (!pick) {
      pick = minBy(candidates, (c) => {
        const r = safeRect(c)
        return r.top * 4 + r.left
      })
    }
    if (pick) this.focus(pick.id, { source: 'program', scroll: false })
  }

  private candidates(scopeId: string): FocusNode[] {
    const out: FocusNode[] = []
    for (const n of this.nodes.values()) {
      if (n.scope !== scopeId || n.opts.current.disabled || !n.el.isConnected) continue
      const r = safeRect(n)
      if (r.width === 0 && r.height === 0) continue
      out.push(n)
    }
    return out
  }

  // ---------- navigation ----------
  move(dir: Direction, source: InputSource): boolean {
    const cur = this.focusedId ? this.nodes.get(this.focusedId) : undefined
    if (!cur || cur.scope !== this.activeScope || !cur.el.isConnected) {
      this.ensureFocus()
      return false
    }
    if (cur.opts.current.handleDirection?.(dir)) {
      playSound('move')
      this.emit()
      return true
    }
    const from = safeRect(cur)
    const all = this.candidates(cur.scope).filter((n) => n.id !== cur.id)
    const group = cur.opts.current.group

    // 1. Stay inside the current group when it has a candidate in that direction.
    let target: FocusNode | undefined
    if (group) target = nearest(from, all.filter((n) => n.opts.current.group === group), dir)
    // 2. Otherwise the whole scope.
    if (!target) target = nearest(from, all, dir)
    if (!target) return false

    // 3. Entering a remembering group: go to its last focused member.
    const tg = target.opts.current.group
    if (tg && tg !== group && this.groups.get(tg)?.memory) {
      const memId = this.groupMemory.get(tg)
      const mem = memId ? this.nodes.get(memId) : undefined
      if (mem && mem.scope === cur.scope && mem.el.isConnected && !mem.opts.current.disabled) target = mem
    }
    this.focus(target.id, { source })
    playSound('move')
    return true
  }

  // ---------- actions ----------
  addLayer(scope: string, map: { current: ActionMap }): () => void {
    const layer: ActionLayer = { key: ++this.layerSeq, scope, map }
    this.layers.push(layer)
    this.emit()
    return () => {
      this.layers = this.layers.filter((l) => l !== layer)
      this.emit()
    }
  }
  /** Call after an action layer's labels change. */
  touch(): void {
    this.emit()
  }

  private activeLayers(): ActionLayer[] {
    const scope = this.activeScope
    const own = this.layers.filter((l) => l.scope === scope).reverse()
    const isolated = this.scopes[this.scopes.length - 1]?.isolated
    const global = scope === ROOT_SCOPE || isolated ? [] : this.layers.filter((l) => l.scope === ROOT_SCOPE).reverse()
    return [...own, ...global]
  }

  dispatch(action: Action): boolean {
    const node = this.focusedId ? this.nodes.get(this.focusedId) : undefined
    const nodeActive = node && node.scope === this.activeScope && node.el.isConnected
    if (nodeActive) {
      if (action === 'confirm' && node.opts.current.onActivate) {
        node.opts.current.onActivate()
        return true
      }
      const b = node.opts.current.actions?.[action]
      if (b && runBinding(b) !== false) return true
    }
    for (const layer of this.activeLayers()) {
      const b = layer.map.current[action]
      if (b && runBinding(b) !== false) return true
    }
    return false
  }

  /** Hints for the bottom bar, derived from the focused node and the active action layers. */
  hints(): Hint[] {
    const found = new Map<Action, string>()
    const node = this.focusedId ? this.nodes.get(this.focusedId) : undefined
    if (node && node.scope === this.activeScope) {
      if (node.opts.current.onActivate) found.set('confirm', node.opts.current.label ?? 'Select')
      for (const [a, b] of Object.entries(node.opts.current.actions ?? {}) as [Action, ActionMap[Action]][]) {
        const label = bindingLabel(b)
        if (label && !found.has(a)) found.set(a, label)
      }
    }
    for (const layer of this.activeLayers()) {
      for (const [a, b] of Object.entries(layer.map.current) as [Action, ActionMap[Action]][]) {
        const label = bindingLabel(b)
        if (label && !found.has(a)) found.set(a, label)
      }
    }
    return HINT_ORDER.filter((a) => found.has(a)).map((a) => ({ action: a, label: found.get(a) ?? '' }))
  }

  /** Focused node's element (for scroll helpers and tests). */
  focusedElement(): HTMLElement | null {
    return this.focusedId ? (this.nodes.get(this.focusedId)?.el ?? null) : null
  }
}

function runBinding(b: ActionBinding | (() => boolean | void)): boolean | void {
  return typeof b === 'function' ? b() : b.run()
}
function bindingLabel(b: ActionMap[Action]): string | undefined {
  return b && typeof b !== 'function' ? b.label : undefined
}

function safeRect(n: FocusNode): DOMRect {
  try {
    return n.opts.current.getRect?.() ?? n.el.getBoundingClientRect()
  } catch {
    return n.el.getBoundingClientRect()
  }
}

function minBy<T>(arr: T[], f: (x: T) => number): T | undefined {
  let best: T | undefined
  let bestV = Infinity
  for (const x of arr) {
    const v = f(x)
    if (v < bestV) {
      bestV = v
      best = x
    }
  }
  return best
}

/** Geometric nearest neighbour in a direction. */
function nearest(from: DOMRect, nodes: FocusNode[], dir: Direction): FocusNode | undefined {
  const fcx = from.left + from.width / 2
  const fcy = from.top + from.height / 2
  let best: FocusNode | undefined
  let bestScore = Infinity
  for (const n of nodes) {
    const r = safeRect(n)
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    let primary: number
    let secondary: number
    switch (dir) {
      case 'down':
        if (cy <= fcy + 1 || r.bottom <= from.bottom - 1) continue
        primary = Math.max(0, r.top - from.bottom)
        secondary = rangeGap(from.left, from.right, r.left, r.right)
        break
      case 'up':
        if (cy >= fcy - 1 || r.top >= from.top + 1) continue
        primary = Math.max(0, from.top - r.bottom)
        secondary = rangeGap(from.left, from.right, r.left, r.right)
        break
      case 'right':
        if (cx <= fcx + 1 || r.right <= from.right - 1) continue
        primary = Math.max(0, r.left - from.right)
        secondary = rangeGap(from.top, from.bottom, r.top, r.bottom)
        break
      case 'left':
        if (cx >= fcx - 1 || r.left >= from.left + 1) continue
        primary = Math.max(0, from.left - r.right)
        secondary = rangeGap(from.top, from.bottom, r.top, r.bottom)
        break
    }
    const align = dir === 'up' || dir === 'down' ? Math.abs(cx - fcx) : Math.abs(cy - fcy)
    const score = primary + secondary * 4 + align * 0.15
    if (score < bestScore) {
      bestScore = score
      best = n
    }
  }
  return best
}

function rangeGap(a1: number, a2: number, b1: number, b2: number): number {
  if (b2 < a1) return a1 - b2
  if (b1 > a2) return b1 - a2
  return 0
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

export const focusManager = new FocusManager()
