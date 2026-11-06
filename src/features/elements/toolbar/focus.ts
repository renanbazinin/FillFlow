import type { KeyboardEvent, MouseEvent } from 'react'
import type { Direction } from '../../../i18n'
import { useEditor } from '../../../store/editor'

/**
 * Toolbar buttons must not steal focus from the text being edited (that would commit the
 * edit). Inputs and sliders still take focus normally.
 */
export function keepEditorFocus(e: MouseEvent): void {
  const t = e.target as HTMLElement
  if (t.closest('input, textarea, select, [role="slider"]')) return
  e.preventDefault()
}

/** Radix auto-focus handlers that leave focus in the text editor while one is open. */
export function preventFocusWhileEditing(e: Event): void {
  if (useEditor.getState().editingId) e.preventDefault()
}

/**
 * Arrow keys / Home / End move between the toolbar's controls (segmented groups handle their own),
 * along the row as it is on screen: right to left (the toolbar is interface, so it mirrors), the
 * next control is the one on the left.
 */
export function moveToolbarFocus(e: KeyboardEvent<HTMLElement>): void {
  if (e.defaultPrevented || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
  const t = e.target as HTMLElement
  if (t.closest('input, textarea, [role="slider"]')) return
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')].filter((el) => el.offsetParent !== null)
  const i = items.indexOf(t)
  if (i < 0) return
  e.preventDefault()
  // Keep the editor from nudging the selection.
  e.stopPropagation()
  const dir = getComputedStyle(e.currentTarget).direction === 'rtl' ? 'rtl' : 'ltr'
  items[toolbarFocusIndex(e.key, i, items.length, dir)].focus()
}

/**
 * Which of a row of `n` controls (in document order, which runs the way the row reads) an arrow
 * key, Home or End moves to from control `i`. Arrows go round from one end to the other; right to
 * left, ArrowLeft goes to the next control.
 */
export function toolbarFocusIndex(key: string, i: number, n: number, dir: Direction): number {
  if (key === 'Home') return 0
  if (key === 'End') return n - 1
  const next = key === (dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight')
  return (i + (next ? 1 : -1) + n) % n
}
