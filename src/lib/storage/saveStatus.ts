import { create } from 'zustand'

export type SaveStatus = { state: 'idle' | 'saving' | 'saved' | 'error'; savedAt: number | null; error?: string }

export const IDLE_STATUS: SaveStatus = { state: 'idle', savedAt: null }

/**
 * Autosave status of the open document, for the top bar:
 *  - idle:   nothing changed since the document was opened,
 *  - saving: changes are waiting for (or in) the debounced write,
 *  - saved:  everything is stored on this device (`savedAt`),
 *  - error:  the last write failed (`error` is a short, human-readable reason).
 */
export const useSaveStatusStore = create<SaveStatus>(() => IDLE_STATUS)

export function setSaveStatus(next: SaveStatus): void {
  const cur = useSaveStatusStore.getState()
  if (cur.state === next.state && cur.savedAt === next.savedAt && cur.error === next.error) return
  useSaveStatusStore.setState(next, true)
}

/** Why nothing can be stored where storage can't be used at all (see `StorageUnavailableError`). */
export const STORAGE_BLOCKED = 'This browser is blocking storage for this site.'

/** Short reason for a failed IndexedDB write. */
export function describeStorageError(err: unknown): string {
  const name = typeof err === 'object' && err !== null && 'name' in err ? String(err.name) : ''
  if (name === 'StorageUnavailableError') return STORAGE_BLOCKED
  if (name === 'QuotaExceededError') return 'Storage on this device is full.'
  if (name === 'InvalidStateError' || name === 'SecurityError') return 'Storage is unavailable in this browser window.'
  if (name === 'DataCloneError') return 'This content could not be stored.'
  return 'Storage on this device reported an error.'
}
