import { flushSync } from 'react-dom'
import { toast } from 'sonner'
import { firstStrongDirection } from '../../../lib/text/direction'
import { keepTextInPage, TEXT_ANCHOR, withTextLayout } from '../../../model/elements'
import type { ElementPatch, TextElement } from '../../../model/types'
import { COALESCE_MS, useEditor, type EditorState } from '../../../store/editor'

/**
 * Text editing sessions.
 *
 * A *new* text block (text tool click) is created inside a gesture, so creating it and typing
 * into it is a single undo step, and committing it empty leaves no trace in the history.
 * Editing an *existing* block records typing with `coalesce: 'text:<id>'`; committing it empty
 * removes it as part of the typing's undo step (a locked block gets its text back instead).
 *
 * Undo and redo while typing (`undoTextEdit`, `redoTextEdit`) go through what was done since
 * editing began, a burst of typing (or a paste) at a time, and the caret stays in the box, as in
 * any text box; nothing from before is reached that way. For an existing block those are the
 * editor's own undo steps; a new block keeps its own until it is committed.
 */

/** A new block as it was before a burst of typing: its text, and where and how it stood. */
type Snapshot = Pick<TextElement, 'text' | 'align' | 'x' | 'y' | 'width'>

type HistoryStep = EditorState['past'][number]

interface Session {
  id: string
  isNew: boolean
  /** The text when editing began. */
  before: string
  /** Where a new block was started (the click): the side it grows from, by its alignment. */
  origin?: number
  /** New block: how it was before each burst of typing (latest last), and what undoing took back. */
  undo: Snapshot[]
  redo: Snapshot[]
  /** New block: when it was last typed into; -Infinity when what comes next starts a burst of its own. */
  typedAt: number
  /** Existing block: the editor's latest undo step when editing began (never undone while typing). */
  floor: HistoryStep | null
  /** Existing block: the editor's redo steps that undoing while typing made, latest last. */
  undone: HistoryStep[]
}

/** A session's undo bookkeeping, as it starts. */
function freshHistory(): Pick<Session, 'undo' | 'redo' | 'typedAt' | 'floor' | 'undone'> {
  const { past } = useEditor.getState()
  return { undo: [], redo: [], typedAt: -Infinity, floor: past[past.length - 1] ?? null, undone: [] }
}

const snapshot = (el: TextElement): Snapshot => ({ text: el.text, align: el.align, x: el.x, y: el.y, width: el.width })

function textElement(id: string): TextElement | undefined {
  const el = useEditor.getState().elements.find((e) => e.id === id)
  return el?.kind === 'text' ? el : undefined
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

/**
 * Adds a new, empty text block and starts typing into it. `el` comes with its left edge where it
 * was started (see textOrigin); one aligned otherwise goes so that the side it grows from (its
 * right edge or its middle) is there instead, inside the page.
 */
export function startNewText(el: TextElement): void {
  finishActiveTextEdit()
  const s = useEditor.getState()
  s.beginGesture()
  session = { id: el.id, isNew: true, before: el.text, origin: el.x, ...freshHistory() }
  pendingCaret = { id: el.id, caret: 'end' }
  const page = s.doc?.pages[el.page]
  const anchored = { ...el, x: el.x - el.width * TEXT_ANCHOR[el.align] }
  flushSync(() => s.addElement(page ? keepTextInPage(anchored, el, page) : anchored, { edit: true }))
  focusWithPendingCaret(el.id)
}

/**
 * The text of the block being edited changed (typing, pasting, deleting). A new block whose text
 * turns out to run right to left (Hebrew, Arabic…) right-aligns with its right edge where it was
 * started, so it grows leftwards from there like the line it is typed on. Only while it is still
 * left-aligned: an alignment chosen for it stays. `typed` is false for a paste, a drop or a cut:
 * an undo step of its own, where typing goes in bursts.
 */
export function setEditedText(id: string, text: string, typed = true): void {
  const s = useEditor.getState()
  const el = s.elements.find((e) => e.id === id)
  if (!el || el.kind !== 'text') return
  const opts = typed ? { coalesce: `text:${id}` } : undefined
  const own = session?.id === id ? session : null
  if (own && text !== el.text) noteEdit(own, el, typed)
  if (own?.isNew && own.origin !== undefined && el.align === 'left' && !firstStrongDirection(el.text) && firstStrongDirection(text) === 'rtl') {
    const laid = withTextLayout({ ...el, text, align: 'right', x: own.origin, width: 0 })
    s.updateElement(id, { text, align: 'right', x: laid.x, width: laid.width, height: laid.height }, opts)
    return
  }
  s.updateElement(id, { text }, opts)
}

/** Before a change to the text being edited: what undoing can take back, and redo is over. */
function noteEdit(own: Session, el: TextElement, typed: boolean) {
  own.redo = []
  own.undone = []
  // An existing block's undo steps are the editor's (bursts, by `coalesce`): see setEditedText.
  if (!own.isNew) return
  const now = Date.now()
  if (!typed || now - own.typedAt >= COALESCE_MS) own.undo.push(snapshot(el))
  own.typedAt = typed ? now : -Infinity
}

/**
 * Ctrl/⌘+Z while typing into `id`: takes back the latest burst of typing (or paste) since editing
 * began, or, for an existing block, any other step the editor recorded for it meanwhile (a style
 * change), and the caret stays in the box, where the text changed. False when nothing done since
 * editing began is left to undo: then nothing changes (as in a text box).
 */
export function undoTextEdit(id: string): boolean {
  return stepTextEdit(id, 'undo')
}

/** Ctrl/⌘+Shift+Z or Ctrl+Y while typing into `id`: puts back what `undoTextEdit` took back. */
export function redoTextEdit(id: string): boolean {
  return stepTextEdit(id, 'redo')
}

function stepTextEdit(id: string, dir: 'undo' | 'redo'): boolean {
  const own = session?.id === id ? session : null
  const el = textElement(id)
  if (!own || !el || useEditor.getState().editingId !== id) return false
  if (own.isNew) {
    // Inside its gesture: its own snapshots, the editor records nothing until it is committed.
    const [from, to] = dir === 'undo' ? [own.undo, own.redo] : [own.redo, own.undo]
    const snap = from.pop()
    if (!snap) return false
    to.push(snapshot(el))
    own.typedAt = -Infinity
    flushSync(() => useEditor.getState().updateElement(id, standAt(el, snap)))
  } else {
    const s = useEditor.getState()
    if (dir === 'undo') {
      const step = s.past[s.past.length - 1]
      if (!step || step === own.floor) return false
    } else if (!own.undone.length || s.future[0] !== own.undone[own.undone.length - 1]) return false
    // The editor's own step, and still typing in the block afterwards (rendered once, so the
    // editor stays as it is).
    flushSync(() => {
      const st = useEditor.getState()
      if (dir === 'undo') st.undo()
      else st.redo()
      if (textElement(id)) useEditor.getState().setEditing(id)
    })
    if (dir === 'undo') own.undone.push(useEditor.getState().future[0])
    else own.undone.pop()
    if (!textElement(id)) {
      finishTextEdit(id)
      return true
    }
  }
  const now = textElement(id)
  if (now && now.text !== el.text) focusTextarea(id, changedEnd(el.text, now.text))
  return true
}

/**
 * The patch putting a new block back as it was in `snap`: its text and alignment, the side it
 * grows from where it was then (measured at its current font, which may have changed since).
 */
function standAt(el: TextElement, snap: Snapshot): ElementPatch {
  const anchor = snap.x + snap.width * TEXT_ANCHOR[snap.align]
  const laid = withTextLayout({ ...el, text: snap.text, align: snap.align, x: anchor, width: 0 })
  return { text: laid.text, align: laid.align, x: laid.x, y: snap.y, width: laid.width, height: laid.height }
}

/** Where the caret goes once `was` became `now` by undo or redo: after what changed. */
function changedEnd(was: string, now: string): number {
  const max = Math.min(was.length, now.length)
  let start = 0
  while (start < max && was[start] === now[start]) start++
  let end = 0
  while (end < max - start && was[was.length - 1 - end] === now[now.length - 1 - end]) end++
  return now.length - end
}

/**
 * A new block left empty once its typing was undone goes, as any new block left empty, but what
 * was typed stays a redo away: the editor's redo brings it back, as redo while typing would have.
 */
function keepRedo(el: TextElement, redo: Snapshot[]) {
  const { elements, formValues, doc } = useEditor.getState()
  const page = doc?.pages[el.page]
  const future = [...redo].reverse().map((snap) => {
    const laid = { ...el, ...standAt(el, snap) } as TextElement
    return { elements: [...elements, page ? keepTextInPage(laid, el, page) : laid], formValues, selection: [el.id] }
  })
  useEditor.setState({ future })
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
  session = { id, isNew: false, before: el.text, ...freshHistory() }
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
    const last = textElement(id)
    useEditor.getState().removeElements([id])
    useEditor.getState().endGesture()
    if (own?.redo.length && last) keepRedo(last, own.redo)
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
