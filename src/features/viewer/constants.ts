/** Layout of the document area (CSS px). Fit computations and the DOM must agree on these. */

/** Space above the first page. */
export const PAD_TOP = 24
/** Space below the last page (the floating tool dock overlaps the bottom of the viewer). */
export const PAD_BOTTOM = 120
/** Horizontal padding around pages. */
export const PAD_X = 24
/** Horizontal padding on narrow containers (phones). */
export const PAD_X_NARROW = 12
/** Containers narrower than this use `PAD_X_NARROW`. */
export const NARROW_CONTAINER = 640

/** Vertical gap between page blocks (each block = page frame + its number label). */
export const PAGE_GAP = 16
/** Height of the page-number label row under each page. */
export const PAGE_LABEL_HEIGHT = 24

/** How much of the viewer's bottom edge the floating dock may cover (used for "is it visible?" math). */
export const DOCK_OVERLAP = 88
/** Breathing room above a page scrolled to by `scrollToPage`. */
export const SCROLL_TOP_MARGIN = 16

/** Canvases are only kept for pages within this many viewport heights of the visible area. */
export const NEAR_VIEWPORTS = 1.5

/** Documents up to this size keep every page's form/element layer mounted; bigger ones mount them near the viewport. */
export const ALWAYS_MOUNT_LAYERS_MAX_PAGES = 60

/** Re-render page bitmaps this long after the last change of a continuous zoom gesture. */
export const ZOOM_SETTLE_MS = 120

export function horizontalPadding(containerWidth: number): number {
  return containerWidth > 0 && containerWidth < NARROW_CONTAINER ? PAD_X_NARROW : PAD_X
}
