import { toast } from 'sonner'
import type { Element, ElementPatch, Rect } from '../../../model/types'
import { getSelectedElements, useEditor } from '../../../store/editor'
import { unionRects } from '../../../lib/pdf/geometry'
import { viewer } from '../../viewer/viewerApi'
import { clampDelta, moveBounds, type Size } from '../lib/geometry'
import { finishActiveTextEdit } from './textEdit'

/**
 * Editing commands shared by the keyboard shortcuts, the context toolbar and the items panel.
 * They operate on the store's current selection.
 */

export function pageSize(index: number): Size | null {
  const p = useEditor.getState().doc?.pages[index]
  return p ? { width: p.width, height: p.height } : null
}

export function elementRect(el: Element): Rect {
  return { x: el.x, y: el.y, width: el.width, height: el.height }
}

export function deleteSelection(): void {
  const s = useEditor.getState()
  const sel = getSelectedElements(s)
  if (!sel.length) return
  const deletable = sel.filter((e) => !e.locked)
  if (!deletable.length) {
    toast(sel.length === 1 ? 'This item is locked' : 'These items are locked', {
      description: sel.length === 1 ? 'Unlock it to delete it.' : 'Unlock them to delete them.',
    })
    return
  }
  finishActiveTextEdit()
  useEditor.getState().removeElements(deletable.map((e) => e.id))
}

export function duplicateSelection(): void {
  const s = useEditor.getState()
  if (!s.selection.length) return
  finishActiveTextEdit()
  useEditor.getState().duplicateElements(useEditor.getState().selection)
}

export function setLocked(ids: string[], locked: boolean): void {
  const patches: Record<string, ElementPatch> = {}
  for (const id of ids) patches[id] = { locked }
  useEditor.getState().updateElements(patches)
}

export function toggleLockSelection(): void {
  const sel = getSelectedElements()
  if (!sel.length) return
  const lock = !sel.every((e) => e.locked)
  setLocked(
    sel.map((e) => e.id),
    lock,
  )
}

export function reorderSelection(where: 'front' | 'back'): void {
  const s = useEditor.getState()
  if (s.selection.length) s.reorderElements(s.selection, where)
}

/** Arrow-key nudge; a burst of presses is one undo step. Locked items stay put. */
export function nudgeSelection(dx: number, dy: number): void {
  const s = useEditor.getState()
  const movable = getSelectedElements(s).filter((e) => !e.locked)
  if (!movable.length) return
  const items = movable.flatMap((e) => {
    const page = pageSize(e.page)
    return page ? [{ rect: elementRect(e), page }] : []
  })
  const d = clampDelta({ x: dx, y: dy }, moveBounds(items))
  if (d.x === 0 && d.y === 0) return
  const patches: Record<string, ElementPatch> = {}
  for (const e of movable) patches[e.id] = { x: e.x + d.x, y: e.y + d.y }
  s.updateElements(patches, { coalesce: 'nudge' })
}

export function selectAllOnPage(page: number): void {
  const s = useEditor.getState()
  finishActiveTextEdit()
  s.select(s.elements.filter((e) => e.page === page).map((e) => e.id))
}

/** Scrolls an element into view. */
export function revealElement(el: Element, behavior: ScrollBehavior = 'smooth'): void {
  viewer.scrollToRect(el.page, elementRect(el), { behavior, margin: 48 })
}

/** Union of the given elements on one page (view space). */
export function boundsOf(elements: readonly Element[]): Rect | null {
  return unionRects(elements.map(elementRect))
}
