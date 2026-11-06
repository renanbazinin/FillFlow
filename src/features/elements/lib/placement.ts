import { IMAGE_DEFAULT_MAX_HEIGHT, IMAGE_DEFAULT_WIDTH, MIN_ELEMENT_SIZE, TEXT_LINE_HEIGHT } from '../../../model/elements'
import type { ImageRole, Point, Rect, ToolId } from '../../../model/types'
import { rectFromPoints } from '../../../lib/pdf/geometry'
import { clampPoint, fitRectInPage, snapAngle45, type Size } from './geometry'

/**
 * Where the creation tools put things (view-space points). Shared by the live previews and
 * the actual placement so what you see is exactly what you get.
 */

/** Tools that stay active after placing, for rapid repeated use. */
export const STICKY_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['check', 'cross', 'dot', 'ink', 'highlight'])

export type BoxTool = 'rect' | 'ellipse' | 'highlight' | 'whiteout'

/** Size (points) of a shape made with a plain click. */
export const DEFAULT_SHAPE_SIZE: Record<BoxTool | 'line', Size> = {
  rect: { width: 120, height: 60 },
  ellipse: { width: 120, height: 60 },
  highlight: { width: 160, height: 16 },
  whiteout: { width: 120, height: 24 },
  line: { width: 120, height: 0 },
}

/** Highlights dragged flatter than this get the default height around the drag. */
const MIN_HIGHLIGHT_DRAG = 8

/** Top-left of a new text block so its first line is vertically centered on the click. */
export function textOrigin(click: Point, fontSize: number, blockWidth: number, page: Size): Point {
  const lh = fontSize * TEXT_LINE_HEIGHT
  const r = fitRectInPage({ x: click.x, y: click.y - lh / 2, width: blockWidth, height: lh }, page)
  return { x: r.x, y: r.y }
}

/** A square mark of `size` centered on the click. */
export function markRect(center: Point, size: number, page: Size): Rect {
  return fitRectInPage({ x: center.x - size / 2, y: center.y - size / 2, width: size, height: size }, page)
}

/**
 * An image of the role's default width, or narrower when that would make it taller than the
 * role's default height (initials like "J", tall signatures), shrunk to fit small pages and
 * centered on the click.
 */
export function imageRect(center: Point, role: ImageRole, aspect: number, page: Size): Rect {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1
  const natural = Math.max(Math.min(IMAGE_DEFAULT_WIDTH[role], IMAGE_DEFAULT_MAX_HEIGHT[role] * a), MIN_ELEMENT_SIZE)
  let width = Math.min(natural, page.width * 0.9)
  if (width / a > page.height * 0.9) width = page.height * 0.9 * a
  const height = width / a
  return fitRectInPage({ x: center.x - width / 2, y: center.y - height / 2, width, height }, page)
}

/** Default box for a plain click with a box tool. */
export function defaultBoxRect(tool: BoxTool, center: Point, page: Size): Rect {
  const s = DEFAULT_SHAPE_SIZE[tool]
  const width = Math.min(s.width, page.width)
  const height = Math.min(s.height, page.height)
  return fitRectInPage({ x: center.x - width / 2, y: center.y - height / 2, width, height }, page)
}

/** Default horizontal line for a plain click with the line tool. */
export function defaultLine(center: Point, page: Size): [Point, Point] {
  const half = Math.min(DEFAULT_SHAPE_SIZE.line.width, page.width) / 2
  const cx = Math.max(half, Math.min(center.x, page.width - half))
  const y = Math.max(0, Math.min(center.y, page.height))
  return [
    { x: cx - half, y },
    { x: cx + half, y },
  ]
}

/** The box drawn by dragging from `start` to `cur` (Shift: square for rect/ellipse). */
export function dragBox(tool: BoxTool, start: Point, cur: Point, square: boolean, page: Size): Rect {
  let end = clampPoint(cur, page)
  if (square && (tool === 'rect' || tool === 'ellipse')) {
    const dx = end.x - start.x
    const dy = end.y - start.y
    const sx = Math.sign(dx) || 1
    const sy = Math.sign(dy) || 1
    let side = Math.max(Math.abs(dx), Math.abs(dy))
    side = Math.min(side, sx > 0 ? page.width - start.x : start.x, sy > 0 ? page.height - start.y : start.y)
    end = { x: start.x + sx * side, y: start.y + sy * side }
  }
  let r = rectFromPoints(start, end)
  if (tool === 'highlight' && r.height < MIN_HIGHLIGHT_DRAG) {
    const h = DEFAULT_SHAPE_SIZE.highlight.height
    const cy = r.y + r.height / 2
    r = fitRectInPage({ x: r.x, y: cy - h / 2, width: r.width, height: h }, page)
  }
  return growToMin(r, page)
}

/** The line drawn by dragging (Shift: 45° steps). */
export function dragLine(start: Point, cur: Point, snap45: boolean, page: Size): [Point, Point] {
  const end = snap45 ? snapAngle45(start, cur, page) : clampPoint(cur, page)
  return [start, end]
}

/** Enforces MIN_ELEMENT_SIZE around the rect's center, inside the page. */
function growToMin(r: Rect, page: Size): Rect {
  const width = Math.max(r.width, MIN_ELEMENT_SIZE)
  const height = Math.max(r.height, MIN_ELEMENT_SIZE)
  if (width === r.width && height === r.height) return r
  return fitRectInPage({ x: r.x - (width - r.width) / 2, y: r.y - (height - r.height) / 2, width, height }, page)
}
