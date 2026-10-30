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
  type PDFField,
  type PDFForm,
  type PDFPage,
  type PDFWidgetAnnotation,
} from 'pdf-lib'
import { PDF_OFF, PageIndex, isHiddenWidget, widgetEntries, type WidgetEntry } from './pdfIndex'

/**
 * Flattens form fields into page content, one field at a time, so one exotic field can't
 * take the rest down (pdf-lib's own `form.flatten()` is all-or-nothing, ignores appearance
 * /Matrix and BBox offsets, and leaves dangling widget references in /Annots).
 */

type Matrix = [number, number, number, number, number, number]

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

/** PDF 32000-1 §12.5.5: maps the appearance's transformed BBox onto the annotation /Rect. */
function placement(doc: PDFDocument, apRef: PDFRef, widget: PDFWidgetAnnotation): Matrix | null {
  const stream = doc.context.lookup(apRef)
  if (!(stream instanceof PDFStream)) return null
  const bbox = numbers(stream.dict.lookup(PDFName.of('BBox')), 4)
  const rect = numbers(widget.dict.lookup(PDFName.of('Rect')), 4)
  if (!bbox || !rect) return null
  const [a, b, c, d, e, f] = (numbers(stream.dict.lookup(PDFName.of('Matrix')), 6) ?? [1, 0, 0, 1, 0, 0]) as Matrix
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

/** Flattens every field of the form. Returns the names of fields that had to be left interactive. */
export function flattenFields(doc: PDFDocument, form: PDFForm, fields: PDFField[], pages: PageIndex): string[] {
  const failed: string[] = []
  for (const field of fields) {
    try {
      const entries = widgetEntries(field.acroField)
      const draws: { page: PDFPage; ap: PDFRef; m: Matrix }[] = []
      for (const entry of entries) {
        if (isHiddenWidget(entry.widget)) continue
        const page = pages.pageOf(entry)
        const ap = page ? currentAppearance(doc, field, entry.widget) : null
        const m = ap ? placement(doc, ap, entry.widget) : null
        if (page && ap && m) draws.push({ page, ap, m })
      }
      for (const { page, ap, m } of draws) {
        const name = page.node.newXObject('FlatWidget', ap)
        page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m), drawObject(name), popGraphicsState())
      }
      removeField(doc, form, field, entries, pages)
    } catch (err) {
      console.warn(`[forms] could not flatten "${field.getName()}"`, err)
      failed.push(field.getName())
    }
  }
  return failed
}
