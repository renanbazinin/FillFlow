import { layoutTextBlock, type TextMeasurer } from '../lib/text/layout'
import { createId } from '../lib/utils/id'
import type {
  DateFormat,
  Element,
  ImageElement,
  ImageRole,
  InkElement,
  MarkElement,
  MarkShape,
  Point,
  Rect,
  ShapeElement,
  ShapeType,
  StyleDefaults,
  TextAlign,
  TextElement,
} from './types'

// ---------------------------------------------------------------------------
// Marks: filled vector outlines in a 24×24 box. Used verbatim by the on-screen SVG renderer
// and by the exporter (pdf-lib `drawSvgPath`, scale = size / 24), so they always match.
// ---------------------------------------------------------------------------

export const MARK_VIEWBOX = 24

export const MARK_PATHS: Record<MarkShape, string> = {
  check: 'M3.4 12.6 L5.9 10.1 L9.6 13.8 L18.1 5.3 L20.6 7.8 L9.6 18.8 Z',
  cross: 'M5.3 7.6 L7.6 5.3 L12 9.7 L16.4 5.3 L18.7 7.6 L14.3 12 L18.7 16.4 L16.4 18.7 L12 14.3 L7.6 18.7 L5.3 16.4 L9.7 12 Z',
  // Circle of radius 5 built from 4 cubic Béziers (k = 0.5523 * r).
  dot: 'M12 7 C14.7614 7 17 9.2386 17 12 C17 14.7614 14.7614 17 12 17 C9.2386 17 7 14.7614 7 12 C7 9.2386 9.2386 7 12 7 Z',
}

// ---------------------------------------------------------------------------
// Defaults & presets.
// ---------------------------------------------------------------------------

/** Ink colors offered everywhere (first = default). */
export const INK_COLORS = ['#111827', '#1d4ed8', '#c81e1e', '#047857', '#7c3aed', '#ffffff'] as const

export const DEFAULT_STYLES: StyleDefaults = {
  text: { fontId: 'sans', fontSize: 12, color: '#111827', bold: false, align: 'left' },
  mark: { color: '#111827', size: 14 },
  shape: { strokeColor: '#c81e1e', fillColor: null, strokeWidth: 1.5 },
  ink: { color: '#1d4ed8', strokeWidth: 2 },
  dateFormat: 'dd/MM/yyyy',
}

export const TEXT_LINE_HEIGHT = 1.2
export const MIN_FONT_SIZE = 4
export const MAX_FONT_SIZE = 144
export const MIN_ELEMENT_SIZE = 4

export const HIGHLIGHT_COLOR = '#fde047'
export const HIGHLIGHT_OPACITY = 0.4
export const WHITEOUT_COLOR = '#ffffff'

/** Default size (points) of a new signature / initials / image, by role. */
export const IMAGE_DEFAULT_WIDTH: Record<ImageRole, number> = { signature: 150, initials: 60, image: 180 }
/** Default height limit (points), by role: narrow or tall content gets narrower instead of taller. */
export const IMAGE_DEFAULT_MAX_HEIGHT: Record<ImageRole, number> = { signature: 60, initials: 40, image: 240 }

// ---------------------------------------------------------------------------
// Factories. Positions are the element's top-left in view space unless noted.
// ---------------------------------------------------------------------------

export function createTextElement(
  page: number,
  at: Point,
  style: StyleDefaults['text'],
  text = '',
  measure?: TextMeasurer,
): TextElement {
  const base = {
    fontId: style.fontId,
    bold: style.bold,
    fontSize: style.fontSize,
    lineHeight: TEXT_LINE_HEIGHT,
    letterSpacing: 0,
  }
  const layout = layoutTextBlock(text, base, style.align, measure)
  return {
    id: createId(),
    kind: 'text',
    page,
    x: at.x,
    y: at.y,
    width: layout.width,
    height: layout.height,
    text,
    color: style.color,
    align: style.align,
    ...base,
  }
}

/** Where a text block is anchored across its width, by alignment: the part that stays put as it grows. */
export const TEXT_ANCHOR: Record<TextAlign, number> = { left: 0, center: 0.5, right: 1 }

/** Re-measures a text element after a text/style change, keeping its anchor edge for the alignment. */
export function withTextLayout(el: TextElement, measure?: TextMeasurer): TextElement {
  const layout = layoutTextBlock(el.text, el, el.align, measure)
  let x = el.x
  if (el.align === 'center') x = el.x + (el.width - layout.width) / 2
  else if (el.align === 'right') x = el.x + el.width - layout.width
  return { ...el, x, width: layout.width, height: layout.height }
}

/**
 * Keeps a text block that was laid out again (typed into, restyled) inside its page, as moving
 * and resizing do: it moves away from an edge it grows into, and sticks out past an edge only as
 * far as it already did (`before`). A block too big for the page keeps its top and the side it
 * grows from (by its alignment) on the page; the rest is cut at the page edge, on screen as in
 * the export.
 */
export function keepTextInPage(el: TextElement, before: Rect, page: { width: number; height: number }): TextElement {
  const x = fitSpan(el.x, el.width, Math.min(0, before.x), Math.max(page.width, before.x + before.width), TEXT_ANCHOR[el.align])
  const y = fitSpan(el.y, el.height, Math.min(0, before.y), Math.max(page.height, before.y + before.height), 0)
  return x === el.x && y === el.y ? el : { ...el, x, y }
}

/** Start of a span of `size` moved inside [min, max]; a longer one keeps its anchor (0 start, 1 end) on the bound. */
function fitSpan(start: number, size: number, min: number, max: number, anchor: number): number {
  if (size > max - min) return min + (max - min - size) * anchor
  return Math.min(Math.max(start, min), max - size)
}

/** `center` is the mark's center point. */
export function createMarkElement(page: number, center: Point, shape: MarkShape, style: StyleDefaults['mark']): MarkElement {
  const s = style.size
  return { id: createId(), kind: 'mark', page, x: center.x - s / 2, y: center.y - s / 2, width: s, height: s, shape, color: style.color }
}

/** `center` is the image's center point; `width` defaults by role, height follows the aspect ratio. */
export function createImageElement(
  page: number,
  center: Point,
  role: ImageRole,
  assetId: string,
  aspect: number,
  width = IMAGE_DEFAULT_WIDTH[role],
): ImageElement {
  const height = width / (aspect || 1)
  return { id: createId(), kind: 'image', page, x: center.x - width / 2, y: center.y - height / 2, width, height, role, assetId, opacity: 1 }
}

export function createShapeElement(
  page: number,
  rect: { x: number; y: number; width: number; height: number },
  shape: ShapeType,
  style: StyleDefaults['shape'],
  preset?: 'highlight' | 'whiteout',
): ShapeElement {
  const common = { id: createId(), kind: 'shape' as const, page, ...rect, shape }
  if (preset === 'highlight') {
    return { ...common, shape: 'rect', strokeColor: null, fillColor: HIGHLIGHT_COLOR, strokeWidth: 0, opacity: HIGHLIGHT_OPACITY }
  }
  if (preset === 'whiteout') {
    return { ...common, shape: 'rect', strokeColor: null, fillColor: WHITEOUT_COLOR, strokeWidth: 0, opacity: 1 }
  }
  return {
    ...common,
    strokeColor: style.strokeColor,
    fillColor: shape === 'line' ? null : style.fillColor,
    strokeWidth: style.strokeWidth,
    opacity: 1,
    ...(shape === 'line' ? { flip: false } : {}),
  }
}

/**
 * Builds an ink element from strokes in *view-space* points; computes the bounding box
 * (padded by half the stroke width) and normalizes the points into it.
 */
export function createInkElement(page: number, strokes: Point[][], style: StyleDefaults['ink']): InkElement | null {
  const pts = strokes.flat()
  if (!pts.length) return null
  const pad = style.strokeWidth / 2
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (const p of pts) {
    x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y)
  }
  x1 -= pad; y1 -= pad; x2 += pad; y2 += pad
  const w = Math.max(x2 - x1, 1)
  const h = Math.max(y2 - y1, 1)
  return {
    id: createId(),
    kind: 'ink',
    page,
    x: x1,
    y: y1,
    width: w,
    height: h,
    strokes: strokes.map((s) => s.flatMap((p) => [(p.x - x1) / w, (p.y - y1) / h])),
    color: style.color,
    strokeWidth: style.strokeWidth,
  }
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** Whether resizing should preserve the aspect ratio by default. */
export function keepsAspectRatio(el: Element): boolean {
  return el.kind === 'mark' || el.kind === 'image' || el.kind === 'text'
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function formatDate(date: Date, format: DateFormat): string {
  const d = date.getDate()
  const m = date.getMonth() + 1
  const y = date.getFullYear()
  const dd = String(d).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  switch (format) {
    case 'MM/dd/yyyy':
      return `${mm}/${dd}/${y}`
    case 'yyyy-MM-dd':
      return `${y}-${mm}-${dd}`
    case 'd MMM yyyy':
      return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`
    case 'MMMM d, yyyy':
      return `${MONTHS[m - 1]} ${d}, ${y}`
    case 'dd.MM.yyyy':
      return `${dd}.${mm}.${y}`
    default:
      return `${dd}/${mm}/${y}`
  }
}

export const DATE_FORMATS: DateFormat[] = ['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 'dd.MM.yyyy', 'd MMM yyyy', 'MMMM d, yyyy']

/** The browser's languages, most preferred first. */
function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return ['en-GB']
  return navigator.languages?.length ? navigator.languages : [navigator.language ?? '']
}

/** The device's time zone (IANA name), or '' when it can't be told. */
function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
  } catch {
    return ''
  }
}

/**
 * Locale-appropriate default date format: month first only for US-style English and Filipino
 * browsers, and not for people who also read Hebrew or Arabic, or who are in Israel. Many there
 * run their browser in US English (Chrome reports its own language) but write dates day first.
 */
export function defaultDateFormat(languages: readonly string[] = browserLanguages(), timeZone: string = localTimeZone()): DateFormat {
  if (languages.some((l) => /^(he|iw|ar)\b/i.test(l)) || /^(Asia\/(Jerusalem|Tel_Aviv|Hebron|Gaza)|Israel)$/.test(timeZone)) return 'dd/MM/yyyy'
  return /^(en-US|en-PH|fil)\b/i.test(languages[0] ?? '') ? 'MM/dd/yyyy' : 'dd/MM/yyyy'
}

/** Short human label for lists ("“John Smith”", "Checkmark", "Signature"…). */
export function elementLabel(el: Element): string {
  switch (el.kind) {
    case 'text': {
      const t = el.text.trim().replace(/\s+/g, ' ')
      return t ? `“${t.length > 40 ? `${t.slice(0, 40)}…` : t}”` : 'Empty text'
    }
    case 'mark':
      return el.shape === 'check' ? 'Checkmark' : el.shape === 'cross' ? 'Cross' : 'Dot'
    case 'image':
      return el.role === 'signature' ? 'Signature' : el.role === 'initials' ? 'Initials' : 'Image'
    case 'shape':
      if (el.fillColor === HIGHLIGHT_COLOR && el.opacity < 1) return 'Highlight'
      if (el.fillColor === WHITEOUT_COLOR && !el.strokeColor) return 'Whiteout'
      return el.shape === 'rect' ? 'Rectangle' : el.shape === 'ellipse' ? 'Ellipse' : 'Line'
    case 'ink':
      return 'Drawing'
  }
}
