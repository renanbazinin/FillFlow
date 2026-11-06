import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import type { ImageElement, InkElement, MarkElement, PageInfo, ShapeElement, TextElement } from '../../../model/types'
import { getSelectedElements, useEditor } from '../../../store/editor'
import { viewer } from '../../viewer/viewerApi'
import { boundsOf } from '../state/commands'
import { useElementsUi } from '../state/ui'
import { keepEditorFocus, moveToolbarFocus } from './focus'
import { ToolbarSeparator } from './parts'
import { PopoverPlacementContext } from './popoverSide'
import { intersectBoxes, placeToolbar, popoverSide, type ClientBox, type PopoverSide } from './position'
import { useScrollFades } from './scrollFades'
import { CommonActions, ImageControls, InkControls, MarkControls, ShapeControls, TextControls } from './sections'

/** Extra room around the selection so the bar clears the resize handles. */
const ANCHOR_PAD = 8

/**
 * Floating toolbar for the selection: style controls for the selected kind plus the common
 * actions. Rendered by the page layer that holds the (first) selected item, portaled to
 * <body>, and positioned imperatively so scrolling never re-renders it. Where it's too wide
 * (phones), the style controls scroll sideways behind edge fades while the actions stay put;
 * its popovers open away from the selection. On touch its buttons are 40px.
 */
export function ContextToolbar({ page, scale, rootRef }: { page: PageInfo; scale: number; rootRef: RefObject<HTMLDivElement | null> }) {
  const selected = useEditor(useShallow((s) => getSelectedElements(s)))
  const tool = useEditor((s) => s.tool)
  const interaction = useElementsUi((s) => s.interaction)
  const barRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<{ side: PopoverSide; over: boolean }>({ side: 'top', over: false })

  const onPage = selected.filter((e) => e.page === page.index)
  const box = boundsOf(onPage)
  const visible = tool === 'select' && interaction === 'idle' && box !== null
  const fades = useScrollFades(stripRef, visible)
  const bx = box?.x ?? 0
  const by = box?.y ?? 0
  const bw = box?.width ?? 0
  const bh = box?.height ?? 0
  const pageW = page.width

  /** The selection on screen now, with room for its handles. */
  const selectionBox = useCallback((): ClientBox | null => {
    const root = rootRef.current
    if (!root) return null
    const r = root.getBoundingClientRect()
    const k = r.width / pageW || 1
    return {
      left: r.left + bx * k - ANCHOR_PAD,
      top: r.top + by * k - ANCHOR_PAD,
      right: r.left + (bx + bw) * k + ANCHOR_PAD,
      bottom: r.top + (by + bh) * k + ANCHOR_PAD,
    }
  }, [rootRef, pageW, bx, by, bw, bh])

  useLayoutEffect(() => {
    const bar = barRef.current
    const root = rootRef.current
    if (!visible || !bar || !root) return
    let raf = 0
    const update = () => {
      raf = 0
      const anchor = selectionBox()
      if (!anchor) return
      const vv = window.visualViewport
      const viewport: ClientBox = vv
        ? { left: vv.offsetLeft, top: vv.offsetTop, right: vv.offsetLeft + vv.width, bottom: vv.offsetTop + vv.height }
        : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
      const sc = viewer.getScrollContainer()?.getBoundingClientRect()
      const bounds = sc ? intersectBoxes(viewport, { left: sc.left, top: sc.top, right: sc.right, bottom: sc.bottom }) : viewport
      const pos = placeToolbar(anchor, { width: bar.offsetWidth, height: bar.offsetHeight }, bounds)
      if (!pos) {
        bar.style.visibility = 'hidden'
        return
      }
      bar.style.visibility = ''
      bar.style.transform = `translate3d(${Math.round(pos.x)}px, ${Math.round(pos.y)}px, 0)`
      const side = popoverSide(pos, bar.offsetHeight, bounds)
      const over = pos.side === 'inside'
      setPlacement((prev) => (prev.side === side && prev.over === over ? prev : { side, over }))
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('scroll', schedule)
    const ro = new ResizeObserver(schedule)
    ro.observe(bar)
    ro.observe(root)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('scroll', schedule)
      ro.disconnect()
    }
  }, [visible, rootRef, selectionBox, scale])

  // Popovers open away from the selection; a bar sitting over it has nothing to keep clear.
  const popovers = useMemo(() => ({ side: placement.side, selection: placement.over ? () => null : selectionBox }), [placement, selectionBox])

  if (!visible) return null

  const kinds = new Set(selected.map((e) => e.kind))
  const kind = kinds.size === 1 ? selected[0].kind : null
  let controls = null
  if (kind === 'text') controls = <TextControls texts={selected as TextElement[]} />
  else if (kind === 'mark') controls = <MarkControls marks={selected as MarkElement[]} />
  else if (kind === 'shape') controls = <ShapeControls shapes={selected as ShapeElement[]} />
  else if (kind === 'ink') controls = <InkControls inks={selected as InkElement[]} />
  else if (kind === 'image') controls = <ImageControls images={selected as ImageElement[]} />

  const styled = controls !== null || selected.length > 1

  return createPortal(
    // The outer box is positioned imperatively; the inner one animates (transforms would clash).
    <div ref={barRef} className="fixed left-0 top-0 z-[60]" style={{ visibility: 'hidden' }} data-element-toolbar="">
      <PopoverPlacementContext value={popovers}>
        <div
          role="toolbar"
          aria-label={selected.length > 1 ? `${selected.length} items` : 'Item options'}
          onMouseDown={keepEditorFocus}
          onKeyDown={moveToolbarFocus}
          // Focus rings are drawn inside the controls: the style strip cuts off anything outside it.
          className="flex h-10 max-w-[calc(100vw-16px)] animate-scale-in items-center rounded-xl border border-line bg-surface px-1 text-fg shadow-float pointer-coarse:h-12 [&_:focus-visible]:-outline-offset-2"
        >
          <div
            ref={stripRef}
            data-toolbar-strip=""
            // A control the keyboard moves to is scrolled into view, clear of the fades (the bar
            // keeps pointer presses from taking focus).
            onFocus={(e) => e.target.scrollIntoView({ block: 'nearest', inline: 'nearest' })}
            className="min-w-0 scroll-px-10 overflow-x-auto overscroll-x-contain scrollbar-none"
            style={{ maskImage: fades, WebkitMaskImage: fades }}
          >
            <div className="flex w-max items-center gap-0.5 pointer-coarse:gap-1">
              {selected.length > 1 && (
                <span className="shrink-0 select-none px-2 text-[12px] font-medium tabular-nums text-fg-muted">{selected.length} items</span>
              )}
              {controls}
            </div>
          </div>
          {styled && <ToolbarSeparator />}
          <div className="flex shrink-0 items-center gap-0.5 pointer-coarse:gap-1">
            <CommonActions selected={selected} />
          </div>
        </div>
      </PopoverPlacementContext>
    </div>,
    document.body,
  )
}
