import { useEffect } from 'react'
import { isEditableTarget } from '../../lib/utils/misc'
import { useEditor } from '../../store/editor'
import { openFirstPdf } from './openFile'

/** Home screen: paste a PDF file (copied in the OS file manager) to open it. */
export function usePasteToOpen(): void {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target) || useEditor.getState().load.status !== 'idle') return
      const files = e.clipboardData?.files
      if (!files?.length) return
      e.preventDefault()
      void openFirstPdf(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])
}
