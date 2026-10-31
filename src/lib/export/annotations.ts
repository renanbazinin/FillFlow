import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  type PDFDocument,
  type PDFObject,
  type PDFOperator,
  type PDFPage,
} from 'pdf-lib'
import type { Element, PageInfo, Rect } from '../../model/types'
import { pdfRectToViewRect, rectsIntersect } from '../pdf/geometry'
import { r } from './num'

/**
 * The editor paints the page's own markup annotations (comments, stamps, shapes, ink…) into the
 * page bitmap, under the placed elements. Viewers paint annotations above all page content, so
 * in the export they would cover a whiteout or a signature placed over them. The ones under an
 * element are therefore baked into the page content (where the elements are drawn over them) and
 * removed, with their pop-ups. Page content prints, so only annotations that print are baked:
 * screen-only ones stay annotations (as flattening does with screen-only widgets).
 */

type Matrix = [number, number, number, number, number, number]

/** Annotation types whose appearance is plain markup (nothing interactive or embedded is lost). */
const BAKEABLE = new Set(['Text', 'FreeText', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Highlight', 'Underline', 'Squiggly', 'StrikeOut', 'Caret', 'Ink', 'Stamp', 'Watermark'])
/** Text markup, which pdf.js (the editor) draws only with valid /QuadPoints. */
const TEXT_MARKUP = new Set(['Highlight', 'Underline', 'Squiggly', 'StrikeOut'])

/** Flags that keep an annotation off the screen: Hidden, NoView. */
const OFF_SCREEN = 2 | 32
/** Invisible: hides only types the viewer doesn't know (of the ones above, pdf.js doesn't know Watermark). */
const INVISIBLE = 1
/** The Print flag (unset by default): without it, an annotation never reaches paper. */
const PRINT = 4

const N = PDFName.of('N')
const SUBTYPE = PDFName.of('Subtype')
const POPUP = PDFName.of('Popup')
const PARENT = PDFName.of('Parent')

function numbers(obj: PDFObject | undefined, length: number): number[] | null {
  if (!(obj instanceof PDFArray) || obj.size() !== length) return null
  // Elements may be indirect: pdf.js (the editor) resolves them.
  const out = Array.from({ length }, (_, i) => obj.lookup(i)).map((o) => (o instanceof PDFNumber ? o.asNumber() : NaN))
  return out.every(Number.isFinite) ? out : null
}

/** Whether pdf.js (the editor) shows the annotation on screen and in print: its viewable / printable rules. */
function shownAndPrinted(dict: PDFDict, type: string): boolean {
  // Flags that aren't a positive integer count as none.
  const flags = dict.lookup(PDFName.of('F'))
  const f = flags instanceof PDFNumber && Number.isInteger(flags.asNumber()) && flags.asNumber() > 0 ? flags.asNumber() : 0
  if (!(f & PRINT) || f & OFF_SCREEN || (f & INVISIBLE && type === 'Watermark')) return false
  if (!TEXT_MARKUP.has(type)) return true
  const quads = dict.lookup(PDFName.of('QuadPoints'))
  const n = quads instanceof PDFArray ? quads.size() : 0
  return n > 0 && n % 8 === 0 && numbers(quads, n) !== null
}

/** PDF 32000-1 §12.5.5: maps the appearance's transformed BBox onto the annotation's /Rect. */
export function appearancePlacement(appearance: PDFStream, rect: number[]): Matrix | null {
  const bbox = numbers(appearance.dict.lookup(PDFName.of('BBox')), 4)
  if (!bbox) return null
  const [a, b, c, d, e, f] = (numbers(appearance.dict.lookup(PDFName.of('Matrix')), 6) ?? [1, 0, 0, 1, 0, 0]) as Matrix
  const corners = [
    [bbox[0], bbox[1]],
    [bbox[2], bbox[1]],
    [bbox[0], bbox[3]],
    [bbox[2], bbox[3]],
  ].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f])
  const xs = corners.map((p) => p[0])
  const ys = corners.map((p) => p[1])
  const tx0 = Math.min(...xs)
  const ty0 = Math.min(...ys)
  const tw = Math.max(...xs) - tx0
  const th = Math.max(...ys) - ty0
  const rx = Math.min(rect[0], rect[2])
  const ry = Math.min(rect[1], rect[3])
  const rw = Math.abs(rect[2] - rect[0])
  const rh = Math.abs(rect[3] - rect[1])
  if (tw < 1e-6 || th < 1e-6 || rw < 1e-6 || rh < 1e-6) return null
  const sx = rw / tw
  const sy = rh / th
  return [sx, 0, 0, sy, rx - tx0 * sx, ry - ty0 * sy]
}

/** The normal appearance a viewer shows for the annotation (/AS picks a state when there are several). */
function normalAppearance(doc: PDFDocument, annot: PDFDict): PDFRef | null {
  const ap = annot.lookup(PDFName.of('AP'))
  if (!(ap instanceof PDFDict)) return null
  let target = ap.get(N)
  const states = target instanceof PDFRef ? doc.context.lookup(target) : target
  if (states instanceof PDFDict) {
    const state = annot.lookup(PDFName.of('AS'))
    target = state instanceof PDFName ? states.get(state) : undefined
  }
  return target instanceof PDFRef && doc.context.lookup(target) instanceof PDFStream ? target : null
}

/** Where an element can paint, in view space (strokes of lines and ink reach past the box). */
function paintBox(el: Element): Rect {
  const pad = 1 + (el.kind === 'ink' || (el.kind === 'shape' && el.shape === 'line') ? el.strokeWidth / 2 : 0)
  return { x: el.x - pad, y: el.y - pad, width: el.width + 2 * pad, height: el.height + 2 * pad }
}

interface Entry {
  dict: PDFDict
  ref?: PDFRef
  /** /Rect in view space. */
  view: Rect
  /** Appearance and its placement, when the annotation can be baked. */
  bake: { ap: PDFRef; m: Matrix } | null
}

/**
 * Bakes the markup annotations of `page` that show on screen and in print and lie under
 * `elements` into its content, keeping their stacking order, and removes them (and their
 * pop-ups) from /Annots. Annotations painted below a baked one are baked too, so they stay
 * below it. Returns how many were baked.
 */
export function bakeAnnotationsUnder(doc: PDFDocument, page: PDFPage, info: PageInfo, elements: Element[]): number {
  const annots = page.node.Annots()
  if (!annots || !elements.length) return 0
  const entries: Entry[] = []
  for (let i = 0; i < annots.size(); i++) {
    const dict = annots.lookup(i)
    const raw = annots.get(i)
    if (!(dict instanceof PDFDict)) continue
    const rect = numbers(dict.lookup(PDFName.of('Rect')), 4)
    if (!rect) continue
    const subtype = dict.lookup(SUBTYPE)
    const type = subtype instanceof PDFName ? subtype.decodeText() : ''
    let bake: Entry['bake'] = null
    // What the editor doesn't show, screen-only annotations, and those in an optional content
    // group (which keep their own visibility rules), are left alone.
    if (BAKEABLE.has(type) && shownAndPrinted(dict, type) && !dict.has(PDFName.of('OC'))) {
      const ap = normalAppearance(doc, dict)
      const m = ap ? appearancePlacement(doc.context.lookup(ap) as PDFStream, rect) : null
      if (ap && m) bake = { ap, m }
    }
    entries.push({ dict, ref: raw instanceof PDFRef ? raw : undefined, view: pdfRectToViewRect(info, rect), bake })
  }

  const boxes = elements.map(paintBox)
  const baked: Entry[] = []
  for (let i = entries.length - 1; i >= 0; i--) {
    const { view, bake } = entries[i]
    if (bake && (boxes.some((b) => rectsIntersect(b, view)) || baked.some((e) => rectsIntersect(e.view, view)))) baked.unshift(entries[i])
  }
  if (!baked.length) return 0

  const ops: PDFOperator[] = []
  for (const { bake } of baked) {
    const name = page.node.newXObject('FlatAnnot', bake!.ap)
    ops.push(pushGraphicsState(), concatTransformationMatrix(...(bake!.m.map(r) as Matrix)), drawObject(name), popGraphicsState())
  }
  page.pushOperators(...ops)

  // Remove the baked annotations and their pop-ups (linked either way).
  const gone = new Set<PDFObject>()
  for (const { ref, dict } of baked) {
    gone.add(ref ?? dict)
    const popup = dict.get(PDFName.of('Popup'))
    if (popup) gone.add(popup)
  }
  for (let i = annots.size() - 1; i >= 0; i--) {
    const dict = annots.lookup(i)
    const popupOfBaked = dict instanceof PDFDict && dict.get(SUBTYPE) === POPUP && gone.has(dict.get(PARENT) as PDFObject)
    if (gone.has(annots.get(i)) || popupOfBaked) annots.remove(i)
  }
  return baked.length
}
