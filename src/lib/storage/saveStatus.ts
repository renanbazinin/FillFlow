import { create } from 'zustand'
import { getT } from '../../i18n'

export type SaveStatus = { state: 'idle' | 'saving' | 'saved' | 'error'; savedAt: number | null; error?: string }

export const IDLE_STATUS: SaveStatus = { state: 'idle', savedAt: null }

/**
 * Autosave status of the open document, for the top bar:
 *  - idle:   nothing changed since the document was opened,
 *  - saving: changes are waiting for (or in) the debounced write,
 *  - saved:  everything is stored on this device (`savedAt`),
 *  - error:  the last write failed (`error` is a short, human-readable reason, in the interface
 *            language of the moment it failed).
 */
export const useSaveStatusStore = create<SaveStatus>(() => IDLE_STATUS)

export function setSaveStatus(next: SaveStatus): void {
  const cur = useSaveStatusStore.getState()
  if (cur.state === next.state && cur.savedAt === next.savedAt && cur.error === next.error) return
  useSaveStatusStore.setState(next, true)
}

/** Short reason for a failed IndexedDB write (a sentence, in the interface language). */
export function describeStorageError(err: unknown): string {
  const name = typeof err === 'object' && err !== null && 'name' in err ? String(err.name) : ''
  const reason = getT().editor.storage
  // Storage can't be used at all (see `StorageUnavailableError`).
  if (name === 'StorageUnavailableError') return reason.blocked
  if (name === 'QuotaExceededError') return reason.full
  if (name === 'InvalidStateError' || name === 'SecurityError') return reason.window
  if (name === 'DataCloneError') return reason.content
  return reason.other
}
