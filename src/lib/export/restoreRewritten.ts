import { PDFArray, PDFBool, PDFDict, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, type PDFDocument, type PDFObject } from 'pdf-lib'
import type { RecoveredCatalog, RecoveredLayer, RecoveredLayerOrder } from './types'

/**
 * pdf.js' page editor (our decrypt / repair step) writes a fresh catalog and field tree. This
 * puts back what it loses that changes how the file looks or reads:
 *  - /Parent links of all but the first non-terminal kid of a field, without which a field
 *    named "applicant.last" comes out as "last",
 *  - the layer configuration (/OCProperties), without which hidden layers are drawn,
 *  - page labels, language, viewer preferences, page mode and layout, tagged-PDF flags.
 */
export function restoreRewritten(doc: PDFDocument, catalog: RecoveredCatalog = {}): void {
  restoreFieldParents(doc)
  restoreCatalog(doc, catalog)
}

const KIDS = PDFName.of('Kids')
const PARENT = PDFName.of('Parent')

/** Links every kid in the AcroForm field tree that has lost its /Parent back to its node. */
export function restoreFieldParents(doc: PDFDocument): void {
  const fields = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)?.lookupMaybe(PDFName.of('Fields'), PDFArray)
  if (!fields) return
  const seen = new Set<PDFRef>()
  const visit = (kids: PDFArray, parent: PDFRef | null) => {
    for (const ref of kids.asArray()) {
      if (!(ref instanceof PDFRef) || seen.has(ref)) continue
      seen.add(ref)
      const node = doc.context.lookup(ref)
      if (!(node instanceof PDFDict)) continue
      if (parent && !node.has(PARENT)) node.set(PARENT, parent)
      const sub = node.lookup(KIDS)
      if (sub instanceof PDFArray) visit(sub, ref)
    }
  }
  visit(fields, null)
}

const text = (s: string) => PDFHexString.fromText(s)

function setIfMissing(doc: PDFDocument, key: string, value: PDFObject | undefined) {
  const name = PDFName.of(key)
  if (value && !doc.catalog.has(name)) doc.catalog.set(name, value)
}

function restoreCatalog(doc: PDFDocument, info: RecoveredCatalog) {
  const { context } = doc
  if (info.lang) setIfMissing(doc, 'Lang', text(info.lang))
  if (info.pageMode && info.pageMode !== 'UseNone') setIfMissing(doc, 'PageMode', PDFName.of(info.pageMode))
  if (info.pageLayout) setIfMissing(doc, 'PageLayout', PDFName.of(info.pageLayout))
  // The flags describe the structure tree, which the rewrite keeps only when it has content.
  if (info.markInfo && doc.catalog.has(PDFName.of('StructTreeRoot'))) {
    setIfMissing(doc, 'MarkInfo', context.obj(Object.fromEntries(info.markInfo.map((key) => [key, true]))))
  }
  if (info.pageLabels?.length === doc.getPageCount()) setIfMissing(doc, 'PageLabels', pageLabels(doc, info.pageLabels))
  if (info.viewerPreferences) {
    const prefs = context.obj({})
    for (const [key, value] of Object.entries(info.viewerPreferences)) {
      const v =
        typeof value === 'boolean'
          ? PDFBool[value ? 'True' : 'False']
          : typeof value === 'number'
            ? PDFNumber.of(value)
            : typeof value === 'string'
              ? PDFName.of(value)
              : Array.isArray(value) && value.every((n) => typeof n === 'number')
                ? context.obj(value)
                : null
      if (v) prefs.set(PDFName.of(key), v)
    }
    if (prefs.keys().length) setIfMissing(doc, 'ViewerPreferences', prefs)
  }
  // On its own, so that a layer problem can't cost the entries above.
  if (info.layers) {
    try {
      restoreLayers(doc, info.layers)
    } catch (err) {
      console.warn('[export] could not restore the layers of the document', err)
    }
  }
}

/**
 * A page label number tree: runs of page numbers ("1", "2"… or "A-1", "A-2"…) become one
 * decimal range, other labels a prefix each.
 */
function pageLabels(doc: PDFDocument, labels: string[]): PDFDict {
  // A decimal range labels a page with its prefix followed by the page's number.
  const numbered = (label: string | undefined) => {
    const m = label === undefined ? null : /^(.*?)([1-9]\d{0,8})$/s.exec(label)
    return m && { prefix: m[1], n: Number(m[2]) }
  }
  const nums: PDFObject[] = []
  labels.forEach((label, i) => {
    const page = numbered(label)
    const previous = numbered(labels[i - 1])
    // The next number after the same prefix continues the range (so a "1" always starts one).
    if (page && previous?.prefix === page.prefix && previous.n === page.n - 1) return
    const range = page ? { S: 'D', St: page.n, ...(page.prefix ? { P: text(page.prefix) } : {}) } : { P: text(label) }
    nums.push(PDFNumber.of(i), doc.context.obj(range))
  })
  return doc.context.obj({ Nums: nums })
}

const TYPE = PDFName.of('Type')
const OCG = PDFName.of('OCG')

function decodedText(obj: PDFObject | undefined): string {
  return obj instanceof PDFString || obj instanceof PDFHexString ? obj.decodeText() : ''
}

/** A /Usage state; malformed entries count as unset, as pdf.js reads them. */
function usageState(usage: PDFObject | undefined, category: string, key: string): string | null {
  const entry = usage instanceof PDFDict ? usage.lookup(PDFName.of(category)) : undefined
  const state = entry instanceof PDFDict ? entry.lookup(PDFName.of(key)) : undefined
  const name = state instanceof PDFName ? state.decodeText() : null
  return name === 'ON' || name === 'OFF' ? name : null
}

/** What tells layers apart once the rewrite has renumbered them: name, intent and usage. */
function layerKey(name: string | null, intent: string[] | null, view: string | null, print: string | null): string {
  return JSON.stringify([name ?? '', intent, view, print])
}

/**
 * Rebuilds /OCProperties. The rewrite keeps the groups page content refers to, under new
 * object numbers, so they are matched to the original's by name, intent and usage. Layers that
 * can't be told apart (same key, different default states) stay visible.
 */
function restoreLayers(doc: PDFDocument, layers: NonNullable<RecoveredCatalog['layers']>) {
  const { context } = doc
  if (doc.catalog.has(PDFName.of('OCProperties'))) return
  const copies = new Map<string, PDFRef[]>()
  const all: PDFRef[] = []
  // Per event, the groups with a usage state (ON or OFF) for it.
  const usage = new Map<string, { ref: PDFRef; on: boolean }[]>()
  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj.get(TYPE) !== OCG) continue
    all.push(ref)
    const rawIntent = obj.lookup(PDFName.of('Intent'))
    const intents = rawIntent instanceof PDFArray ? rawIntent.asArray() : [rawIntent]
    const intent = intents.every((i) => i instanceof PDFName) ? intents.map((i) => (i as PDFName).decodeText()) : null
    const use = obj.lookup(PDFName.of('Usage'))
    const states = {
      View: usageState(use, 'View', 'ViewState'),
      Print: usageState(use, 'Print', 'PrintState'),
      Export: usageState(use, 'Export', 'ExportState'),
    }
    const key = layerKey(decodedText(obj.lookup(PDFName.of('Name'))), intent, states.View, states.Print)
    copies.set(key, [...(copies.get(key) ?? []), ref])
    for (const [event, state] of Object.entries(states)) if (state) usage.set(event, [...(usage.get(event) ?? []), { ref, on: state === 'ON' }])
  }
  if (!all.length) return

  const originals = new Map<string, RecoveredLayer[]>()
  for (const g of layers.groups) {
    const key = layerKey(g.name, g.intent, g.view, g.print)
    originals.set(key, [...(originals.get(key) ?? []), g])
  }
  const off: PDFRef[] = []
  const byId = new Map<string, PDFRef>()
  for (const [key, refs] of copies) {
    const groups = originals.get(key) ?? []
    const states = new Set(groups.map((g) => g.on))
    if (states.size > 1) {
      console.warn(`[export] layers named "${groups[0].name}" can't be told apart; they stay visible`)
      continue
    }
    if (states.has(false)) off.push(...refs)
    if (groups.length === refs.length) groups.forEach((g, i) => byId.set(g.id, refs[i]))
  }

  const config = context.obj({})
  if (layers.name) config.set(PDFName.of('Name'), text(layers.name))
  if (layers.creator) config.set(PDFName.of('Creator'), text(layers.creator))
  if (off.length) config.set(PDFName.of('OFF'), context.obj(off))
  const order = layerOrder(doc, layers.order ?? [], byId)
  if (order.length) config.set(PDFName.of('Order'), context.obj(order))
  const rb = new Map<string, PDFRef[]>()
  for (const g of layers.groups) {
    for (const set of g.rbGroups) {
      const refs = set.map((id) => byId.get(id)).filter((r): r is PDFRef => !!r)
      if (refs.length > 1) rb.set(set.join(' '), refs)
    }
  }
  if (rb.size) config.set(PDFName.of('RBGroups'), context.obj([...rb.values()].map((refs) => context.obj(refs))))
  // Viewers apply /Usage states only to groups listed for an event; pdf.js (the editor) applies them
  // to all, but never shows a group that is off by default, so such a group isn't listed to turn on.
  const auto: PDFDict[] = []
  for (const [event, groups] of usage) {
    const refs = groups.filter((g) => !g.on || !off.includes(g.ref)).map((g) => g.ref)
    if (refs.length) auto.push(context.obj({ Event: event, Category: [event], OCGs: refs }))
  }
  if (auto.length) config.set(PDFName.of('AS'), context.obj(auto))
  doc.catalog.set(PDFName.of('OCProperties'), context.obj({ OCGs: all, D: config }))
}

/** The layers panel order with ids mapped to the copies (pdf.js lists groups missing from it last). */
function layerOrder(doc: PDFDocument, order: RecoveredLayerOrder, byId: Map<string, PDFRef>, nested = false): PDFObject[] {
  const items = [...order]
  const last = items.at(-1)
  if (!nested && last && typeof last === 'object' && last.name === null && last.order.every((i) => typeof i === 'string')) items.pop()
  const out: PDFObject[] = []
  for (const item of items) {
    if (typeof item === 'string') {
      const ref = byId.get(item)
      if (ref) out.push(ref)
      continue
    }
    const sub = layerOrder(doc, item.order, byId, true)
    if (sub.length) out.push(doc.context.obj(item.name ? [text(item.name), ...sub] : sub))
  }
  return out
}
