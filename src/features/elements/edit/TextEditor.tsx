import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import { useDir, useT } from '../../../i18n'
import type { TextElement } from '../../../model/types'
import { cn } from '../../../lib/utils/misc'
import { useEditor } from '../../../store/editor'
import { hasMod, shortcutLetter } from '../lib/keys'
import { textCss, useBaselineShift } from '../render/textStyle'
import {
  applyCaret,
  finishTextEdit,
  hasTextarea,
  redoTextEdit,
  registerTextarea,
  setEditedText,
  takePendingCaret,
  undoTextEdit,
} from '../state/textEdit'
import { isIOS } from './platform'

/** Caret color when the text itself is too light to see on white paper. */
const SELECTION = '#2563eb'

function isLight(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return false
  const n = parseInt(m[1], 16)
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 200
}

/** Ctrl/⌘+Z undo; Ctrl/⌘+Shift+Z or Ctrl+Y redo, as everywhere in the editor (useEditingShortcuts). */
function historyKey(e: KeyboardEvent): 'undo' | 'redo' | null {
  if (!hasMod(e) || e.altKey) return null
  const letter = shortcutLetter(e)
  if (letter === 'z') return e.shiftKey ? 'redo' : 'undo'
  return letter === 'y' && e.ctrlKey && !e.metaKey ? 'redo' : null
}

/** Input that isn't typing, so an undo step of its own: a paste, a drop, a cut, a spelling fix. */
const NOT_TYPING = new Set(['insertFromPaste', 'insertFromPasteAsQuotation', 'insertFromDrop', 'deleteByCut', 'deleteByDrag', 'insertReplacementText', 'insertFromYank'])

const isTyping = (e: Event) => !('inputType' in e && NOT_TYPING.has(String(e.inputType)))

/** Rounding slack (points) before a block counts as past the page edge. */
const EDGE_SLACK = 0.01
/** Room (CSS px) left past a page edge for the caret of text that reaches it. */
const CARET_ROOM = 2

interface Size {
  width: number
  height: number
}

/**
 * `clip-path` cutting a box (CSS px in the page, drawn scaled by `k` from its top-left) at the
 * page's edges, as the download cuts what is past them, with room for a caret at an edge.
 */
function pageClip(box: { left: number; top: number; width: number; height: number }, page: Size, k: number): string | undefined {
  const t = Math.max(0, -CARET_ROOM - box.top)
  const r = Math.max(0, box.left + box.width - page.width - CARET_ROOM)
  const b = Math.max(0, box.top + box.height - page.height - CARET_ROOM)
  const l = Math.max(0, -CARET_ROOM - box.left)
  return t || r || b || l ? `inset(${t / k}px ${r / k}px ${b / k}px ${l / k}px)` : undefined
}

/**
 * In-place editor: a transparent <textarea> laid exactly over the text block with identical
 * metrics, so typing looks like editing the text on the page. Its size follows the store's
 * measured box (the store re-measures on every keystroke). Text past the page edges is cut, as
 * in the download; then (only a block too big for the page gets there) the frame turns red and
 * a note under it says so.
 */
export function TextEditor({ el, scale, page }: { el: TextElement; scale: number; page: Size }) {
  const t = useT()
  // The note is interface text on the page: it reads the interface's way (the text being typed
  // keeps its own direction, dir="auto").
  const dir = useDir()
  const ref = useRef<HTMLTextAreaElement>(null)
  const id = el.id

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    registerTextarea(id, node)
    if (document.activeElement !== node) node.focus({ preventScroll: true })
    const caret = takePendingCaret(id)
    if (caret !== null) applyCaret(node, caret)
    return () => {
      registerTextarea(id, null)
      // Unmounted because editing moved on (undo, tool change, another item…), or, as a safety
      // net, while still editing (scrolling can't cause that: the page being edited keeps its
      // layer mounted, see PageView): commit. A StrictMode re-mount registers again right away,
      // so it doesn't end the session.
      queueMicrotask(() => {
        if (useEditor.getState().editingId !== id || !hasTextarea(id)) finishTextEdit(id)
      })
    }
  }, [id])

  // The browser's own Undo and Redo (its menus) while typing here run the editor's, as the keys do.
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const onBeforeInput = (e: InputEvent) => {
      if (document.activeElement !== node || !e.cancelable || (e.inputType !== 'historyUndo' && e.inputType !== 'historyRedo')) return
      e.preventDefault()
      if (e.inputType === 'historyUndo') undoTextEdit(id)
      else redoTextEdit(id)
    }
    document.addEventListener('beforeinput', onBeforeInput, true)
    return () => document.removeEventListener('beforeinput', onBeforeInput, true)
  }, [id])

  // The box grows with the text, but the browser may scroll the textarea for a frame first.
  useLayoutEffect(() => {
    const node = ref.current
    if (node && (node.scrollLeft || node.scrollTop)) {
      node.scrollLeft = 0
      node.scrollTop = 0
    }
  })

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault()
      e.stopPropagation()
      finishTextEdit(id)
      return
    }
    // A burst of typing at a time, through the editor (undoTextEdit). The browser's own undo would
    // take back one character at a time here (React rewrites the textarea's default value after
    // each one, which ends the browser's typing step), then reach into other boxes on the page.
    const history = historyKey(e)
    if (history) {
      e.preventDefault()
      e.stopPropagation()
      if (history === 'undo') undoTextEdit(id)
      else redoTextEdit(id)
      return
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && shortcutLetter(e) === 'b') {
      e.preventDefault()
      const s = useEditor.getState()
      const cur = s.elements.find((x) => x.id === id)
      if (cur?.kind !== 'text') return
      s.updateElement(id, { bold: !cur.bold })
      s.setStyle('text', { bold: !cur.bold })
    }
  }

  const css = textCss(el, scale)
  const fs = el.fontSize * scale
  // Room for the caret past the line end, on the side the text grows towards.
  const room = Math.max(4, Math.ceil(fs * 0.15))
  const width = el.width * scale + room
  const height = el.height * scale + 1
  const left = el.x * scale - (el.align === 'right' ? room : el.align === 'center' ? room / 2 : 0)
  const top = el.y * scale
  // iOS zooms the page into inputs under 16px: render at 16px and scale down instead.
  const k = isIOS() && fs < 16 ? fs / 16 : 1
  // Same baseline correction as the static text, so entering edit mode doesn't nudge it.
  const shift = useBaselineShift(el, scale, k)

  const past =
    el.x < -EDGE_SLACK || el.y < -EDGE_SLACK || el.x + el.width > page.width + EDGE_SLACK || el.y + el.height > page.height + EDGE_SLACK

  return (
    <>
      <div
        aria-hidden
        className={cn('pointer-events-none absolute z-[25] rounded-[2px] border border-dashed', past ? 'border-danger' : 'border-selection')}
        style={{ left: el.x * scale - 3, top: top - 3, width: el.width * scale + 6, height: el.height * scale + 6 }}
      />
      {past && (
        // Under the part of the block that is on the page (just under the page, when it runs past
        // the bottom). The page is white in either theme, so the note keeps one red.
        <div
          role="status"
          dir={dir}
          className="pointer-events-none absolute z-[25] -translate-x-1/2 whitespace-nowrap rounded-md bg-[#dc2626] px-1.5 py-0.5 text-[11px] font-medium leading-4 text-white shadow-[0_1px_3px_rgb(16_24_40/0.25)]"
          style={{
            left: ((Math.max(el.x, 0) + Math.min(el.x + el.width, page.width)) / 2) * scale,
            top: Math.min(el.y + el.height, page.height) * scale + 10,
          }}
        >
          {t.elements.textEditor.pastEdge}
        </div>
      )}
      <textarea
        ref={ref}
        value={el.text}
        aria-label={t.elements.textEditor.label}
        wrap="off"
        dir="auto"
        spellCheck
        autoComplete="off"
        rows={1}
        onChange={(e) => {
          const raw = e.target.value
          setEditedText(id, raw.includes('\t') ? raw.replace(/\t/g, '    ') : raw, isTyping(e.nativeEvent))
        }}
        onKeyDown={onKeyDown}
        onBlur={(e) => {
          // Window switches blur the textarea too; keep editing until focus really moves.
          if (document.activeElement === e.currentTarget) return
          finishTextEdit(id)
        }}
        onScroll={(e) => {
          e.currentTarget.scrollLeft = 0
          e.currentTarget.scrollTop = 0
        }}
        className="pointer-events-auto absolute z-[26] m-0 resize-none appearance-none overflow-hidden border-0 bg-transparent p-0 outline-none [scrollbar-width:none]"
        style={{
          ...css,
          fontSize: `${(el.fontSize * scale) / k}px`,
          lineHeight: `${(el.fontSize * el.lineHeight * scale) / k}px`,
          letterSpacing: `${(el.letterSpacing * scale) / k}px`,
          left,
          top: top + shift,
          width: width / k,
          height: height / k,
          transform: k !== 1 ? `scale(${k})` : undefined,
          transformOrigin: '0 0',
          textAlign: el.align,
          unicodeBidi: 'plaintext',
          caretColor: isLight(el.color) ? SELECTION : el.color,
          tabSize: 4,
          boxShadow: 'none',
          minHeight: 0,
          clipPath: pageClip({ left, top: top + shift, width, height }, { width: page.width * scale, height: page.height * scale }, k),
        }}
      />
    </>
  )
}
