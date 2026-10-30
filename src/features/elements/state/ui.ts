import { create } from 'zustand'
import type { Element } from '../../../model/types'

/**
 * Transient, non-undoable UI state shared between the page layers, the context toolbar and the
 * items panel. Kept out of the editor store so pointer-rate updates never touch it.
 */
export type Interaction = 'idle' | 'move' | 'resize' | 'marquee' | 'create'

export interface DropPreview {
  /** Page the dragged element will land on. */
  page: number
  /** The element as it would look there (view space of `page`). */
  element: Element
}

/** Right-click menu for the selection, opened over `page` at a client point. */
export interface ContextMenuAt {
  page: number
  x: number
  y: number
}

interface ElementsUiState {
  /** Element under the pointer (page) or under a hovered row (items panel). */
  hoveredId: string | null
  interaction: Interaction
  /** Cross-page drop target while dragging a single element over another page. */
  dropPreview: DropPreview | null
  /** Bumped whenever an element font finishes loading (text re-layout). */
  fontVersion: number
  contextMenu: ContextMenuAt | null
}

export const useElementsUi = create<ElementsUiState>(() => ({
  hoveredId: null,
  interaction: 'idle',
  dropPreview: null,
  fontVersion: 0,
  contextMenu: null,
}))

export function setContextMenu(at: ContextMenuAt | null): void {
  useElementsUi.setState({ contextMenu: at })
}

export function setHovered(id: string | null): void {
  if (useElementsUi.getState().hoveredId !== id) useElementsUi.setState({ hoveredId: id })
}

/** Clears the hover only if it still points at `id` (pointerleave after another enter). */
export function clearHovered(id: string): void {
  if (useElementsUi.getState().hoveredId === id) useElementsUi.setState({ hoveredId: null })
}

export function setInteraction(interaction: Interaction): void {
  if (useElementsUi.getState().interaction !== interaction) useElementsUi.setState({ interaction })
}

export function setDropPreview(preview: DropPreview | null): void {
  const cur = useElementsUi.getState().dropPreview
  if (cur === preview) return
  if (cur && preview && cur.page === preview.page && cur.element === preview.element) return
  useElementsUi.setState({ dropPreview: preview })
}
