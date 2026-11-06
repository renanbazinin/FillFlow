import type { Point, Rect } from '../../model/types'

/**
 * Imperative bridge to the mounted <Viewer>. Other features use it to scroll, zoom, or map
 * screen coordinates onto pages without importing viewer internals. All calls are no-ops
 * when no viewer is mounted.
 *
 * OWNER: viewer agent implements `ViewerHandle` inside the Viewer and calls `registerViewer`.
 */
export interface PagePoint extends Point {
  page: number
}

export interface ScrollToRectOptions {
  behavior?: ScrollBehavior
  margin?: number
  inlineEnd?: boolean
}

export interface ViewerHandle {
  scrollToPage(index: number, opts?: { behavior?: ScrollBehavior }): void
  /**
   * Scrolls so `rect` (view space) on `page` is visible, with some margin. With `inlineEnd`, a rect
   * wider than the view lines up its right edge rather than its left (right-to-left text).
   */
  scrollToRect(page: number, rect: Rect, opts?: ScrollToRectOptions): void
  /** The DOM node of a page's container (holds canvas + layers), if mounted. */
  getPageElement(index: number): HTMLElement | null
  /** Client (screen) coordinates → page + view-space point; null when not over a page. */
  clientToPage(clientX: number, clientY: number): PagePoint | null
  /** View-space point on a page → client coordinates. */
  pageToClient(page: number, p: Point): Point | null
  /** Center of what's visible, as a page point (where to drop items added without a click). */
  getVisibleCenter(): PagePoint | null
  /** Zoom to a scale, keeping the given client point (default: viewport center) fixed. */
  zoomTo(scale: number, anchor?: { clientX: number; clientY: number }): void
  zoomIn(): void
  zoomOut(): void
  fitWidth(): void
  fitPage(): void
  /** The scrolling element. */
  getScrollContainer(): HTMLElement | null
}

let handle: ViewerHandle | null = null

export function registerViewer(h: ViewerHandle | null): void {
  handle = h
}

export const viewer = {
  get mounted() {
    return handle !== null
  },
  scrollToPage: (index: number, opts?: { behavior?: ScrollBehavior }) => handle?.scrollToPage(index, opts),
  scrollToRect: (page: number, rect: Rect, opts?: ScrollToRectOptions) => handle?.scrollToRect(page, rect, opts),
  getPageElement: (index: number) => handle?.getPageElement(index) ?? null,
  clientToPage: (clientX: number, clientY: number) => handle?.clientToPage(clientX, clientY) ?? null,
  pageToClient: (page: number, p: Point) => handle?.pageToClient(page, p) ?? null,
  getVisibleCenter: () => handle?.getVisibleCenter() ?? null,
  zoomTo: (scale: number, anchor?: { clientX: number; clientY: number }) => handle?.zoomTo(scale, anchor),
  zoomIn: () => handle?.zoomIn(),
  zoomOut: () => handle?.zoomOut(),
  fitWidth: () => handle?.fitWidth(),
  fitPage: () => handle?.fitPage(),
  getScrollContainer: () => handle?.getScrollContainer() ?? null,
}
