import { flushSync } from 'react-dom'
import type { TextElement } from '../../../model/types'
import { useEditor } from '../../../store/editor'

/**
 * Text editing sessions.
 *
 * A *new* text block (text tool click) is created inside a gesture, so creating it and typing
 * into it is a single undo step, and committing it empty leaves no trace in the history.
 * Editing an *existing* block records typing with `coalesce: 'text:<id>'`.
 */

interface Session {
  id: string
  isNew: boolean
}

export type CaretRequest = number | 'end' | 'all'

let session: Session | null = null
let pendingCaret: { id: string; caret: CaretRequest } | null = null
let textarea: { id: string; node: HTMLTextAreaElement } | null = null

/** Called by the mounted editor so a session can focus it synchronously (iOS keyboard). */
export function registerTextarea(id: string, node: HTMLTextAreaElement | null): void {
  if (node) textarea = { id, node }
  else if (textarea?.id === id) textarea = null
}

export function takePendingCaret(id: string): CaretRequest | null {
  if (!pendingCaret || pendingCaret.id !== id) return null
  const c = pendingCaret.caret
  pendingCaret = null
  return c
}

export function applyCaret(node: HTMLTextAreaElement, caret: CaretRequest): void {
  const len = node.value.length
  if (caret === 'all') node.setSelectionRange(0, len)
  else {
    const at = caret === 'end' ? len : Math.max(0, Math.min(caret, len))
    node.setSelectionRange(at, at)
  }
}

function focusTextarea(id: string, caret: CaretRequest | null) {
  const t = textarea
  if (!t || t.id !== id) return
  if (document.activeElement !== t.node) t.node.focus({ preventScroll: true })
  if (caret !== null) applyCaret(t.node, caret)
}

/** Adds a new, empty text block and starts typing into it. */
export function startNewText(el: TextElement): void {
  finishActiveTextEdit()
  const s = useEditor.getState()
  s.beginGesture()
  session = { id: el.id, isNew: true }
  pendingCaret = { id: el.id, caret: 'end' }
  flushSync(() => s.addElement(el, { edit: true }))
  focusTextarea(el.id, takePendingCaret(el.id))
}

/** Starts (or continues) editing an existing text block. */
export function editText(id: string, caret: CaretRequest = 'end'): void {
  const s = useEditor.getState()
  const el = s.elements.find((e) => e.id === id)
  if (!el || el.kind !== 'text') return
  if (s.editingId === id) {
    focusTextarea(id, caret)
    return
  }
  finishActiveTextEdit()
  session = { id, isNew: false }
  pendingCaret = { id, caret }
  flushSync(() => useEditor.getState().setEditing(id))
  focusTextarea(id, takePendingCaret(id))
}

/**
 * Ends editing `id`: empty (or whitespace-only) text removes the block. Safe to call more than
 * once and after the store already moved on (undo, tool change…).
 */
export function finishTextEdit(id: string): void {
  const isNew = session?.id === id && session.isNew
  if (session?.id === id) session = null
  if (pendingCaret?.id === id) pendingCaret = null
  const s = useEditor.getState()
  if (s.editingId === id) s.setEditing(null)
  const el = s.elements.find((e) => e.id === id)
  if (!el || el.kind !== 'text') {
    if (isNew) s.endGesture()
    return
  }
  if (!el.text.trim()) {
    if (isNew) {
      s.cancelGesture()
      useEditor.setState((st) => ({ selection: st.selection.filter((x) => x !== id) }))
    }
    // Still there (not new, or the gesture was already closed): remove it as a normal step.
    if (useEditor.getState().elements.some((e) => e.id === id)) useEditor.getState().removeElements([id])
    return
  }
  if (isNew) s.endGesture()
}

/** Commits whatever text block is being edited, if any. */
export function finishActiveTextEdit(): void {
  const id = useEditor.getState().editingId ?? session?.id
  if (id) finishTextEdit(id)
}

export function isEditingText(): boolean {
  return useEditor.getState().editingId !== null
}
