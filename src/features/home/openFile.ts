import { toast } from 'sonner'
import { useEditor } from '../../store/editor'
import { confirmLeaveDocument } from '../editor/leaveGuard'
import { PDF_ACCEPT, SAMPLE_FORM_NAME, displayName, firstPdf, isPdfFile } from './pdfFiles'

// Shared "open a PDF" plumbing for the home screen, the editor menu, the global drop
// overlay and the load-error dialog.

/**
 * Opens a file the user handed us. Non-PDFs get a friendly error toast. When a document is
 * already open it is replaced (its work is auto-saved), and the user is reassured once the new
 * file has opened.
 */
export async function openPdfFile(file: File): Promise<boolean> {
  if (!isPdfFile(file)) {
    toast.error(`“${file.name}” isn’t a PDF`, { description: 'FillFlow opens PDF files only.' })
    return false
  }
  const previous = useEditor.getState().doc
  if (previous && !(await confirmLeaveDocument())) return false
  const ok = await useEditor.getState().openDocument(file)
  if (ok && previous && previous.id !== useEditor.getState().doc?.id) {
    toast.success(`Your work on “${displayName(previous.name)}” is saved`, {
      description: 'Reopen it any time from the home screen.',
    })
  }
  return ok
}

/** Handles a list of dropped/pasted files: opens the first PDF, or explains why nothing opened. */
export async function openFirstPdf(files: FileList | File[]): Promise<boolean> {
  const list = Array.from(files)
  if (!list.length) return false
  const pdf = firstPdf(list)
  if (!pdf) {
    const what = list.length === 1 ? `“${list[0].name}” isn’t a PDF` : 'None of those files is a PDF'
    const images = list.some((f) => f.type.startsWith('image/'))
    const inEditor = useEditor.getState().doc !== null
    toast.error(what, {
      description: images && inEditor ? 'To add a picture to the page, use the Image tool.' : 'FillFlow opens PDF files only.',
    })
    return false
  }
  return openPdfFile(pdf)
}

/**
 * Opens the system file picker for a PDF. Resolves with the chosen file, or null when the
 * user cancels (in browsers that report it). Must be called from a user gesture.
 */
export function pickPdfFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = PDF_ACCEPT
    input.tabIndex = -1
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    input.style.opacity = '0'
    let settled = false
    const done = (file: File | null) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(file)
    }
    input.addEventListener('change', () => done(input.files?.[0] ?? null))
    input.addEventListener('cancel', () => done(null))
    document.body.appendChild(input)
    input.click()
  })
}

/** Picker → open. */
export async function chooseAndOpenPdf(): Promise<boolean> {
  const file = await pickPdfFile()
  return file ? openPdfFile(file) : false
}

/** Fetches the bundled sample form (generated into public/samples) and opens it. */
export async function openSampleForm(): Promise<boolean> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}samples/sample-form.pdf`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    return await useEditor.getState().openDocument({ name: SAMPLE_FORM_NAME, bytes })
  } catch (err) {
    console.error('[sample] could not load the sample form', err)
    toast.error('Couldn’t load the sample form', { description: 'Check your connection and try again.' })
    return false
  }
}
