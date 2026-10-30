import { useEffect } from 'react'
import { toolForShortcut } from '../../model/tools'
import { getSelectedElements, useEditor } from '../../store/editor'
import { isEditableTarget } from '../../lib/utils/misc'
import { viewer } from '../viewer/viewerApi'
import { trackPointer } from './interaction/pointer'
import { bracketKey, hasMod, shortcutLetter } from './lib/keys'
import {
  clipboardMarker,
  copySelection,
  hasClipboardItems,
  pasteImageBlob,
  pastePlainText,
  pasteItems,
  systemClipboardIsNewer,
} from './state/clipboard'
import { deleteSelection, duplicateSelection, nudgeSelection, reorderSelection, selectAllOnPage, toggleLockSelection } from './state/commands'
import { editText, finishActiveTextEdit } from './state/textEdit'
import { activateTool } from './state/tools'
import { useElementsUi } from './state/ui'
import { toggleBold } from './toolbar/styleActions'

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

/** Focus is in a dialog, menu or popover: those own the keyboard. */
function focusInOverlay(): boolean {
  const a = document.activeElement
  return !!a?.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]')
}

function shouldIgnore(): boolean {
  const s = useEditor.getState()
  // Mid-drag the pointer tracker owns the keyboard (Esc cancels, Shift/Alt modify).
  return !s.doc || s.activeDialog !== null || focusInOverlay() || useElementsUi.getState().interaction !== 'idle'
}

/**
 * Global editing shortcuts (mounted once by the editor screen):
 * tools by letter, Esc, Delete/Backspace, arrows (Shift ×10), undo/redo, duplicate, internal
 * clipboard (plus pasting images/text from the system clipboard), select all on the current
 * page, Enter to edit text, bold, lock, and z-order. Ctrl/⌘+S, +, −, 0 belong to other areas.
 */
export function useEditingShortcuts(): void {
  useEffect(() => {
    let copyPending: { cut: boolean } | null = null
    let pasteTimer = 0

    function onEscape(e: KeyboardEvent) {
      const s = useEditor.getState()
      if (s.editingId) {
        e.preventDefault()
        finishActiveTextEdit()
        return
      }
      if (s.tool !== 'select') {
        // Leaves creation tools (and cancels an armed signature/image placement).
        e.preventDefault()
        s.setTool('select')
        return
      }
      if (s.selection.length) {
        e.preventDefault()
        s.clearSelection()
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || shouldIgnore()) return
      if (e.key === 'Escape') {
        onEscape(e)
        return
      }
      if (isEditableTarget(e.target) || e.isComposing) return
      const s = useEditor.getState()
      const letter = shortcutLetter(e)

      if (hasMod(e)) {
        if (e.altKey) return
        switch (letter) {
          case 'z':
            e.preventDefault()
            finishActiveTextEdit()
            if (e.shiftKey) s.redo()
            else s.undo()
            return
          case 'y':
            if (e.ctrlKey && !e.metaKey) {
              e.preventDefault()
              finishActiveTextEdit()
              s.redo()
            }
            return
          case 'd':
            e.preventDefault()
            duplicateSelection()
            return
          case 'a':
            e.preventDefault()
            selectAllOnPage(s.currentPage)
            return
          case 'b':
            if (getSelectedElements(s).some((el) => el.kind === 'text')) {
              e.preventDefault()
              toggleBold()
            }
            return
          case 'l':
            if (e.shiftKey && s.selection.length) {
              e.preventDefault()
              toggleLockSelection()
            }
            return
          case 'c':
          case 'x':
            // The copy/cut event does the work; this covers browsers that skip it without a text selection.
            if (s.selection.length && !hasTextSelection()) {
              copyPending = { cut: letter === 'x' }
              setTimeout(() => {
                if (copyPending) copySelection(copyPending.cut)
                copyPending = null
              }, 0)
            }
            return
          case 'v':
            // Same for paste: the paste event wins; fall back to our items if it never comes.
            if (hasClipboardItems()) {
              window.clearTimeout(pasteTimer)
              pasteTimer = window.setTimeout(() => {
                pasteTimer = 0
                pasteItems()
              }, 80)
            }
            return
        }
        const bracket = bracketKey(e)
        if (bracket && s.selection.length) {
          e.preventDefault()
          reorderSelection(bracket === ']' ? 'front' : 'back')
        }
        return
      }
      if (e.altKey) return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selection.length) {
          e.preventDefault()
          deleteSelection()
        }
        return
      }
      const arrow = ARROWS[e.key]
      if (arrow) {
        if (s.selection.length) {
          e.preventDefault()
          const step = e.shiftKey ? 10 : 1
          nudgeSelection(arrow[0] * step, arrow[1] * step)
        }
        return
      }
      if (e.key === 'Enter') {
        const sel = getSelectedElements(s)
        if (sel.length === 1 && sel[0].kind === 'text' && !isButtonTarget(e.target)) {
          e.preventDefault()
          editText(sel[0].id)
        }
        return
      }
      if (e.repeat || e.shiftKey || !letter) return
      const tool = toolForShortcut(letter)
      if (tool) {
        e.preventDefault()
        activateTool(tool.id)
      }
    }

    function clipboardBlocked(e: ClipboardEvent): boolean {
      return shouldIgnore() || isEditableTarget(e.target) || isEditableTarget(document.activeElement)
    }

    function onCopy(e: ClipboardEvent, cut: boolean) {
      if (clipboardBlocked(e) || hasTextSelection()) return
      if (!useEditor.getState().selection.length) return
      copyPending = null
      if (!copySelection(cut)) return
      const marker = clipboardMarker()
      if (marker && e.clipboardData) {
        e.clipboardData.setData('text/plain', marker)
        e.preventDefault()
      }
    }

    function onPaste(e: ClipboardEvent) {
      if (clipboardBlocked(e)) return
      window.clearTimeout(pasteTimer)
      pasteTimer = 0
      const data = e.clipboardData
      const image = data ? [...data.files].find((f) => f.type.startsWith('image/')) : undefined
      const text = data?.getData('text/plain') ?? ''
      if (hasClipboardItems() && !systemClipboardIsNewer(text, !!image)) {
        e.preventDefault()
        pasteItems()
        return
      }
      if (image) {
        e.preventDefault()
        void pasteImageBlob(image).catch((err) => console.warn('[paste] image failed', err))
        return
      }
      if (text.trim()) {
        e.preventDefault()
        pastePlainText(text)
      }
    }

    // Pressing the gray area around the pages deselects (a tap on touch, so scrolling doesn't).
    function onBackgroundDown(e: PointerEvent) {
      const s = useEditor.getState()
      if (!s.doc || s.tool !== 'select' || e.button !== 0 || !e.isPrimary) return
      const sc = viewer.getScrollContainer()
      const t = e.target as HTMLElement | null
      if (!sc || !t || !sc.contains(t) || t.closest('[data-page-index]')) return
      if (t.closest('button, a[href], input, select, textarea, [role="toolbar"], [data-element-toolbar]')) return
      if (t === sc && (e.offsetX > sc.clientWidth || e.offsetY > sc.clientHeight)) return // scrollbar
      if (e.shiftKey || e.ctrlKey || e.metaKey) return
      if (e.pointerType !== 'touch') {
        finishActiveTextEdit()
        s.clearSelection()
        return
      }
      trackPointer(
        e,
        {
          up(p) {
            if (Math.hypot(p.clientX - e.clientX, p.clientY - e.clientY) < 10) {
              finishActiveTextEdit()
              useEditor.getState().clearSelection()
            }
          },
        },
        { escapeCancels: false },
      )
    }

    const copy = (e: ClipboardEvent) => onCopy(e, false)
    const cut = (e: ClipboardEvent) => onCopy(e, true)
    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('copy', copy)
    document.addEventListener('cut', cut)
    document.addEventListener('paste', onPaste)
    document.addEventListener('pointerdown', onBackgroundDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('copy', copy)
      document.removeEventListener('cut', cut)
      document.removeEventListener('paste', onPaste)
      document.removeEventListener('pointerdown', onBackgroundDown)
      window.clearTimeout(pasteTimer)
    }
  }, [])
}

function hasTextSelection(): boolean {
  const sel = window.getSelection()
  return !!sel && !sel.isCollapsed && sel.toString().trim().length > 0
}

function isButtonTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && !!t.closest('button, a[href], [role="button"], [role="menuitem"], [role="tab"]')
}
