import {
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFSignature,
  PDFString,
  PDFTextField,
  PDFWidgetAnnotation,
  type PDFAcroTerminal,
  type PDFDocument,
  type PDFField,
  type PDFForm,
  type PDFPage,
} from 'pdf-lib'
import type { FormField, FormFieldType, FormWidget, PageInfo, Rect } from '../../../model/types'
import { pdfRectToViewRect } from '../geometry'
import { isUnnamedField } from './extract'

/** pdf.js annotation id for an indirect object ("12R", or "12R3" for generation 3). */
export function refKey(ref: PDFRef): string {
  return ref.generationNumber ? `${ref.objectNumber}R${ref.generationNumber}` : `${ref.objectNumber}R`
}

export interface WidgetEntry {
  widget: PDFWidgetAnnotation
  /** Indirect reference of the widget annotation (undefined for direct objects). */
  ref?: PDFRef
}

/** The widgets of a terminal field with their references (a field without Kids is its own widget). */
export function widgetEntries(acro: PDFAcroTerminal): WidgetEntry[] {
  const kids = acro.Kids()
  if (!(kids instanceof PDFArray)) return [{ widget: PDFWidgetAnnotation.fromDict(acro.dict), ref: acro.ref }]
  const out: WidgetEntry[] = []
  for (let i = 0; i < kids.size(); i++) {
    const raw = kids.get(i)
    const dict = kids.lookup(i)
    if (!(dict instanceof PDFDict)) continue
    out.push({ widget: PDFWidgetAnnotation.fromDict(dict), ref: raw instanceof PDFRef ? raw : undefined })
  }
  return out
}

/** Finds pages of widget annotations (by /Annots membership, falling back to /P). */
export class PageIndex {
  readonly pages: PDFPage[]
  private byRef = new Map<PDFRef, PDFPage>()
  private byAnnot = new Map<PDFRef, PDFPage[]>()
  private numbers = new Map<PDFPage, number>()

  constructor(doc: PDFDocument) {
    this.pages = doc.getPages()
    for (const page of this.pages) {
      this.numbers.set(page, this.numbers.size)
      this.byRef.set(page.ref, page)
      const annots = page.node.Annots()
      if (!annots) continue
      for (let i = 0; i < annots.size(); i++) {
        const r = annots.get(i)
        if (!(r instanceof PDFRef)) continue
        const list = this.byAnnot.get(r)
        if (list) list.push(page)
        else this.byAnnot.set(r, [page])
      }
    }
  }

  pageOf(entry: WidgetEntry): PDFPage | undefined {
    if (entry.ref) {
      const p = this.byAnnot.get(entry.ref)?.[0]
      if (p) return p
    }
    const P = entry.widget.P()
    return P ? this.byRef.get(P) : undefined
  }

  /** 0-based index of the page a widget sits on, or -1. */
  indexOf(entry: WidgetEntry): number {
    const page = this.pageOf(entry)
    return page ? (this.numbers.get(page) ?? -1) : -1
  }

  /** Every page whose /Annots lists `ref`. */
  pagesListing(ref: PDFRef): PDFPage[] {
    return this.byAnnot.get(ref) ?? []
  }

  /** The page's effective /Rotate, normalized to 0/90/180/270. */
  static rotation(page: PDFPage | undefined): 0 | 90 | 180 | 270 {
    if (!page) return 0
    const deg = page.getRotation().angle
    return ((((Math.round(deg / 90) * 90) % 360) + 360) % 360) as 0 | 90 | 180 | 270
  }
}

const T = PDFName.of('T')
const PARENT = PDFName.of('Parent')
const RECT = PDFName.of('Rect')

/** Decodes a text string like pdf.js does (pdf-lib reads a UTF-8 BOM as PDFDocEncoding). */
export function pdfText(s: PDFString | PDFHexString): string {
  const bytes = s.asBytes()
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder().decode(bytes.subarray(3))
  return s.decodeText()
}

/**
 * A field's fully qualified name as pdf.js builds it (the name our FormFields carry): the /T of
 * the field and of each ancestor, skipping missing ones. pdf-lib's getName() says "undefined"
 * for a missing /T and throws on a broken /Parent.
 */
export function qualifiedName(dict: PDFDict): string {
  const parts: string[] = []
  const seen = new Set<PDFDict>()
  let node: unknown = dict
  while (node instanceof PDFDict && !seen.has(node)) {
    seen.add(node)
    const t = node.lookup(T)
    if (t instanceof PDFString || t instanceof PDFHexString) parts.unshift(pdfText(t))
    node = node.lookup(PARENT)
  }
  return parts.join('.')
}

/** Whether a name read from the PDF names the field pdf.js called `ours`. */
function sameName(theirs: string, ours: string): boolean {
  return theirs === ours || (!theirs.trim() && isUnnamedField(ours))
}

/** Whether a pdf-lib field can hold a value of our field type. */
export function holdsType(target: PDFField, type: FormFieldType): boolean {
  switch (type) {
    case 'text':
      return target instanceof PDFTextField
    case 'checkbox':
      return target instanceof PDFCheckBox
    case 'radio':
      return target instanceof PDFRadioGroup || target instanceof PDFCheckBox
    case 'dropdown':
      return target instanceof PDFDropdown
    case 'listbox':
      return target instanceof PDFOptionList
    case 'signature':
      return target instanceof PDFSignature
    default:
      return false
  }
}

/** A widget's /Rect in view space, if it is a valid one. */
export function viewRectOf(widget: PDFDict, view: PageInfo): Rect | null {
  const r = widget.lookup(RECT)
  if (!(r instanceof PDFArray) || r.size() !== 4) return null
  const n = r.asArray().map((o) => (o instanceof PDFNumber ? o.asNumber() : NaN))
  return n.every(Number.isFinite) ? pdfRectToViewRect(view, n) : null
}

/** How far (points) two rects are apart: their largest difference in position or size. */
export function placeOffset(a: Rect, b: Rect): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.width - b.width), Math.abs(a.height - b.height))
}

/** How far a rewritten widget's rect may be from ours to be the same widget: pdf.js rounds to 0.01. */
export const SAME_PLACE = 0.5

/** One of our widgets, as found in the document being written. */
interface Placement {
  field: PDFField
  /** The widget annotation dictionary. */
  widget: PDFDict
}

interface Candidate extends Placement {
  entry: WidgetEntry
  /** pdf.js-style qualified name of `field`. */
  name: string
}

export interface FieldIndexOptions {
  /** Page geometry as the editor saw it (what the extracted widget rects are relative to). */
  pages: readonly PageInfo[]
  /** The document was rewritten by pdf.js (decrypted or repaired): its objects were renumbered. */
  rewritten: boolean
}

/**
 * Maps our extracted fields onto the pdf-lib fields of the document being written.
 *
 * Widget ids are pdf.js references into the file as it was opened. In that same file an id is
 * trusted only when the field names agree. A file pdf.js rewrote (decrypted or repaired) has
 * new object numbers, and its names may have lost their parents, so there each widget is found
 * by page and rectangle instead. Separate fields that share a name (a form merged twice) all
 * hold the value.
 */
export class FieldIndex {
  readonly all: PDFField[]
  private byWidget = new Map<string, Placement>()
  private byName = new Map<string, PDFField[]>()
  private rewritten: boolean

  constructor(form: PDFForm, pages: PageIndex, fields: readonly FormField[], opts: FieldIndexOptions) {
    this.all = form.getFields()
    this.rewritten = opts.rewritten
    const candidates: Candidate[] = []
    for (const field of this.all) {
      const name = qualifiedName(field.acroField.dict)
      const named = this.byName.get(name)
      if (named) named.push(field)
      else this.byName.set(name, [field])
      for (const entry of widgetEntries(field.acroField)) candidates.push({ field, widget: entry.widget.dict, entry, name })
    }
    if (opts.rewritten) this.matchByPlace(candidates, fields, pages, opts.pages)
    else this.matchByRef(candidates, fields)
  }

  private matchByRef(candidates: Candidate[], fields: readonly FormField[]) {
    const byRef = new Map<string, Candidate>()
    for (const c of candidates) if (c.entry.ref) byRef.set(refKey(c.entry.ref), c)
    for (const field of fields) {
      for (const w of field.widgets) {
        const c = byRef.get(w.id)
        if (c && sameName(c.name, field.name)) this.byWidget.set(w.id, c)
      }
    }
  }

  private matchByPlace(candidates: Candidate[], fields: readonly FormField[], pages: PageIndex, views: readonly PageInfo[]) {
    const onPage = new Map<number, { c: Candidate; rect: Rect }[]>()
    for (const c of candidates) {
      const page = pages.indexOf(c.entry)
      const rect = views[page] ? viewRectOf(c.widget, views[page]) : null
      if (!rect) continue
      const list = onPage.get(page) ?? []
      list.push({ c, rect })
      onPage.set(page, list)
    }
    const taken = new Set<PDFDict>()
    for (const field of fields) {
      for (const w of field.widgets) {
        let best: Candidate | undefined
        let bestScore = -1
        for (const { c, rect } of onPage.get(w.page) ?? []) {
          const off = placeOffset(rect, w.rect)
          if (off > SAME_PLACE) continue
          // Prefer a widget nobody claimed, then the same name (or our name minus lost parents), then the closest.
          const naming = sameName(c.name, field.name) ? 2 : c.name && field.name.endsWith(`.${c.name}`) ? 1 : 0
          const score = (taken.has(c.widget) ? 0 : 100) + naming * 10 + (SAME_PLACE - off)
          if (score > bestScore) {
            best = c
            bestScore = score
          }
        }
        if (!best) continue
        this.byWidget.set(w.id, best)
        taken.add(best.widget)
      }
    }
  }

  /**
   * The pdf-lib fields holding `field`'s value: the fields of its widgets, plus other fields of
   * the same name and kind (a rewritten file's names can't be trusted, so not there).
   */
  findAll(field: FormField): PDFField[] {
    const out = new Set<PDFField>()
    for (const w of field.widgets) {
      const placed = this.byWidget.get(w.id)
      if (placed) out.add(placed.field)
    }
    if (!this.rewritten) {
      const matched = out.size > 0
      for (const f of this.byName.get(field.name) ?? []) if (!matched || holdsType(f, field.type)) out.add(f)
    }
    return [...out]
  }

  /** The widget dictionary that stands for one of our widgets in this document. */
  widgetOf(widget: FormWidget): PDFDict | undefined {
    return this.byWidget.get(widget.id)?.widget
  }
}

/** Annotation flags (PDF 32000-1 §12.5.3). */
const HIDDEN = 2
const PRINT = 4
const NO_VIEW = 32

/** Where a widget appears: on screen and on paper, only on one of them, or nowhere. */
export function widgetPresence(widget: PDFWidgetAnnotation): 'both' | 'screen' | 'print' | 'none' {
  const flags = widget.getFlags()
  if (flags & HIDDEN) return 'none'
  const print = (flags & PRINT) !== 0
  if (flags & NO_VIEW) return print ? 'print' : 'none'
  return print ? 'both' : 'screen'
}

/** Whether any widget of `fields` has the Print flag (some generators never set it on any). */
export function usesPrintFlag(fields: readonly PDFField[]): boolean {
  return fields.some((f) => widgetEntries(f.acroField).some((e) => (e.widget.getFlags() & PRINT) !== 0))
}

/** A field name for log messages (pdf-lib's getName() can throw on a broken /Parent). */
export function nameForLog(field: PDFField): string {
  return qualifiedName(field.acroField.dict) || '(unnamed)'
}

export const PDF_OFF = PDFName.of('Off')
