import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFRef,
  PDFWidgetAnnotation,
  type PDFAcroTerminal,
  type PDFDocument,
  type PDFField,
  type PDFForm,
  type PDFPage,
} from 'pdf-lib'
import type { FormField } from '../../../model/types'

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

  constructor(doc: PDFDocument) {
    this.pages = doc.getPages()
    for (const page of this.pages) {
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

/** Maps our extracted fields onto pdf-lib fields — by widget reference first, then by name. */
export class FieldIndex {
  readonly all: PDFField[]
  private byWidget = new Map<string, PDFField>()
  private byName = new Map<string, PDFField>()

  constructor(form: PDFForm) {
    this.all = form.getFields()
    for (const f of this.all) {
      if (!this.byName.has(f.getName())) this.byName.set(f.getName(), f)
      for (const { ref } of widgetEntries(f.acroField)) if (ref) this.byWidget.set(refKey(ref), f)
    }
  }

  find(field: FormField): PDFField | undefined {
    for (const w of field.widgets) {
      const f = this.byWidget.get(w.id)
      if (f) return f
    }
    return this.byName.get(field.name)
  }
}

/** Whether the annotation is hidden / not viewable (flags Hidden=2, NoView=32). */
export function isHiddenWidget(widget: PDFWidgetAnnotation): boolean {
  return (widget.getFlags() & (2 | 32)) !== 0
}

export const PDF_OFF = PDFName.of('Off')
