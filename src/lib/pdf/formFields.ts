import type { PDFDocumentProxy } from './pdfjs'
import type { FormField, FormValues, PageInfo } from '../../model/types'
import { buildFormFields, repeatsRadioValue } from './forms/extract'

export { getFieldExtras, getWidgetRotation, visualTextRotation, type QuarterTurn } from './forms/extract'

export interface FormDocumentInfo {
  /** Dynamic XFA form with no AcroForm fields — nothing this app can fill natively. */
  pureXfa: boolean
}

const docInfo = new WeakMap<object, FormDocumentInfo>()

/** Form facts recorded while extracting fields (undefined if extraction never ran for `pdf`). */
export function getFormDocumentInfo(pdf: PDFDocumentProxy | null | undefined): FormDocumentInfo | undefined {
  return pdf ? docInfo.get(pdf) : undefined
}

async function detectPureXfa(pdf: PDFDocumentProxy): Promise<boolean> {
  try {
    if (pdf.isPureXfa) return true
  } catch {
    /* older proxies */
  }
  try {
    const { info } = await pdf.getMetadata()
    const i = info as Record<string, unknown>
    return i.IsXFAPresent === true && i.IsAcroFormPresent !== true
  } catch {
    return false
  }
}

/** References ("12R") of signature fields that hold a digital signature. */
async function signedFieldIds(pdf: PDFDocumentProxy): Promise<Set<string>> {
  try {
    const sigs = (await pdf.getSignatures()) as { id?: unknown }[] | null
    return new Set((sigs ?? []).map((s) => String(s.id ?? '').split(':')[0]).filter(Boolean))
  } catch {
    return new Set()
  }
}

/** Id of the parent field of every field and widget listed in the AcroForm (null when unknown). */
async function fieldParents(pdf: PDFDocumentProxy): Promise<Map<string, string> | null> {
  try {
    const all: unknown = await pdf.getFieldObjects()
    if (!all || typeof all !== 'object') return null
    const parentOf = new Map<string, string>()
    for (const objects of all instanceof Map ? all.values() : Object.values(all)) {
      for (const o of Array.isArray(objects) ? (objects as { id?: unknown; kidIds?: unknown }[]) : []) {
        if (typeof o?.id !== 'string' || !Array.isArray(o.kidIds)) continue
        for (const kid of o.kidIds) if (typeof kid === 'string') parentOf.set(kid, o.id)
      }
    }
    return parentOf
  } catch {
    return null
  }
}

/** Signed fields plus every widget below them: a field's widget is often a separate kid. */
function signedWidgetIds(signed: Set<string>, parentOf: Map<string, string> | null): Set<string> {
  const out = new Set(signed)
  if (!parentOf) return out
  for (const id of parentOf.keys()) {
    const seen = new Set<string>()
    for (let p = parentOf.get(id); p !== undefined && !seen.has(p); p = parentOf.get(p)) {
      seen.add(p)
      if (signed.has(p)) {
        out.add(id)
        break
      }
    }
  }
  return out
}

/**
 * Reads the AcroForm fields of a document (via pdf.js) and converts widget rectangles into
 * view space. Never throws for a valid PDF: returns [] when there is no form.
 * Fields come back in reading order (page, then top-to-bottom, left-to-right).
 */
export async function extractFormFields(pdf: PDFDocumentProxy, pages: PageInfo[]): Promise<FormField[]> {
  const pureXfa = await detectPureXfa(pdf)
  docInfo.set(pdf, { pureXfa })
  if (pureXfa) return []
  const signedIds = signedFieldIds(pdf)
  const annotations = await Promise.all(
    pages.map(async (p) => {
      try {
        const page = await pdf.getPage(p.index + 1)
        return (await page.getAnnotations()) as unknown[]
      } catch (err) {
        console.warn(`[forms] could not read annotations of page ${p.index + 1}`, err)
        return []
      }
    }),
  )
  try {
    const signed = await signedIds
    // Only pdf.js' field tree tells which field a widget belongs to: needed to find the widgets of
    // signed fields and to tell apart radio buttons that repeat an export value. Rarely needed.
    const parentOf = signed.size || repeatsRadioValue(annotations) ? await fieldParents(pdf) : null
    return buildFormFields(annotations, pages, { signedIds: signedWidgetIds(signed, parentOf), parentOf: parentOf ?? undefined })
  } catch (err) {
    console.warn('[forms] could not build form fields', err)
    return []
  }
}

/**
 * The values a freshly opened document starts with (whatever is stored in the PDF). Built with
 * own properties only: a field may be called "__proto__".
 */
export function defaultFormValues(fields: FormField[]): FormValues {
  return Object.fromEntries(fields.map((f) => [f.name, f.defaultValue]))
}
