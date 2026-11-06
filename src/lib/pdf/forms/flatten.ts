import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  beginMarkedContent,
  concatTransformationMatrix,
  drawObject,
  endMarkedContent,
  popGraphicsState,
  pushGraphicsState,
  type PDFDocument,
  type PDFField,
  type PDFForm,
  type PDFObject,
  type PDFOperator,
  type PDFPage,
  type PDFWidgetAnnotation,
} from 'pdf-lib'
import { PDF_OFF, PageIndex, nameForLog, widgetEntries, widgetPresence, type WidgetEntry } from './pdfIndex'

/**
 * Flattens form fields into page content, one field at a time, so one exotic field can't
 * take the rest down (pdf-lib's own `form.flatten()` is all-or-nothing, ignores appearance
 * /Matrix and BBox offsets, and leaves dangling widget references in /Annots).
 *
 * Page content shows on screen and on paper alike, so widgets that do both are drawn, and a
 * field with a print-only widget stays a field, so that the widget keeps printing. Screen-only
 * widgets ("Print" or "Clear form" buttons, on-screen hints) are removed, unless the caller
 * wants a field's drawn anyway (a value the user typed belongs in the copy). A widget in a layer
 * (optional content) stays in that layer: one that is off stays hidden. In a tagged PDF, what is
 * drawn is marked as an artifact.
 */

type Matrix = [number, number, number, number, number, number]

const OC = PDFName.of('OC')

/**
 * `ops`, which bake an appearance into page content, marked as an artifact when the document is a
 * tagged PDF (catalog /MarkInfo /Marked true and a /StructTreeRoot): there, all page content is
 * either part of the logical structure or marked as an artifact, which assistive technology skips.
 * Other documents get `ops` as they are.
 */
export function markedAsArtifact(doc: PDFDocument, ops: PDFOperator[]): PDFOperator[] {
  const markInfo = doc.catalog.lookup(PDFName.of('MarkInfo'))
  const tagged = markInfo instanceof PDFDict && markInfo.lookup(PDFName.of('Marked')) === PDFBool.True && doc.catalog.has(PDFName.of('StructTreeRoot'))
  return tagged ? [beginMarkedContent('Artifact'), ...ops, endMarkedContent()] : ops
}

function numbers(obj: unknown, length: number): number[] | null {
  if (!(obj instanceof PDFArray) || obj.size() !== length) return null
  const out = obj.asArray().map((o) => (o instanceof PDFNumber ? o.asNumber() : NaN))
  return out.every(Number.isFinite) ? out : null
}

/** The reference of the appearance stream a viewer would show for this widget right now. */
function currentAppearance(doc: PDFDocument, field: PDFField, widget: PDFWidgetAnnotation): PDFRef | null {
  const ap = widget.dict.lookup(PDFName.of('AP'))
  if (!(ap instanceof PDFDict)) return null
  let target = ap.get(PDFName.of('N'))
  const resolved = target instanceof PDFRef ? doc.context.lookup(target) : target
  if (resolved instanceof PDFDict) {
    // Appearance states (check boxes, radios): /AS picks the state.
    const v = field.acroField.dict.lookup(PDFName.of('V'))
    const state = widget.getAppearanceState() ?? (v instanceof PDFName ? v : PDF_OFF)
    target = resolved.get(state) ?? resolved.get(PDF_OFF)
  }
  if (target instanceof PDFRef) return doc.context.lookup(target) instanceof PDFStream ? target : null
  if (target instanceof PDFStream) return doc.context.register(target)
  return null
}

function matrixOf(stream: PDFStream): Matrix {
  return (numbers(stream.dict.lookup(PDFName.of('Matrix')), 6) ?? [1, 0, 0, 1, 0, 0]) as Matrix
}

/** How far an appearance's /Matrix turns it: 0, 90, 180 or 270 (counterclockwise, the nearest). */
export function appearanceTurn(stream: PDFStream): number {
  const [a, b] = matrixOf(stream)
  return (Math.round(Math.atan2(b, a) / (Math.PI / 2)) * 90 + 360) % 360
}

/** The box [x0, y0, x1, y1] an appearance's BBox covers once its /Matrix is applied. */
export function appearanceBox(stream: PDFStream): [number, number, number, number] | null {
  const bbox = numbers(stream.dict.lookup(PDFName.of('BBox')), 4)
  if (!bbox) return null
  const [a, b, c, d, e, f] = matrixOf(stream)
  const corners = [
    [bbox[0], bbox[1]],
    [bbox[2], bbox[1]],
    [bbox[0], bbox[3]],
    [bbox[2], bbox[3]],
  ].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f])
  const xs = corners.map((p) => p[0])
  const ys = corners.map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/** PDF 32000-1 §12.5.5: maps the appearance's transformed BBox onto the annotation /Rect. */
function placement(doc: PDFDocument, apRef: PDFRef, widget: PDFWidgetAnnotation): Matrix | null {
  const stream = doc.context.lookup(apRef)
  if (!(stream instanceof PDFStream)) return null
  const box = appearanceBox(stream)
  const rect = numbers(widget.dict.lookup(PDFName.of('Rect')), 4)
  if (!box || !rect) return null
  const [tx0, ty0] = box
  const tw = box[2] - tx0
  const th = box[3] - ty0
  const rx = Math.min(rect[0], rect[2])
  const ry = Math.min(rect[1], rect[3])
  const rw = Math.abs(rect[2] - rect[0])
  const rh = Math.abs(rect[3] - rect[1])
  if (tw < 1e-6 || th < 1e-6 || rw < 1e-6 || rh < 1e-6) return null
  const sx = rw / tw
  const sy = rh / th
  return [sx, 0, 0, sy, rx - tx0 * sx, ry - ty0 * sy]
}

/**
 * The appearance wrapped in a form XObject of the widget's optional content (layer), so that once
 * baked it keeps the visibility the widget had: hidden while its layer is off (§8.11.3.3).
 */
function inLayer(doc: PDFDocument, apRef: PDFRef, oc: PDFObject): PDFRef {
  // (Only called for an appearance whose box placement() could read.)
  const box = appearanceBox(doc.context.lookup(apRef, PDFStream)) ?? [0, 0, 0, 0]
  return doc.context.register(doc.context.formXObject([drawObject('A')], { BBox: box, Resources: { XObject: { A: apRef } }, OC: oc }))
}

/** Removes a field, its widgets and their /Annots entries. */
function removeField(doc: PDFDocument, form: PDFForm, field: PDFField, entries: WidgetEntry[], pages: PageIndex) {
  for (const entry of entries) {
    if (entry.ref) for (const page of pages.pagesListing(entry.ref)) page.node.removeAnnot(entry.ref)
  }
  try {
    form.acroForm.removeField(field.acroField)
  } catch {
    /* not listed in /Fields or its parent's /Kids — nothing to unlink */
  }
  for (const entry of entries) if (entry.ref && entry.ref !== field.ref) doc.context.delete(entry.ref)
  doc.context.delete(field.ref)
}

/**
 * Flattens every field of the form; `drawScreenOnly` says of which fields the screen-only
 * widgets are drawn too. Returns the names of fields that had to be left interactive (not
 * those kept on purpose for their print-only widgets).
 */
export function flattenFields(
  doc: PDFDocument,
  form: PDFForm,
  fields: PDFField[],
  pages: PageIndex,
  drawScreenOnly: (field: PDFField) => boolean,
): string[] {
  const failed: string[] = []
  for (const field of fields) {
    try {
      const entries = widgetEntries(field.acroField)
      if (entries.some((e) => widgetPresence(e.widget) === 'print')) continue
      const shown = drawScreenOnly(field) ? ['both', 'screen'] : ['both']
      const draws: { page: PDFPage; ap: PDFRef; m: Matrix }[] = []
      for (const entry of entries) {
        if (!shown.includes(widgetPresence(entry.widget))) continue
        const page = pages.pageOf(entry)
        const ap = page ? currentAppearance(doc, field, entry.widget) : null
        const m = ap ? placement(doc, ap, entry.widget) : null
        // A malformed /OC is ignored, as viewers ignore it.
        const oc = entry.widget.dict.lookup(OC) instanceof PDFDict ? entry.widget.dict.get(OC) : undefined
        if (page && ap && m) draws.push({ page, ap: oc ? inLayer(doc, ap, oc) : ap, m })
      }
      for (const { page, ap, m } of draws) {
        const name = page.node.newXObject('FlatWidget', ap)
        page.pushOperators(...markedAsArtifact(doc, [pushGraphicsState(), concatTransformationMatrix(...m), drawObject(name), popGraphicsState()]))
      }
      removeField(doc, form, field, entries, pages)
    } catch (err) {
      console.warn(`[forms] could not flatten "${nameForLog(field)}"`, err)
      failed.push(nameForLog(field))
    }
  }
  return failed
}
