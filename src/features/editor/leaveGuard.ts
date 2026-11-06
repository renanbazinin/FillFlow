import { confirm } from '../../components/ui/confirm'
import { getT } from '../../i18n'
import { flushAutosave } from '../../lib/storage/autosave'
import { useSaveStatusStore } from '../../lib/storage/saveStatus'
import { useEditor } from '../../store/editor'

/**
 * Leaving the open document is normally free (work is auto-saved). Pending changes are written
 * first; if they couldn't be (or an earlier save failed), ask: the in-memory changes are the
 * only copy. Resolves true when it's fine to go.
 */
export async function confirmLeaveDocument(): Promise<boolean> {
  if (!useEditor.getState().doc) return true
  await flushAutosave()
  if (useSaveStatusStore.getState().state !== 'error') return true
  const m = getT().editor.unsaved
  return confirm({
    title: m.leaveTitle,
    description: m.body,
    confirmLabel: m.leave,
    cancelLabel: m.stay,
    danger: true,
  })
}

/** Back to the home screen (guarded). */
export async function closeDocumentSafely(): Promise<void> {
  if (await confirmLeaveDocument()) useEditor.getState().closeDocument()
}
