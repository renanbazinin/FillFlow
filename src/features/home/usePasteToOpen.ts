import { useEffect } from 'react'
import { isEditableTarget } from '../../lib/utils/misc'
import { useEditor } from '../../store/editor'
import { openFirstPdf } from './openFile'

/** Open dialogs, confirmations, popovers (dialogs too) and menus. */
const OPEN_OVERLAY = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]'

/** Home screen: paste a PDF file (copied in the OS file manager) to open it. */
export function usePasteToOpen(): void {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      // With a menu or a confirmation up, the paste is theirs: nothing opens underneath them.
      if (isEditableTarget(e.target) || useEditor.getState().load.status !== 'idle' || document.querySelector(OPEN_OVERLAY)) return
      const files = e.clipboardData?.files
      if (!files?.length) return
      e.preventDefault()
      void openFirstPdf(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])
}
