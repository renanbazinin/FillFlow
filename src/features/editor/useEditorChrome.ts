import { useEffect } from 'react'
import { toast } from 'sonner'
import { getFormDocumentInfo } from '../../lib/pdf/formFields'
import { useSaveStatus } from '../../lib/storage/autosave'
import { useEditor } from '../../store/editor'
import { displayName } from '../home/pdfFiles'
import { fillableFieldCount, formFieldsMessage } from './docInfo'
import { RIGHT_PANEL_INLINE } from './useMediaQuery'

/** Documents we've already announced form fields for (once per page load). */
const announced = new Set<string>()

/** Window-level side effects of the editor: tab title, unsaved-work guard, first-open toast. */
export function useEditorChrome(): void {
  const docId = useEditor((s) => s.doc?.id ?? null)
  const docName = useEditor((s) => s.doc?.name ?? null)
  const loadFailed = useEditor((s) => s.doc?.sessionLoadFailed === true)
  const saveFailed = useSaveStatus((s) => s.state === 'error')

  // Tab title: "Lease agreement — FillFlow".
  useEffect(() => {
    if (!docName) return
    const previous = document.title
    document.title = `${displayName(docName)} — FillFlow`
    return () => {
      document.title = previous
    }
  }, [docName])

  // If the last save failed, leaving would lose work: ask first.
  useEffect(() => {
    if (!saveFailed) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // Legacy browsers need returnValue set to show the prompt.
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [saveFailed])

  // A document with a form: tell people they can just click into fields (once per document).
  useEffect(() => {
    // Its saved work didn't load: that warning stays in front, not a hint inviting the user to type
    // into the blank form. Once a reload (the same document again) brings the work, the hint comes.
    if (!docId || loadFailed) return
    const toastId = `form-fields:${docId}`
    // Let the document paint first so the toast doesn't compete with the page appearing.
    const timer = announced.has(docId)
      ? 0
      : window.setTimeout(() => {
          const s = useEditor.getState()
          if (s.doc?.id !== docId) return
          announced.add(docId)
          // Already in a field: the hint has nothing to add, and would sit over the fields.
          if (s.activeFieldName !== null) return
          const count = fillableFieldCount(s.doc.formFields)
          const formVisible =
            s.rightPanelOpen && s.rightPanelTab === 'form' && window.matchMedia(RIGHT_PANEL_INLINE).matches
          if (!count) {
            if (getFormDocumentInfo(s.doc.pdf)?.pureXfa) {
              toast.warning('This dynamic XFA form can’t be filled in a browser', {
                id: toastId,
                description: 'You can still type, check and sign on top of the pages.',
                duration: 8000,
                action: formVisible
                  ? undefined
                  : { label: 'Details', onClick: () => useEditor.getState().setRightPanelOpen(true, 'form') },
              })
            }
            return
          }
          const touch = window.matchMedia('(pointer: coarse)').matches
          toast(formFieldsMessage(count, touch), {
            id: toastId,
            duration: 6000,
            action: formVisible
              ? undefined
              : { label: 'Show form', onClick: () => useEditor.getState().setRightPanelOpen(true, 'form') },
          })
        }, 450)
    // Once a field is in use, the hint has done its job: it goes rather than cover the fields
    // (Tab moves on to the ones further down, where it sits).
    const unsubscribe = useEditor.subscribe(
      (s) => s.activeFieldName,
      (name) => {
        if (name !== null) toast.dismiss(toastId)
      },
    )
    return () => {
      window.clearTimeout(timer)
      unsubscribe()
      // It's about this document: don't let it linger on the home screen or over the next file.
      toast.dismiss(toastId)
    }
  }, [docId, loadFailed])
}
