import type { Element } from '../../model/types'
import type { EditorState } from '../../store/editor'

/**
 * The pages being worked on, whose layers stay mounted however far they are scrolled (see PageView).
 * Memoized on the inputs' identity: every page asks on every store change.
 */

const NO_PAGES: ReadonlySet<number> = new Set()

let editing: { elements: Element[]; id: string; page: number } | null = null
let selected: { elements: Element[]; ids: string[]; pages: ReadonlySet<number> } | null = null

/** Page of the text being typed into, or -1. */
export function editingPage(s: Pick<EditorState, 'elements' | 'editingId'>): number {
  const id = s.editingId
  if (id === null) return -1
  if (!editing || editing.elements !== s.elements || editing.id !== id) {
    editing = { elements: s.elements, id, page: s.elements.find((e) => e.id === id)?.page ?? -1 }
  }
  return editing.page
}

/** Pages holding the selection. */
export function selectionPages(s: Pick<EditorState, 'elements' | 'selection'>): ReadonlySet<number> {
  if (!s.selection.length) return NO_PAGES
  if (!selected || selected.elements !== s.elements || selected.ids !== s.selection) {
    const ids = new Set(s.selection)
    const pages = new Set<number>()
    for (const e of s.elements) if (ids.has(e.id)) pages.add(e.page)
    selected = { elements: s.elements, ids: s.selection, pages }
  }
  return selected.pages
}
