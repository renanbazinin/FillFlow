import { useEffect, useState, type RefObject } from 'react'
import type { Element as Item, ElementPatch, PageInfo, Rect } from '../../../model/types'
import { useEditor } from '../../../store/editor'
import { rectFromPoints } from '../../../lib/pdf/geometry'
import { viewer } from '../../viewer/viewerApi'
import { caretIndexAt } from '../lib/caret'
import { clampDelta, elementsInMarquee, fitRectInPage, moveBounds, type HandleId } from '../lib/geometry'
import { resizeElementPatch, sizeReadout, type GrabTarget } from '../lib/resize'
import { buildSnapTargets, snapMove, type Guide, type SnapTargets } from '../lib/snap'
import type { SizeReadout } from '../render/SelectionOverlay'
import { boundsOf, elementRect, pageSize } from '../state/commands'
import { editText, finishActiveTextEdit } from '../state/textEdit'
import { clearHovered, setContextMenu, setDropPreview, setHovered, setInteraction, useElementsUi } from '../state/ui'
import { clientToLocal, dragThreshold, isPanning, trackPointer, type PointerSample, type TrackDisposer } from './pointer'

/** Smart-guide snapping distance in screen px. */
const SNAP_PX = 5
const DOUBLE_CLICK_MS = 450

export interface SelectOverlayState {
  marquee: Rect | null
  guides: Guide[]
  readout: SizeReadout | null
  /** Elements are being dragged (handles and the hover outline are hidden). */
  moving: boolean
}

interface MoveSnapshot {
  moving: Item[]
  bounds: ReturnType<typeof moveBounds>
  /** Union of the moving elements on this page (what snaps). */
  group: Rect | null
  targets: SnapTargets
  /** The only moving element, when a single one is dragged (it may change pages). */
  single: Item | null
  /** Pointer offset inside `single`. */
  grab: { x: number; y: number }
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i])

/**
 * Presses the layer already handled. The pressed node can leave the DOM mid-dispatch (e.g. a
 * double-click swaps the text for its editor), so containment checks alone aren't enough.
 */
const handledPresses = new WeakSet<Event>()

/**
 * Select-tool interactions for one page: pressing/dragging elements (with smart guides and
 * cross-page drops), resize handles, line endpoints, double-click to edit text, hover, and —
 * through a listener on the page frame — click-to-deselect and marquee selection.
 */
export function useSelectInteractions(page: PageInfo, rootRef: RefObject<HTMLDivElement | null>): SelectOverlayState {
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [guides, setGuides] = useState<Guide[]>([])
  const [readout, setReadout] = useState<SizeReadout | null>(null)
  const [moving, setMoving] = useState(false)

  const pageIndex = page.index
  const pageW = page.width
  const pageH = page.height

  useEffect(() => {
    const root = rootRef.current
    const frame = root?.closest<HTMLElement>('[data-page-index]') ?? root?.parentElement
    if (!root || !frame) return
    const size = { width: pageW, height: pageH }
    let dispose: TrackDisposer | null = null
    let lastPress: { id: string; time: number; x: number; y: number } | null = null

    const toLocal = (x: number, y: number) => clientToLocal(root, pageW, pageH, x, y)
    /** Points per CSS px at the current (possibly transformed) zoom. */
    const ptPerPx = () => {
      const r = root.getBoundingClientRect()
      return r.width ? pageW / r.width : 1
    }

    // --- moving ------------------------------------------------------------

    function prepareMove(pressed: Item, ids: string[], grabX: number, grabY: number): MoveSnapshot | null {
      const s = useEditor.getState()
      const idSet = new Set(ids)
      const movingEls = s.elements.filter((x) => idSet.has(x.id) && !x.locked)
      if (!movingEls.length) return null
      const pages = s.doc?.pages ?? []
      const items = movingEls.flatMap((m) => (pages[m.page] ? [{ rect: elementRect(m), page: pages[m.page] }] : []))
      const onPage = movingEls.filter((m) => m.page === pressed.page)
      const others = s.elements.filter((x) => x.page === pressed.page && !idSet.has(x.id))
      const single = movingEls.length === 1 && movingEls[0].id === pressed.id ? movingEls[0] : null
      return {
        moving: movingEls,
        bounds: moveBounds(items),
        group: boundsOf(onPage),
        targets: buildSnapTargets(others.map(elementRect), size),
        single,
        grab: { x: grabX - pressed.x, y: grabY - pressed.y },
      }
    }

    function applyMove(snap: MoveSnapshot, startX: number, startY: number, p: PointerSample) {
      const cur = toLocal(p.clientX, p.clientY)
      let d = { x: cur.x - startX, y: cur.y - startY }
      let gs: Guide[] = []
      let dropping = false
      if (snap.single) {
        const hit = viewer.clientToPage(p.clientX, p.clientY)
        const target = hit && hit.page !== pageIndex ? pageSize(hit.page) : null
        if (hit && target) {
          dropping = true
          const el = snap.single
          const r = fitRectInPage({ x: hit.x - snap.grab.x, y: hit.y - snap.grab.y, width: el.width, height: el.height }, target)
          setDropPreview({ page: hit.page, element: { ...el, page: hit.page, x: r.x, y: r.y } })
        } else setDropPreview(null)
      }
      if (snap.group && !p.altKey && !dropping) {
        const raw = { ...snap.group, x: snap.group.x + d.x, y: snap.group.y + d.y }
        const res = snapMove(raw, snap.targets, SNAP_PX * ptPerPx())
        d = { x: d.x + res.dx, y: d.y + res.dy }
        gs = res.guides
      }
      const clamped = clampDelta(d, snap.bounds)
      gs = gs.filter((g) => (g.axis === 'x' ? clamped.x === d.x : clamped.y === d.y))
      const patches: Record<string, ElementPatch> = {}
      for (const m of snap.moving) patches[m.id] = { x: m.x + clamped.x, y: m.y + clamped.y }
      useEditor.getState().updateElements(patches)
      setGuides(gs)
    }

    function endMove() {
      setDropPreview(null)
      setGuides([])
      setMoving(false)
      setInteraction('idle')
    }

    /** Lands the drag: onto the page under the pointer if it's a cross-page drop. */
    function commitMove(snap: MoveSnapshot) {
      const drop = useElementsUi.getState().dropPreview
      if (drop && snap.single && drop.element.id === snap.single.id) {
        useEditor.getState().updateElement(snap.single.id, { page: drop.page, x: drop.element.x, y: drop.element.y })
      }
      useEditor.getState().endGesture()
      endMove()
    }

    function pressElement(e: PointerEvent, id: string) {
      const s = useEditor.getState()
      const el = s.elements.find((x) => x.id === id)
      if (!el || s.editingId === id) return
      finishActiveTextEdit()
      const additive = e.shiftKey || e.ctrlKey || e.metaKey
      const prev = lastPress
      lastPress = { id, time: e.timeStamp, x: e.clientX, y: e.clientY }
      const isDouble =
        !additive && !!prev && prev.id === id && e.timeStamp - prev.time < DOUBLE_CLICK_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 10
      if (isDouble && el.kind === 'text') {
        lastPress = null
        // Keep the browser from moving focus (or synthesizing mouse events) after we focus the editor.
        e.preventDefault()
        const local = toLocal(e.clientX, e.clientY)
        editText(id, caretIndexAt(el.text, el, el.align, { x: local.x - el.x, y: local.y - el.y }))
        return
      }
      const wasSelected = useEditor.getState().selection.includes(id)
      if (additive) {
        useEditor.getState().select([id], 'toggle')
        if (wasSelected) return
      } else if (!wasSelected) useEditor.getState().select([id])
      const ids = useEditor.getState().selection
      const collapseOnClick = !additive && wasSelected && ids.length > 1
      const start = toLocal(e.clientX, e.clientY)
      const threshold = dragThreshold(e.pointerType)
      let snap: MoveSnapshot | null = null
      let dragging = false
      dispose?.()
      dispose = trackPointer(
        e,
        {
          move(p) {
            if (!dragging) {
              if (Math.hypot(p.clientX - e.clientX, p.clientY - e.clientY) < threshold) return
              snap = prepareMove(el, ids, start.x, start.y)
              if (!snap) return
              dragging = true
              useEditor.getState().beginGesture()
              setInteraction('move')
              setMoving(true)
              setHovered(null)
            }
            if (snap) applyMove(snap, start.x, start.y, p)
          },
          up() {
            dispose = null
            if (!dragging || !snap) {
              if (collapseOnClick) useEditor.getState().select([id])
              return
            }
            commitMove(snap)
          },
          cancel() {
            dispose = null
            if (dragging) {
              useEditor.getState().cancelGesture()
              endMove()
            }
          },
          detach() {
            dispose = null
            if (dragging && snap) commitMove(snap)
          },
        },
        { capture: e.target as Element, modifiers: true, autoScroll: true },
      )
    }

    // --- resizing ----------------------------------------------------------

    function pressHandle(e: PointerEvent, id: string, target: GrabTarget) {
      const s = useEditor.getState()
      const el = s.elements.find((x) => x.id === id)
      if (!el || el.locked) return
      finishActiveTextEdit()
      const start = toLocal(e.clientX, e.clientY)
      useEditor.getState().beginGesture()
      setInteraction('resize')
      setHovered(null)
      setReadout({ id, text: sizeReadout(el) })
      const done = () => {
        dispose = null
        setReadout(null)
        setInteraction('idle')
      }
      dispose?.()
      dispose = trackPointer(
        e,
        {
          move(p) {
            const cur = toLocal(p.clientX, p.clientY)
            const patch = resizeElementPatch(el, target, { x: cur.x - start.x, y: cur.y - start.y }, p.shiftKey, size)
            useEditor.getState().updateElement(id, patch)
            const next = useEditor.getState().elements.find((x) => x.id === id)
            if (next) setReadout({ id, text: sizeReadout(next) })
          },
          up() {
            useEditor.getState().endGesture()
            done()
          },
          cancel() {
            useEditor.getState().cancelGesture()
            done()
          },
          detach() {
            useEditor.getState().endGesture()
            done()
          },
        },
        { capture: e.target as Element, modifiers: true },
      )
    }

    // --- presses inside the layer (elements, handles) -------------------------

    function onRootPointerDown(e: PointerEvent) {
      handledPresses.add(e)
      if (useEditor.getState().tool !== 'select' || isPanning() || !e.isPrimary || e.button !== 0) return
      const t = e.target as HTMLElement | SVGElement
      const handle = t.closest('[data-handle]')
      if (handle) {
        const id = handle.getAttribute('data-handle-for')
        const which = handle.getAttribute('data-handle') as HandleId | 'p0' | 'p1' | null
        if (id && which) pressHandle(e, id, which)
        return
      }
      const node = t.closest('[data-element-id]')
      if (node && t.closest('[data-hit]')) pressElement(e, node.getAttribute('data-element-id')!)
    }

    // --- presses on the empty page (deselect, marquee) ------------------------

    function onFramePointerDown(e: PointerEvent) {
      const s = useEditor.getState()
      if (s.tool !== 'select' || isPanning() || !e.isPrimary || e.button !== 0) return
      const t = e.target as HTMLElement
      if (handledPresses.has(e) || !t.isConnected || root!.contains(t)) return
      const additive = e.shiftKey || e.ctrlKey || e.metaKey
      if (t.closest('[data-form-field]')) {
        // Filling a form field: drop the item selection so its toolbar gets out of the way.
        if (!additive) s.clearSelection()
        return
      }
      if (t.closest('a[href], button, input, select, textarea, [contenteditable="true"]')) return
      finishActiveTextEdit()
      if (e.pointerType === 'touch') {
        // One finger on the page scrolls natively; a tap (no scroll) clears the selection.
        if (additive) return
        dispose?.()
        dispose = trackPointer(
          e,
          {
            up(p) {
              dispose = null
              if (Math.hypot(p.clientX - e.clientX, p.clientY - e.clientY) < 10) useEditor.getState().clearSelection()
            },
            cancel() {
              dispose = null
            },
          },
          { escapeCancels: false },
        )
        return
      }
      if (!additive) useEditor.getState().clearSelection()
      const base = additive ? useEditor.getState().selection : []
      const start = toLocal(e.clientX, e.clientY)
      let active = false
      const stop = () => {
        dispose = null
        if (!active) return
        setMarquee(null)
        setInteraction('idle')
      }
      dispose?.()
      dispose = trackPointer(
        e,
        {
          move(p) {
            if (!active) {
              if (Math.hypot(p.clientX - e.clientX, p.clientY - e.clientY) < dragThreshold(p.pointerType)) return
              active = true
              window.getSelection()?.removeAllRanges()
              setInteraction('marquee')
              setHovered(null)
            }
            const cur = toLocal(p.clientX, p.clientY)
            const r = rectFromPoints(
              { x: Math.max(0, Math.min(start.x, pageW)), y: Math.max(0, Math.min(start.y, pageH)) },
              { x: Math.max(0, Math.min(cur.x, pageW)), y: Math.max(0, Math.min(cur.y, pageH)) },
            )
            setMarquee(r)
            const st = useEditor.getState()
            const hits = elementsInMarquee(
              st.elements.filter((x) => x.page === pageIndex),
              r,
            )
            const next = [...new Set([...base, ...hits])]
            if (!sameIds(next, st.selection)) st.select(next)
          },
          up: stop,
          detach: stop,
          cancel() {
            if (active) useEditor.getState().select(base)
            stop()
          },
        },
        { capture: frame, autoScroll: true },
      )
    }

    // --- right-click menu ---------------------------------------------------

    function onContextMenu(e: MouseEvent) {
      if (useEditor.getState().tool !== 'select' || useElementsUi.getState().interaction !== 'idle') return
      const t = e.target as Element
      const node = t.closest('[data-hit]') ? t.closest('[data-element-id]') : null
      if (!node) return
      e.preventDefault()
      const id = node.getAttribute('data-element-id')!
      finishActiveTextEdit()
      if (!useEditor.getState().selection.includes(id)) useEditor.getState().select([id])
      setContextMenu({ page: pageIndex, x: e.clientX, y: e.clientY })
    }

    // --- hover -------------------------------------------------------------

    function onOver(e: PointerEvent) {
      if (e.pointerType === 'touch' || useEditor.getState().tool !== 'select') return
      if (useElementsUi.getState().interaction !== 'idle') return
      const node = (e.target as Element).closest('[data-element-id]')
      if (node && (e.target as Element).closest('[data-hit]')) setHovered(node.getAttribute('data-element-id'))
    }

    function onOut(e: PointerEvent) {
      const node = (e.target as Element).closest('[data-element-id]')
      if (!node) return
      const to = e.relatedTarget as Node | null
      if (to && node.contains(to)) return
      clearHovered(node.getAttribute('data-element-id')!)
    }

    root.addEventListener('pointerdown', onRootPointerDown)
    root.addEventListener('pointerover', onOver)
    root.addEventListener('pointerout', onOut)
    root.addEventListener('contextmenu', onContextMenu)
    frame.addEventListener('pointerdown', onFramePointerDown)
    return () => {
      root.removeEventListener('pointerdown', onRootPointerDown)
      root.removeEventListener('pointerover', onOver)
      root.removeEventListener('pointerout', onOut)
      root.removeEventListener('contextmenu', onContextMenu)
      frame.removeEventListener('pointerdown', onFramePointerDown)
      dispose?.('detach')
    }
  }, [rootRef, pageIndex, pageW, pageH])

  return { marquee, guides, readout, moving }
}
