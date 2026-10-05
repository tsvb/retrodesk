import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react'
import { focusManager } from '../input/focus'
import { useFocusable } from '../input/hooks'
import type { ActionMap, Direction, InputSource } from '../input/types'
import { useInputStore } from '../stores/input'
import { prefersReducedMotion } from '../input/focus'

export interface VirtualGridProps<T> {
  items: T[]
  getKey: (item: T) => string
  renderCell: (item: T, focused: boolean, index: number) => ReactNode
  layout: 'grid' | 'list'
  /** Minimum cell width in rem (grid layout). */
  minCellRem: number
  /** Cell height as a multiple of its width (grid) — includes the caption. */
  cellAspect: number
  /** Extra fixed height in rem added to each grid cell (caption). */
  captionRem?: number
  /** Row height in rem for the list layout. */
  listRowRem?: number
  gapRem?: number
  index: number
  onIndexChange: (i: number) => void
  onActivate: (item: T, index: number) => void
  /** Label for the confirm hint. */
  activateLabel?: string
  /** Per-item action bindings (favourite etc.). */
  itemActions?: (item: T) => ActionMap
  /** Bindings for LT/RT. Defaults to page up/down. */
  pageActions?: ActionMap
  autoFocus?: boolean
  className?: string
  /** Called once with an imperative scroller handle. */
  onReady?: (api: VirtualGridApi) => void
}

export interface VirtualGridApi {
  jumpTo: (index: number, source?: InputSource | 'program') => void
  visibleRows: () => number
  columns: () => number
}

const OVERSCAN_ROWS = 2

/**
 * Virtualised, controller-navigable grid/list. The whole grid is ONE focus node: it handles directions
 * internally and lets the spatial navigator take over at its edges (e.g. up from the first row reaches
 * the header controls). Only the visible rows (+ overscan) are rendered, so 5,000+ items stay smooth.
 */
export function VirtualGrid<T>(props: VirtualGridProps<T>) {
  const {
    items,
    getKey,
    renderCell,
    layout,
    minCellRem,
    cellAspect,
    captionRem = 0,
    listRowRem = 4.2,
    gapRem = 1.4,
    index,
    onIndexChange,
    onActivate,
    itemActions,
    pageActions,
    autoFocus,
    className = '',
    activateLabel = 'Open'
  } = props
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [scrollTop, setScrollTop] = useState(0)
  const [remPx, setRemPx] = useState(16)

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const measure = () => {
      setRemPx(parseFloat(getComputedStyle(document.documentElement).fontSize) || 16)
      const cs = getComputedStyle(el)
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
      setSize({ w: el.clientWidth - padX, h: el.clientHeight })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const gap = gapRem * remPx
  const geo = useMemo(() => {
    if (layout === 'list') {
      const rowH = listRowRem * remPx
      return { cols: 1, cellW: size.w, cellH: rowH, rowH: rowH + gap * 0.35 }
    }
    const minW = minCellRem * remPx
    const cols = Math.max(1, Math.floor((size.w + gap) / (minW + gap)))
    const cellW = cols > 0 ? (size.w - gap * (cols - 1)) / cols : minW
    const cellH = cellW * cellAspect + captionRem * remPx
    return { cols, cellW, cellH, rowH: cellH + gap }
  }, [layout, size.w, remPx, gap, minCellRem, cellAspect, captionRem, listRowRem])

  const rows = Math.ceil(items.length / geo.cols)
  const padTop = remPx * 1.2
  const totalH = rows * geo.rowH + padTop * 2
  // Rendered row range. Scroll events only update state when this range changes, not on every pixel.
  const firstRowAt = (top: number) => Math.max(0, Math.floor((top - padTop) / geo.rowH) - OVERSCAN_ROWS)
  const lastRowAt = (top: number) => Math.ceil((top + size.h) / geo.rowH) + OVERSCAN_ROWS
  const firstRow = firstRowAt(scrollTop)
  const lastRow = Math.min(rows - 1, lastRowAt(scrollTop))
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop
    if (firstRowAt(top) !== firstRow || lastRowAt(top) !== lastRowAt(scrollTop)) setScrollTop(top)
  }
  // The geometry changed (resize, density): re-read the real scroll position for the new rows.
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (el) setScrollTop(el.scrollTop)
  }, [geo])

  const lastEnsure = useRef(0)
  const idx = Math.min(Math.max(0, index), Math.max(0, items.length - 1))
  const idxRef = useRef(idx)
  idxRef.current = idx

  const cellRect = useCallback(
    (i: number): DOMRect => {
      const el = scrollerRef.current
      const base = el?.getBoundingClientRect() ?? new DOMRect()
      const padL = el ? parseFloat(getComputedStyle(el).paddingLeft) : 0
      const r = Math.floor(i / geo.cols)
      const c = i % geo.cols
      const x = base.left + padL + c * (geo.cellW + gap)
      const y = base.top + padTop + r * geo.rowH - (el?.scrollTop ?? 0)
      return new DOMRect(x, y, geo.cellW, geo.cellH)
    },
    [geo, gap, padTop]
  )

  const ensureVisible = useCallback(
    (i: number, smooth: boolean) => {
      const el = scrollerRef.current
      if (!el) return
      const r = Math.floor(i / geo.cols)
      const top = padTop + r * geo.rowH
      const bottom = top + geo.cellH
      const margin = Math.min(geo.rowH * 0.45, el.clientHeight * 0.2)
      let target: number | null = null
      if (top - margin < el.scrollTop) target = top - margin
      else if (bottom + margin > el.scrollTop + el.clientHeight) target = bottom + margin - el.clientHeight
      // Held directions repeat every ~80ms: smooth scrolling would lag behind, so only animate isolated moves.
      const now = performance.now()
      const rapid = now - lastEnsure.current < 160
      lastEnsure.current = now
      if (target !== null) el.scrollTo({ top: Math.max(0, target), behavior: smooth && !rapid && !prefersReducedMotion() ? 'smooth' : 'auto' })
    },
    [geo, padTop]
  )

  const setIndex = useCallback(
    (i: number, source: InputSource | 'program', smooth = true) => {
      const clamped = Math.min(Math.max(0, i), items.length - 1)
      if (clamped < 0) return
      onIndexChange(clamped)
      if (source !== 'mouse') ensureVisible(clamped, smooth)
    },
    [items.length, onIndexChange, ensureVisible]
  )

  const handleDirection = (dir: Direction): boolean => {
    const i = idxRef.current
    const { cols } = geo
    const col = i % cols
    switch (dir) {
      case 'left':
        if (col === 0) return false
        setIndex(i - 1, 'pad')
        return true
      case 'right':
        if (col === cols - 1 || i + 1 >= items.length) return false
        setIndex(i + 1, 'pad')
        return true
      case 'up':
        if (i - cols < 0) return false
        setIndex(i - cols, 'pad')
        return true
      case 'down': {
        if (i + cols < items.length) {
          setIndex(i + cols, 'pad')
          return true
        }
        // Partial last row: drop to the last item if we are not already on the last row.
        const lastRowStart = Math.floor((items.length - 1) / cols) * cols
        if (i < lastRowStart) {
          setIndex(items.length - 1, 'pad')
          return true
        }
        return false
      }
    }
  }

  const visibleRows = () => Math.max(1, Math.floor((scrollerRef.current?.clientHeight ?? size.h) / geo.rowH))
  const page = (delta: number) => setIndex(idxRef.current + delta * visibleRows() * geo.cols, 'pad', false)

  const current = items[idx]
  const focusable = useFocusable<HTMLDivElement>({
    autoFocus,
    scroll: 'none',
    disabled: items.length === 0,
    label: activateLabel,
    handleDirection,
    getRect: () => cellRect(idxRef.current),
    onActivate: current ? () => onActivate(current, idx) : undefined,
    onFocus: (source) => {
      if (source !== 'mouse') ensureVisible(idxRef.current, true)
    },
    actions: {
      pageUp: { label: 'Page up', run: () => page(-1) },
      pageDown: { label: 'Page down', run: () => page(1) },
      ...pageActions,
      ...(current && itemActions ? itemActions(current) : {})
    }
  })
  // Cells handle pointer input themselves; the scroller only needs the ref and marker attribute.
  const focusRef = focusable.props.ref

  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      scrollerRef.current = el
      focusRef(el)
    },
    [focusRef]
  )

  // Expose an imperative API (letter jumping lives in the screen).
  const apiRef = useRef<VirtualGridApi | null>(null)
  apiRef.current = {
    jumpTo: (i, source = 'pad') => setIndex(i, source === 'program' ? 'program' : source, false),
    visibleRows,
    columns: () => geo.cols
  }
  const onReady = props.onReady
  useEffect(() => {
    onReady?.({
      jumpTo: (i, s) => apiRef.current?.jumpTo(i, s),
      visibleRows: () => apiRef.current?.visibleRows() ?? 1,
      columns: () => apiRef.current?.columns() ?? 1
    })
  }, [onReady])

  // Keep the focused cell in view when the layout changes (resize, density, view toggle).
  useEffect(() => {
    if (focusable.focused) ensureVisible(idxRef.current, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.cols, layout])

  const cells: ReactNode[] = []
  if (size.w > 0) {
    for (let r = firstRow; r <= lastRow; r++) {
      for (let c = 0; c < geo.cols; c++) {
        const i = r * geo.cols + c
        const item = items[i]
        if (item === undefined) break
        const x = c * (geo.cellW + gap)
        const y = padTop + r * geo.rowH
        const isFocused = focusable.focused && i === idx
        cells.push(
          <div
            key={getKey(item)}
            className={`vgrid__cell ${isFocused ? 'is-focused' : ''} ${i === idx ? 'is-current' : ''}`}
            style={{ transform: `translate(${x}px, ${y}px)`, width: geo.cellW, height: geo.cellH }}
            onPointerMove={(e) => {
              if (e.pointerType !== 'mouse') return
              if (e.movementX === 0 && e.movementY === 0) return
              useInputStore.getState().setSource('mouse')
              if (idxRef.current !== i) onIndexChange(i)
              if (!focusable.focused) focusManager.focus(focusable.id, { source: 'mouse' })
            }}
            onClick={() => {
              onIndexChange(i)
              focusManager.focus(focusable.id, { source: 'mouse' })
              onActivate(item, i)
            }}
          >
            {renderCell(item, isFocused, i)}
          </div>
        )
      }
    }
  }

  return (
    <div ref={setRefs} className={`vgrid vgrid--${layout} ${className}`} onScroll={onScroll} data-focusable="">
      <div className="vgrid__inner" style={{ height: totalH }}>
        {cells}
      </div>
    </div>
  )
}
