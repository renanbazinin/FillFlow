import { useEditor, type EditorState } from '../../store/editor'
import type { PageInfo } from '../../model/types'

/** Thumbnail box: 150 CSS px wide for portrait/landscape pages, height-limited for very tall ones. */
export const THUMB_WIDTH = 150
export const THUMB_MAX_HEIGHT = 220

export function thumbnailSize(page: Pick<PageInfo, 'width' | 'height'>): { width: number; height: number } {
  if (page.width <= 0 || page.height <= 0) return { width: THUMB_WIDTH, height: Math.round(THUMB_WIDTH * 1.294) }
  let width = THUMB_WIDTH
  let height = (THUMB_WIDTH * page.height) / page.width
  if (height > THUMB_MAX_HEIGHT) {
    height = THUMB_MAX_HEIGHT
    width = (THUMB_MAX_HEIGHT * page.width) / page.height
  }
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) }
}

/** Thumbnails render at ~2× (3× on very dense screens). */
export function thumbnailPixelRatio(dpr: number): number {
  return Math.min(3, Math.max(2, dpr || 1))
}

const sameValue = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

type BadgeInput = Pick<EditorState, 'doc' | 'elements' | 'formValues'>

let memo: { doc: BadgeInput['doc']; elements: BadgeInput['elements']; formValues: BadgeInput['formValues']; counts: number[] } | null = null

/**
 * Per page: placed elements + form fields (with a widget on that page) whose value differs from
 * the document's original value. Memoized on the inputs' identity, so it is cheap as a selector.
 */
export function pageBadgeCounts(s: BadgeInput): number[] {
  if (memo && memo.doc === s.doc && memo.elements === s.elements && memo.formValues === s.formValues) return memo.counts
  const n = s.doc?.pages.length ?? 0
  const counts = new Array<number>(n).fill(0)
  for (const e of s.elements) if (e.page >= 0 && e.page < n) counts[e.page]++
  for (const field of s.doc?.formFields ?? []) {
    const value = s.formValues[field.name]
    if (value === undefined || sameValue(value, field.defaultValue)) continue
    const pages = new Set<number>()
    for (const w of field.widgets) if (w.page >= 0 && w.page < n) pages.add(w.page)
    for (const p of pages) counts[p]++
  }
  memo = { doc: s.doc, elements: s.elements, formValues: s.formValues, counts }
  return counts
}

// ---------------------------------------------------------------------------
// Rendered thumbnails, cached per document as small JPEG object URLs (a few KB each), so
// collapsing and re-opening the panel is instant and costs no canvas memory.
// ---------------------------------------------------------------------------

let cachedDocId: string | null = null
const cache = new Map<number, string>()

export function getCachedThumbnail(docId: string, index: number): string | undefined {
  return docId === cachedDocId ? cache.get(index) : undefined
}

/** Stores a thumbnail URL; returns false (caller should revoke it) when `docId` isn't the live document. */
export function cacheThumbnail(docId: string, index: number, url: string, liveDocId: string | null): boolean {
  if (docId !== liveDocId) return false
  if (docId !== cachedDocId) retainThumbnailsFor(docId)
  const previous = cache.get(index)
  if (previous && previous !== url) URL.revokeObjectURL(previous)
  cache.set(index, url)
  return true
}

/** Drops (and revokes) thumbnails that belong to any other document. */
export function retainThumbnailsFor(docId: string | null): void {
  if (docId === cachedDocId) return
  for (const url of cache.values()) URL.revokeObjectURL(url)
  cache.clear()
  cachedDocId = docId
}

// Free the previous document's thumbnails as soon as another one is opened (or the editor closes).
useEditor.subscribe((s) => s.doc?.id ?? null, (id) => retainThumbnailsFor(id))
