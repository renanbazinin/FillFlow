import {
  createImageElement,
  createInkElement,
  createMarkElement,
  createShapeElement,
  createTextElement,
  formatDate,
} from '../../../model/elements'
import type { Element, ImageRole, MarkShape, PageInfo, Point, ShapeElement, StyleDefaults, ToolId } from '../../../model/types'

/** The parts of a page the placement code needs. */
export type PageRef = Pick<PageInfo, 'index' | 'width' | 'height'>
import { useEditor } from '../../../store/editor'
import { caretIndexAt } from '../lib/caret'
import { lineFromEndpoints, topmostAt } from '../lib/geometry'
import { appendInkStroke } from '../lib/ink'
import { defaultBoxRect, defaultLine, imageRect, markRect, STICKY_TOOLS, textOrigin, type BoxTool } from '../lib/placement'
import { editText, finishActiveTextEdit, startNewText } from '../state/textEdit'

/**
 * Placement commands for the creation tools. Each one returns the tool to Select afterwards
 * unless the tool is sticky (✓ ✗ • pen highlight) or locked by the user.
 */

function keepsTool(tool: ToolId): boolean {
  return STICKY_TOOLS.has(tool) || useEditor.getState().toolLocked
}

function addAndMaybeReturn(tool: ToolId, el: Element) {
  const s = useEditor.getState()
  if (!keepsTool(tool)) s.setTool('select')
  useEditor.getState().addElement(el)
}

/** The text element (if any) a text-tool click lands on. */
export function textUnder(page: number, p: Point): Element | null {
  const els = useEditor.getState().elements.filter((e) => e.page === page)
  return topmostAt(els, p, (e) => e.kind === 'text', 2)
}

export function placeText(page: PageRef, p: Point): void {
  const hit = textUnder(page.index, p)
  if (hit && hit.kind === 'text') {
    if (!keepsTool('text')) useEditor.getState().setTool('select')
    editText(hit.id, caretIndexAt(hit.text, hit, hit.align, { x: p.x - hit.x, y: p.y - hit.y }))
    return
  }
  const s = useEditor.getState()
  const el = createTextElement(page.index, { x: 0, y: 0 }, s.styles.text)
  const at = textOrigin(p, el.fontSize, el.width, page)
  if (!keepsTool('text')) s.setTool('select')
  startNewText({ ...el, x: at.x, y: at.y })
}

/** Today's date as a text element, preview and placement share this. */
export function dateElement(page: PageRef, p: Point, styles: StyleDefaults): Element {
  const el = createTextElement(page.index, { x: 0, y: 0 }, styles.text, formatDate(new Date(), styles.dateFormat))
  const at = textOrigin(p, el.fontSize, el.width, page)
  return { ...el, x: at.x, y: at.y }
}

export function placeDate(page: PageRef, p: Point): void {
  finishActiveTextEdit()
  addAndMaybeReturn('date', dateElement(page, p, useEditor.getState().styles))
}

export function markElement(page: PageRef, p: Point, shape: MarkShape, styles: StyleDefaults): Element {
  const el = createMarkElement(page.index, p, shape, styles.mark)
  const r = markRect(p, el.width, page)
  return { ...el, x: r.x, y: r.y }
}

export function placeMark(page: PageRef, p: Point, shape: MarkShape): void {
  finishActiveTextEdit()
  addAndMaybeReturn(shape, markElement(page, p, shape, useEditor.getState().styles))
}

export function placeAsset(page: PageRef, p: Point, role: ImageRole): boolean {
  const s = useEditor.getState()
  const assetId = s.placingAssetId
  const asset = assetId ? s.assets[assetId] : undefined
  if (!assetId || !asset) return false
  finishActiveTextEdit()
  const aspect = asset.width / (asset.height || 1)
  const r = imageRect(p, role, aspect, page)
  const el = createImageElement(page.index, { x: r.x + r.width / 2, y: r.y + r.height / 2 }, role, assetId, aspect, r.width)
  if (!keepsTool(role)) s.setTool('select')
  useEditor.getState().addElement({ ...el, x: r.x, y: r.y, width: r.width, height: r.height })
  return true
}

export function boxShape(page: number, tool: BoxTool, rect: { x: number; y: number; width: number; height: number }, styles: StyleDefaults): ShapeElement {
  if (tool === 'highlight') return createShapeElement(page, rect, 'rect', styles.shape, 'highlight')
  if (tool === 'whiteout') return createShapeElement(page, rect, 'rect', styles.shape, 'whiteout')
  return createShapeElement(page, rect, tool, styles.shape)
}

export function lineShape(page: number, a: Point, b: Point, styles: StyleDefaults): ShapeElement {
  const box = lineFromEndpoints(a, b)
  const el = createShapeElement(page, { x: box.x, y: box.y, width: box.width, height: box.height }, 'line', styles.shape)
  return { ...el, flip: box.flip }
}

/** Creates a box shape from a drag (or the default size for a plain click). */
export function placeBox(page: PageRef, tool: BoxTool, rect: { x: number; y: number; width: number; height: number } | null, click: Point): void {
  finishActiveTextEdit()
  const r = rect ?? defaultBoxRect(tool, click, page)
  addAndMaybeReturn(tool, boxShape(page.index, tool, r, useEditor.getState().styles))
}

export function placeLine(page: PageRef, ends: [Point, Point] | null, click: Point): void {
  finishActiveTextEdit()
  const [a, b] = ends ?? defaultLine(click, page)
  addAndMaybeReturn('line', lineShape(page.index, a, b, useEditor.getState().styles))
}

// --- ink -------------------------------------------------------------------

/** Strokes started this soon after the previous one join the same drawing. */
const INK_JOIN_MS = 1200
let lastInk: { id: string; page: number; endedAt: number } | null = null

/** Decided when a stroke starts: the drawing it would extend, if any. */
export function inkJoinTarget(page: number, now: number): string | null {
  return lastInk && lastInk.page === page && now - lastInk.endedAt < INK_JOIN_MS ? lastInk.id : null
}

export function commitInkStroke(page: number, stroke: Point[], joinId: string | null): void {
  if (!stroke.length) return
  const s = useEditor.getState()
  const style = s.styles.ink
  const prev = joinId ? s.elements.find((e) => e.id === joinId) : undefined
  if (prev && prev.kind === 'ink' && !prev.locked && prev.color === style.color && prev.strokeWidth === style.strokeWidth) {
    s.updateElement(prev.id, appendInkStroke(prev, stroke))
    if (s.selection.length !== 1 || s.selection[0] !== prev.id) s.select([prev.id])
    lastInk = { id: prev.id, page, endedAt: performance.now() }
    return
  }
  const el = createInkElement(page, [stroke], style)
  if (!el) return
  s.addElement(el)
  lastInk = { id: el.id, page, endedAt: performance.now() }
}
