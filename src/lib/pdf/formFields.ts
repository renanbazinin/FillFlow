import type { PDFDocumentProxy } from './pdfjs'
import type { FormField, FormValues, PageInfo } from '../../model/types'
import { buildFormFields, lacksLabels, repeatsRadioValue, usesLayers } from './forms/extract'

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

/** Labels that fields keep on the field rather than on their widgets (see readFieldTooltips). */
async function fieldTooltips(pdf: PDFDocumentProxy): Promise<Map<string, string> | null> {
  try {
    const { readFieldTooltips } = await import('./forms/tooltips')
    return await readFieldTooltips(await pdf.getData())
  } catch (err) {
    console.warn('[forms] could not read the labels of fields', err)
    return null
  }
}

// That reader comes with pdf-lib, which the app otherwise loads only to export. It is downloaded
// once the page has settled, as pdf.js's worker is (see pdfjs.ts), rather than by the first open
// that needs it: a page that loaded then reads the labels of fields offline too. Offline then, it
// waits for the connection (some browsers never fetch a module again once it failed), as it does
// after a failure.
if (typeof window !== 'undefined') {
  const preload = () => {
    const retry = () => window.addEventListener('online', preload, { once: true })
    if (navigator.onLine) import('./forms/tooltips').catch(retry)
    else retry()
  }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(preload, { timeout: 3000 })
  else setTimeout(preload, 1000)
}

/** Whether optional content (a layer) is hidden as the document opens, as the page shows it. */
async function layerHidden(pdf: PDFDocumentProxy): Promise<((oc: unknown) => boolean) | null> {
  try {
    const config = await pdf.getOptionalContentConfig({ intent: 'display' })
    return (oc) => {
      try {
        return !config.isVisible(oc)
      } catch {
        return false
      }
    }
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
    const [parentOf, tooltipOf, hiddenLayer] = await Promise.all([
      // Only pdf.js' field tree tells which field a widget belongs to: needed to find the widgets of
      // signed fields and to tell apart radio buttons that repeat an export value. Rarely needed.
      signed.size || repeatsRadioValue(annotations) ? fieldParents(pdf) : null,
      // pdf.js reads labels from widgets only: a widget without one may belong to a field with one.
      lacksLabels(annotations) ? fieldTooltips(pdf) : null,
      usesLayers(annotations) ? layerHidden(pdf) : null,
    ])
    return buildFormFields(annotations, pages, {
      signedIds: signedWidgetIds(signed, parentOf),
      parentOf: parentOf ?? undefined,
      tooltipOf: tooltipOf ?? undefined,
      hiddenLayer: hiddenLayer ?? undefined,
    })
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
