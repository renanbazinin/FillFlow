import { flushSync } from 'react-dom'
import { toast } from 'sonner'
import { firstStrongDirection } from '../../../lib/text/direction'
import { withTextLayout } from '../../../model/elements'
import type { TextElement } from '../../../model/types'
import { useEditor } from '../../../store/editor'

/**
 * Text editing sessions.
 *
 * A *new* text block (text tool click) is created inside a gesture, so creating it and typing
 * into it is a single undo step, and committing it empty leaves no trace in the history.
 * Editing an *existing* block records typing with `coalesce: 'text:<id>'`; committing it empty
 * removes it as part of the typing's undo step (a locked block gets its text back instead).
 */

interface Session {
  id: string
  isNew: boolean
  /** The text when editing began. */
  before: string
  /** Where a new block was started (its left edge, at the click). */
  origin?: number
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

/** Whether an editor for `id` is mounted. */
export function hasTextarea(id: string): boolean {
  return textarea?.id === id
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

/**
 * Focuses the editor for `id` with the pending caret. When its page layer isn't mounted yet
 * (large documents), the caret stays pending for the editor to apply when it mounts.
 */
function focusWithPendingCaret(id: string) {
  if (hasTextarea(id)) focusTextarea(id, takePendingCaret(id))
}

/** Adds a new, empty text block and starts typing into it. */
export function startNewText(el: TextElement): void {
  finishActiveTextEdit()
  const s = useEditor.getState()
  s.beginGesture()
  session = { id: el.id, isNew: true, before: el.text, origin: el.x }
  pendingCaret = { id: el.id, caret: 'end' }
  flushSync(() => s.addElement(el, { edit: true }))
  focusWithPendingCaret(el.id)
}

/**
 * The text of the block being edited changed (typing, pasting, deleting). A new block whose text
 * turns out to run right to left (Hebrew, Arabic…) right-aligns with its right edge where it was
 * started, so it grows leftwards from there like the line it is typed on. Only while it is still
 * left-aligned: an alignment chosen for it stays.
 */
export function setEditedText(id: string, text: string): void {
  const s = useEditor.getState()
  const el = s.elements.find((e) => e.id === id)
  if (!el || el.kind !== 'text') return
  const opts = { coalesce: `text:${id}` }
  const own = session?.id === id ? session : null
  if (own?.isNew && own.origin !== undefined && el.align === 'left' && !firstStrongDirection(el.text) && firstStrongDirection(text) === 'rtl') {
    const laid = withTextLayout({ ...el, text, align: 'right', x: own.origin, width: 0 })
    s.updateElement(id, { text, align: 'right', x: laid.x, width: laid.width, height: laid.height }, opts)
    return
  }
  s.updateElement(id, { text }, opts)
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
  session = { id, isNew: false, before: el.text }
  pendingCaret = { id, caret }
  flushSync(() => useEditor.getState().setEditing(id))
  focusWithPendingCaret(id)
}

/**
 * Ends editing `id`: empty (or whitespace-only) text removes the block. Safe to call more than
 * once and after the store already moved on (undo, tool change…).
 */
export function finishTextEdit(id: string): void {
  const own = session?.id === id ? session : null
  if (own) session = null
  if (pendingCaret?.id === id) pendingCaret = null
  const isNew = !!own?.isNew
  const s = useEditor.getState()
  if (s.editingId === id) s.setEditing(null)
  const el = s.elements.find((e) => e.id === id)
  if (!el || el.kind !== 'text' || el.text.trim()) {
    if (isNew) s.endGesture()
    return
  }
  if (isNew) {
    // Drop just the block, so nothing else changed meanwhile is lost (normally nothing was, and
    // the gesture records no step). A block that was never committed can't stay locked.
    if (el.locked) s.updateElement(id, { locked: false })
    useEditor.getState().removeElements([id])
    useEditor.getState().endGesture()
    return
  }
  if (el.locked) {
    // Locked items can't be deleted: the text comes back.
    if (!own?.before.trim()) return
    s.updateElement(id, { text: own.before }, { history: false })
    toast('This item is locked', { description: 'Unlock it to delete it.' })
    return
  }
  // Emptied by typing: removing it is part of the undo step that still shows its text, so one
  // undo brings the text back. (Already empty before: a step of its own.)
  const { past } = useEditor.getState()
  const shown = past[past.length - 1]?.elements.some((e) => e.id === id && e.kind === 'text' && !!e.text.trim())
  useEditor.getState().removeElements([id], shown ? { history: false } : undefined)
}

/** Commits whatever text block is being edited, if any. */
export function finishActiveTextEdit(): void {
  const id = useEditor.getState().editingId ?? session?.id
  if (id) finishTextEdit(id)
}

export function isEditingText(): boolean {
  return useEditor.getState().editingId !== null
}
