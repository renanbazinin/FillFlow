import { useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import type { TextElement } from '../../../model/types'
import { useEditor } from '../../../store/editor'
import { shortcutLetter } from '../lib/keys'
import { textCss, useBaselineShift } from '../render/textStyle'
import { applyCaret, finishTextEdit, hasTextarea, registerTextarea, setEditedText, takePendingCaret } from '../state/textEdit'
import { isIOS } from './platform'

/** Caret color when the text itself is too light to see on white paper. */
const SELECTION = '#2563eb'

function isLight(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return false
  const n = parseInt(m[1], 16)
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 200
}

/**
 * In-place editor: a transparent <textarea> laid exactly over the text block with identical
 * metrics, so typing looks like editing the text on the page. Its size follows the store's
 * measured box (the store re-measures on every keystroke).
 */
export function TextEditor({ el, scale }: { el: TextElement; scale: number }) {
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

  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute z-[25] rounded-[2px] border border-dashed border-selection"
        style={{ left: el.x * scale - 3, top: top - 3, width: el.width * scale + 6, height: el.height * scale + 6 }}
      />
      <textarea
        ref={ref}
        value={el.text}
        aria-label="Edit text"
        wrap="off"
        dir="auto"
        spellCheck
        autoComplete="off"
        rows={1}
        onChange={(e) => {
          const raw = e.target.value
          setEditedText(id, raw.includes('\t') ? raw.replace(/\t/g, '    ') : raw)
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
        }}
      />
    </>
  )
}
