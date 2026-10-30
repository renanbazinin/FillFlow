import { confirm } from '../../components/ui/confirm'
import { useSaveStatusStore } from '../../lib/storage/saveStatus'
import { useEditor } from '../../store/editor'

/**
 * Leaving the open document is normally free (work is auto-saved). If the last save failed,
 * ask first: the in-memory changes are the only copy. Resolves true when it's fine to go.
 */
export async function confirmLeaveDocument(): Promise<boolean> {
  if (!useEditor.getState().doc || useSaveStatusStore.getState().state !== 'error') return true
  return confirm({
    title: 'Leave without your latest changes?',
    description: 'They couldn’t be saved on this device. Download your PDF first if you want to keep them.',
    confirmLabel: 'Leave anyway',
    cancelLabel: 'Stay',
    danger: true,
  })
}

/** Back to the home screen (guarded). */
export async function closeDocumentSafely(): Promise<void> {
  if (await confirmLeaveDocument()) useEditor.getState().closeDocument()
}
