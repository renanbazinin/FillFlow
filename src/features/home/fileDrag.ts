import { useSyncExternalStore } from 'react'

/**
 * Whether files are being dragged over the window, shared between the global drop overlay
 * (which owns the window listeners) and the home dropzone (which lights up while it's true).
 */
export type FileDragKind = 'pdf' | 'other' | 'unknown'

export interface FileDragState {
  active: boolean
  /** What's being dragged, as far as the browser tells us before the drop. */
  kind: FileDragKind
}

const IDLE: FileDragState = { active: false, kind: 'unknown' }
let state: FileDragState = IDLE
const listeners = new Set<() => void>()

export function setFileDrag(next: FileDragState | null): void {
  const value = next ?? IDLE
  if (value.active === state.active && value.kind === state.kind) return
  state = value
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function useFileDrag(): FileDragState {
  return useSyncExternalStore(subscribe, () => state, () => IDLE)
}

/** True when the drag carries files (not text or links dragged from a page). */
export function dragHasFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false
  return Array.from(dt.types).includes('Files')
}

/**
 * Best-effort classification while dragging. Browsers expose item MIME types during the drag
 * (not file names), and some report an empty type, which we treat as "unknown".
 */
export function classifyDrag(items: ArrayLike<Pick<DataTransferItem, 'kind' | 'type'>> | null | undefined): FileDragKind {
  if (!items) return 'unknown'
  const files = Array.from(items).filter((i) => i.kind === 'file')
  if (!files.length) return 'unknown'
  if (files.some((i) => i.type === 'application/pdf')) return 'pdf'
  if (files.some((i) => !i.type || i.type === 'application/octet-stream')) return 'unknown'
  return 'other'
}
