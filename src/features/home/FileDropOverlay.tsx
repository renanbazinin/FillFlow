import { useEffect } from 'react'
import { FileUp, FileX } from 'lucide-react'
import { cn } from '../../lib/utils/misc'
import { useEditor } from '../../store/editor'
import { classifyDrag, dragHasFiles, setFileDrag, useFileDrag } from './fileDrag'
import { openFirstPdf } from './openFile'
import { displayName } from './pdfFiles'

/** While something modal is up, a drop must not swap the document underneath it. */
function dropBlocked(): boolean {
  const s = useEditor.getState()
  return s.activeDialog !== null || s.load.status !== 'idle' || !!document.querySelector('[role="alertdialog"]')
}

/**
 * Window-wide file drop. Mounted once (App). Dragging files anywhere over the app shows a
 * full-window hint; dropping opens the first PDF (replacing the current document, whose work
 * is auto-saved). Inner drop targets that call `preventDefault()` on drop keep their files.
 */
export function FileDropOverlay() {
  const drag = useFileDrag()
  const docName = useEditor((s) => s.doc?.name ?? null)

  useEffect(() => {
    let hideTimer = 0
    const hideSoon = () => {
      window.clearTimeout(hideTimer)
      hideTimer = window.setTimeout(() => setFileDrag(null), 90)
    }
    const onDragOver = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer)) return
      // Accept the drop anywhere, and keep the browser from navigating away to the file.
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      window.clearTimeout(hideTimer)
      setFileDrag(dropBlocked() ? null : { active: true, kind: classifyDrag(e.dataTransfer?.items) })
    }
    const onDragLeave = (e: DragEvent) => {
      if (dragHasFiles(e.dataTransfer)) hideSoon()
    }
    const onDrop = (e: DragEvent) => {
      window.clearTimeout(hideTimer)
      setFileDrag(null)
      if (!dragHasFiles(e.dataTransfer) || e.defaultPrevented) return
      e.preventDefault()
      if (dropBlocked() || !e.dataTransfer) return
      void openFirstPdf(e.dataTransfer.files)
    }
    window.addEventListener('dragenter', onDragOver)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.clearTimeout(hideTimer)
      window.removeEventListener('dragenter', onDragOver)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      setFileDrag(null)
    }
  }, [])

  if (!drag.active) return null
  const inEditor = docName !== null
  const notPdf = drag.kind === 'other'
  // In the editor, other kinds of files (images) may be meant for the page itself.
  if (inEditor && notPdf) return null

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[75] animate-fade-in">
      {inEditor && <div className="absolute inset-0 bg-overlay backdrop-blur-[3px]" />}
      <div
        className={cn(
          'absolute inset-2 rounded-[22px] border-2 border-dashed sm:inset-3',
          notPdf ? 'border-danger/60' : inEditor ? 'border-white/55' : 'border-accent/60',
        )}
      />
      {inEditor ? (
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="flex w-[min(92vw,360px)] flex-col items-center rounded-2xl border border-line bg-surface px-6 pb-6 pt-7 text-center shadow-overlay animate-scale-in">
            <div className="grid size-12 place-items-center rounded-2xl bg-brand-gradient text-white shadow-float">
              <FileUp className="size-6" strokeWidth={1.75} />
            </div>
            <div className="mt-4 text-[17px] font-semibold tracking-[-0.01em] text-fg">Drop your PDF to open it</div>
            <div className="mt-1.5 text-[13.5px] leading-relaxed text-fg-muted">
              Your work on <span className="font-medium text-fg">{displayName(docName)}</span> is saved on this device.
            </div>
          </div>
        </div>
      ) : (
        <div className="absolute inset-x-0 bottom-6 flex justify-center px-4 sm:bottom-8">
          <div
            className={cn(
              'flex items-center gap-2 rounded-full px-4 py-2 text-[13.5px] font-medium shadow-float animate-slide-up',
              notPdf ? 'bg-danger text-white' : 'bg-accent text-accent-fg',
            )}
          >
            {notPdf ? <FileX className="size-4" /> : <FileUp className="size-4" />}
            {notPdf ? 'Only PDF files can be opened' : 'Drop your PDF to open it'}
          </div>
        </div>
      )}
    </div>
  )
}
