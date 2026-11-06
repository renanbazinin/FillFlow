import {
  PDFArray,
  PDFButton,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFSignature,
  PDFStream,
  PDFString,
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
import { flattenFields, markedAsArtifact } from '../pdf/forms/flatten'
import { PageIndex, usesPrintFlag, widgetEntries } from '../pdf/forms/pdfIndex'
import { pdfRectToViewRect } from '../pdf/geometry'
import { protectOriginalContent } from './contentBalance'
import { itemPaintBox, overlaps } from './coverage'
import { r } from './num'

/**
 * The editor paints the page's own markup annotations (comments, stamps, shapes, ink…) into the
 * page bitmap, under the placed elements. Viewers paint annotations above all page content, so
 * in the export they would cover a whiteout or a signature placed over them. The look of the ones
 * under an element is therefore baked into the page content (where the elements are drawn over
 * it). Those that carry a comment (a note, its text, pop-up or replies) stay annotations, with an
 * empty appearance, so the comment is kept; the others are removed. Page content prints, so only
 * annotations that print are baked: screen-only ones stay annotations (as flattening does with
 * screen-only widgets). In a tagged PDF, what is baked is marked as an artifact.
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

const AP = PDFName.of('AP')
const N = PDFName.of('N')
const SUBTYPE = PDFName.of('Subtype')
const WIDGET = PDFName.of('Widget')
const POPUP = PDFName.of('Popup')
const PARENT = PDFName.of('Parent')
const IRT = PDFName.of('IRT')
const CONTENTS = PDFName.of('Contents')
const RC = PDFName.of('RC')

function numbers(obj: PDFObject | undefined, length: number): number[] | null {
  if (!(obj instanceof PDFArray) || obj.size() !== length) return null
  // Elements may be indirect: pdf.js (the editor) resolves them.
  const out = Array.from({ length }, (_, i) => obj.lookup(i)).map((o) => (o instanceof PDFNumber ? o.asNumber() : NaN))
  return out.every(Number.isFinite) ? out : null
}

/** The annotation's flags, as pdf.js reads them: flags that aren't a positive integer count as none. */
function flagsOf(dict: PDFDict): number {
  const flags = dict.lookup(PDFName.of('F'))
  return flags instanceof PDFNumber && Number.isInteger(flags.asNumber()) && flags.asNumber() > 0 ? flags.asNumber() : 0
}

/** Whether pdf.js (the editor) shows the annotation on screen and in print: its viewable / printable rules. */
function shownAndPrinted(dict: PDFDict, type: string): boolean {
  const f = flagsOf(dict)
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

function text(obj: PDFObject | undefined): string {
  return obj instanceof PDFString || obj instanceof PDFHexString ? obj.decodeText() : ''
}

/**
 * Whether the annotation carries a comment, which removing it would lose: a note, text (/Contents
 * or rich text /RC), a pop-up (linked either way), or a place in a thread (a reply, or replied
 * to). `pointedAt`: a pop-up or a reply points at it.
 */
function carriesComment(dict: PDFDict, type: string, pointedAt: boolean): boolean {
  return type === 'Text' || pointedAt || dict.has(POPUP) || dict.has(IRT) || dict.has(RC) || text(dict.lookup(CONTENTS)).trim() !== ''
}

/**
 * The appearance of a kept comment: it draws nothing. It declares a graphics state (Multiply,
 * unused) because Poppler, like Adobe Reader, ignores a Highlight's appearance without one and
 * draws its own from /QuadPoints, over the page and so over the elements.
 */
function emptyAppearance(doc: PDFDocument, size: [number, number]): PDFRef {
  const resources = { ExtGState: { GS0: { Type: 'ExtGState', BM: 'Multiply' } } }
  return doc.context.register(doc.context.formXObject([], { BBox: [0, 0, ...size], Resources: resources }))
}

interface Entry {
  dict: PDFDict
  ref?: PDFRef
  /** /Rect in view space. */
  view: Rect
  /** Appearance and its placement, and the /Rect size, when the annotation can be baked. */
  bake: { ap: PDFRef; m: Matrix; size: [number, number] } | null
  comment: boolean
}

/**
 * Bakes the look of the markup annotations of `page` that show on screen and in print and lie
 * under `elements` into its content, keeping their stacking order. Those that carry a comment
 * stay in /Annots with an empty appearance; the others are removed. Annotations painted below a
 * baked one are baked too, so they stay below it. Returns how many were baked.
 */
export function bakeAnnotationsUnder(doc: PDFDocument, page: PDFPage, info: PageInfo, elements: Element[]): number {
  const annots = page.node.Annots()
  if (!annots || !elements.length) return 0
  // What pop-ups and replies point at.
  const pointedAt = new Set<PDFObject>()
  for (let i = 0; i < annots.size(); i++) {
    const dict = annots.lookup(i)
    if (!(dict instanceof PDFDict)) continue
    const target = dict.lookup(SUBTYPE) === POPUP ? dict.get(PARENT) : dict.get(IRT)
    if (target) pointedAt.add(target)
  }
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
      if (ap && m) bake = { ap, m, size: [Math.abs(rect[2] - rect[0]), Math.abs(rect[3] - rect[1])] }
    }
    const ref = raw instanceof PDFRef ? raw : undefined
    const comment = carriesComment(dict, type, !!ref && pointedAt.has(ref))
    entries.push({ dict, ref, view: pdfRectToViewRect(info, rect), bake, comment })
  }

  const boxes = elements.map(itemPaintBox)
  const baked: Entry[] = []
  for (let i = entries.length - 1; i >= 0; i--) {
    const { view, bake } = entries[i]
    if (bake && (boxes.some((b) => overlaps(b, view)) || baked.some((e) => overlaps(e.view, view)))) baked.unshift(entries[i])
  }
  if (!baked.length) return 0

  const ops: PDFOperator[] = []
  for (const { bake } of baked) {
    const name = page.node.newXObject('FlatAnnot', bake!.ap)
    ops.push(pushGraphicsState(), concatTransformationMatrix(...(bake!.m.map(r) as Matrix)), drawObject(name), popGraphicsState())
  }
  page.pushOperators(...markedAsArtifact(doc, ops))

  // The ones with a comment (with their pop-ups and replies) stay, drawing nothing over the
  // elements; the others are removed.
  const gone = new Set<PDFObject>()
  for (const { ref, dict, bake, comment } of baked) {
    if (comment) dict.set(AP, doc.context.obj({ N: emptyAppearance(doc, bake!.size) }))
    else gone.add(ref ?? dict)
  }
  for (let i = annots.size() - 1; i >= 0; i--) if (gone.has(annots.get(i))) annots.remove(i)
  return baked.length
}

/**
 * Push buttons and signature fields are widgets the editor paints into the page (the forms layer
 * draws the others), so they show under the elements placed on them; viewers paint them over the
 * page content. The forms step flattens the covered fields the user fills or signs, but push
 * buttons and signed signatures aren't offered: the ones with a widget shown under an element
 * are flattened here, as flattening does it (printable widgets are drawn under the elements,
 * screen-only buttons go). Returns how many fields were flattened.
 */
export function flattenButtonsAndSignaturesUnder(doc: PDFDocument, pages: PageInfo[], byPage: Map<number, Element[]>): number {
  // The widgets under elements, read from the pages: when there are none, the form is left as it is.
  const covered = new Set<PDFDict>()
  const docPages = doc.getPages()
  for (const [index, elements] of byPage) {
    const annots = docPages[index]?.node.Annots()
    if (!annots) continue
    const boxes = elements.map(itemPaintBox)
    for (let i = 0; i < annots.size(); i++) {
      const dict = annots.lookup(i)
      if (!(dict instanceof PDFDict) || dict.lookup(SUBTYPE) !== WIDGET || (flagsOf(dict) & OFF_SCREEN) !== 0) continue
      const rect = numbers(dict.lookup(PDFName.of('Rect')), 4)
      if (rect && boxes.some((b) => overlaps(b, pdfRectToViewRect(pages[index], rect)))) covered.add(dict)
    }
  }
  // (getForm() would give a file without a form an empty one.)
  if (!covered.size || !doc.catalog.getAcroForm()) return 0
  const form = doc.getForm()
  const all = form.getFields()
  const fields = all.filter(
    (f) => (f instanceof PDFButton || f instanceof PDFSignature) && widgetEntries(f.acroField).some((e) => covered.has(e.widget.dict)),
  )
  if (!fields.length) return 0

  // Their widgets on other pages are flattened too: protect the original content of those pages.
  const pageIndex = new PageIndex(doc)
  const touched = new Set<PDFPage>()
  for (const field of fields) {
    for (const entry of widgetEntries(field.acroField)) {
      const page = pageIndex.pageOf(entry)
      if (page) touched.add(page)
    }
  }
  for (const page of touched) protectOriginalContent(doc, page)
  // Screen-only signatures are drawn when the file never uses the Print flag, as the forms step does.
  const printFlag = usesPrintFlag(all)
  const failed = flattenFields(doc, form, fields, pageIndex, (f) => !(f instanceof PDFButton) && !printFlag)
  if (failed.length) console.warn(`[export] ${failed.length} button(s) or signature(s) under placed items could not be flattened`)
  return fields.length - failed.length
}
