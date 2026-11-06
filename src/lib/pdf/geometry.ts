import type { PageInfo, Point, Rect } from '../../model/types'

/**
 * Conversions between *view space* (see model/types.ts) and PDF user space.
 *
 * These mirror pdf.js' PageViewport transform at scale 1, so a point the user clicks on the
 * rendered page maps to exactly the PDF location underneath it, for any /Rotate, crop box
 * offset and /UserUnit.
 */

/** Affine matrix [a, b, c, d, e, f] as used by PDF `cm`: x' = a*x + c*y + e, y' = b*x + d*y + f. */
export type Matrix = [number, number, number, number, number, number]

/** View-space point (y down) → PDF user-space point. */
export function viewToPdfPoint(page: PageInfo, p: Point): Point {
  const [x0, y0, x1, y1] = page.view
  const u = page.userUnit || 1
  const vx = p.x / u
  const vy = p.y / u
  switch (page.rotation) {
    case 90:
      return { x: x0 + vy, y: y0 + vx }
    case 180:
      return { x: x1 - vx, y: y0 + vy }
    case 270:
      return { x: x1 - vy, y: y1 - vx }
    default:
      return { x: x0 + vx, y: y1 - vy }
  }
}

/** PDF user-space point → view-space point (y down). */
export function pdfToViewPoint(page: PageInfo, p: Point): Point {
  const [x0, y0, x1, y1] = page.view
  const u = page.userUnit || 1
  switch (page.rotation) {
    case 90:
      return { x: (p.y - y0) * u, y: (p.x - x0) * u }
    case 180:
      return { x: (x1 - p.x) * u, y: (p.y - y0) * u }
    case 270:
      return { x: (y1 - p.y) * u, y: (x1 - p.x) * u }
    default:
      return { x: (p.x - x0) * u, y: (y1 - p.y) * u }
  }
}

/** PDF rect [x1, y1, x2, y2] (any corner order, e.g. an annotation /Rect) → view-space Rect. */
export function pdfRectToViewRect(page: PageInfo, r: [number, number, number, number] | number[]): Rect {
  const a = pdfToViewPoint(page, { x: r[0], y: r[1] })
  const b = pdfToViewPoint(page, { x: r[2], y: r[3] })
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}

/** View-space Rect → normalized PDF rect [llx, lly, urx, ury]. */
export function viewRectToPdfRect(page: PageInfo, r: Rect): [number, number, number, number] {
  const a = viewToPdfPoint(page, { x: r.x, y: r.y })
  const b = viewToPdfPoint(page, { x: r.x + r.width, y: r.y + r.height })
  return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)]
}

/**
 * Matrix for the exporter. After `q <matrix> cm`, drawing with pdf-lib in a coordinate system
 * where (0,0) is the *bottom-left* of the page as the user sees it, x grows right and y grows
 * up (i.e. `u = viewX`, `w = page.height - viewY`), lands exactly where the element is shown.
 * Content drawn this way appears upright even on rotated pages.
 */
export function exportMatrix(page: PageInfo): Matrix {
  const [x0, y0, x1, y1] = page.view
  const k = 1 / (page.userUnit || 1)
  switch (page.rotation) {
    case 90:
      return [0, k, -k, 0, x1, y0]
    case 180:
      return [-k, 0, 0, -k, x1, y1]
    case 270:
      return [0, -k, k, 0, x0, y1]
    default:
      return [k, 0, 0, k, x0, y0]
  }
}

/** Applies a matrix to a point. */
export function applyMatrix(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }
}

// ---------------------------------------------------------------------------
// Small rect helpers (view space).
// ---------------------------------------------------------------------------

export function rectContains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}

export function unionRects(rects: Rect[]): Rect | null {
  if (!rects.length) return null
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const r of rects) {
    x1 = Math.min(x1, r.x)
    y1 = Math.min(y1, r.y)
    x2 = Math.max(x2, r.x + r.width)
    y2 = Math.max(y2, r.y + r.height)
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

/** Moves (not resizes) a rect so it stays inside the page; oversize rects pin to the top-left. */
export function clampRectToPage(r: Rect, page: Pick<PageInfo, 'width' | 'height'>): Rect {
  const x = Math.min(Math.max(r.x, 0), Math.max(0, page.width - r.width))
  const y = Math.min(Math.max(r.y, 0), Math.max(0, page.height - r.height))
  return { ...r, x, y }
}
