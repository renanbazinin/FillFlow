import { createImageElement } from '../../model/elements'
import type { Rect } from '../../model/types'
import { useEditor, type EditorState } from '../../store/editor'
import { widgetSigned } from './signed'

/**
 * "Sign here": clicking a signature field opens the signature dialog and remembers the field.
 * When the dialog arms placement (tool = signature/initials with a `placingAssetId`), we place
 * that asset ourselves, fitted inside the field, instead of waiting for a click on the page.
 * If the dialog closes without arming placement, the pending target is dropped.
 */

interface Target {
  page: number
  rect: Rect
}

let pending: Target | null = null
let unsubscribe: (() => void) | null = null
let closeTimer: ReturnType<typeof setTimeout> | undefined

function clear() {
  pending = null
  unsubscribe?.()
  unsubscribe = null
  clearTimeout(closeTimer)
}

/** Fits an asset (contain, centered) inside a rect. */
export function fitInside(rect: Rect, aspect: number): { center: { x: number; y: number }; width: number } {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 3
  let width = rect.width
  if (width / a > rect.height) width = rect.height * a
  return { center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, width }
}

function place(s: EditorState, target: Target) {
  const assetId = s.placingAssetId!
  const role = s.tool === 'initials' ? 'initials' : 'signature'
  const asset = s.assets[assetId]
  const aspect = asset ? asset.width / asset.height : 3
  const { center, width } = fitInside(target.rect, aspect)
  const el = createImageElement(target.page, center, role, assetId, aspect, width)
  // Signing a field again replaces the signature that's already in it (one undo step).
  const previous = s.elements.filter((e) => widgetSigned([e], target)).map((e) => e.id)
  const store = useEditor.getState()
  store.beginGesture()
  if (previous.length) store.removeElements(previous)
  store.addElement(el)
  store.endGesture()
  store.setTool('select')
}

function onChange(s: EditorState, prev: EditorState) {
  const target = pending
  if (!target) return
  if (s.doc !== prev.doc) return clear()
  if ((s.tool === 'signature' || s.tool === 'initials') && s.placingAssetId) {
    clear()
    place(s, target)
    return
  }
  const dialogWas = prev.activeDialog === 'signature' || prev.activeDialog === 'initials'
  const dialogIs = s.activeDialog === 'signature' || s.activeDialog === 'initials'
  if (dialogWas && !dialogIs) {
    // The dialog may arm placement right after closing; give it a moment.
    clearTimeout(closeTimer)
    closeTimer = setTimeout(() => {
      const now = useEditor.getState()
      if (pending && !now.placingAssetId) clear()
    }, 600)
  } else if (s.activeDialog && !dialogIs) {
    clear()
  }
}

/** Opens the signature dialog for a signature field on `page` at `rect` (view space). */
export function requestSignatureFor(page: number, rect: Rect): void {
  clear()
  pending = { page, rect }
  unsubscribe = useEditor.subscribe(onChange)
  const s = useEditor.getState()
  if (s.tool !== 'select') s.setTool('select')
  s.openDialog('signature')
}

/** Whether a "Sign here" request is waiting for a signature. */
export function hasPendingSignature(): boolean {
  return pending !== null
}
