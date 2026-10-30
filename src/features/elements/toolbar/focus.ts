import type { KeyboardEvent, MouseEvent } from 'react'
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

/** Arrow keys / Home / End move between the toolbar's controls (segmented groups handle their own). */
export function moveToolbarFocus(e: KeyboardEvent<HTMLElement>): void {
  if (e.defaultPrevented || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
  const t = e.target as HTMLElement
  if (t.closest('input, textarea, [role="slider"]')) return
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input')].filter((el) => el.offsetParent !== null)
  const i = items.indexOf(t)
  if (i < 0) return
  e.preventDefault()
  // Keep the editor from nudging the selection.
  e.stopPropagation()
  const n = items.length
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n
  items[next].focus()
}
