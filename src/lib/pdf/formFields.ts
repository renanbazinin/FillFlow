import type { PDFDocumentProxy } from './pdfjs'
import type { FormField, FormValues, PageInfo } from '../../model/types'
import { buildFormFields } from './forms/extract'

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

/** Annotation ids ("12R") of signature fields that hold a digital signature. */
async function signedFieldIds(pdf: PDFDocumentProxy): Promise<Set<string>> {
  try {
    const sigs = (await pdf.getSignatures()) as { id?: unknown }[] | null
    return new Set((sigs ?? []).map((s) => String(s.id ?? '').split(':')[0]).filter(Boolean))
  } catch {
    return new Set()
  }
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
    return buildFormFields(annotations, pages, { signedIds: await signedIds })
  } catch (err) {
    console.warn('[forms] could not build form fields', err)
    return []
  }
}

/** The values a freshly opened document starts with (whatever is stored in the PDF). */
export function defaultFormValues(fields: FormField[]): FormValues {
  const values: FormValues = {}
  for (const f of fields) values[f.name] = f.defaultValue
  return values
}
