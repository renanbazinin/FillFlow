import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString, StandardFonts } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import { defaultFormValues, extractFormFields } from '../pdf/formFields'
import type { PDFDocumentProxy } from '../pdf/pdfjs'
import { renderPdf } from './engine'
import { restoreRewritten } from './restoreRewritten'
import { encryptPdf } from './testing/fixtures'
import type { RecoveredCatalog } from './types'
import { makeInput, makeText, testDeps } from './testing/helpers'
import { openPdfjs, pdfjsDecrypt, pdfjsRepair, readPages, renderPage } from './testing/pdfjs'

/**
 * Encrypted and damaged files are rewritten by pdf.js before export, which drops the catalog's
 * layer configuration (and more) and loses /Parent links in the field tree.
 */

/**
 * A 300×300 page with three layers: "Instructions" (off by default: a red square in the
 * middle), "Drawing" (on: a blue square bottom-left) and "Print stamp" (on, but /Usage hides
 * it on screen: a green square top-right), and a radio-button pair of language layers:
 * "English" (on: a black square bottom-right) and "עברית" (off: a magenta square on the left).
 * Plus a structure tree and the catalog entries the rewrite drops.
 */
async function layeredPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const ctx = doc.context
  const page = doc.addPage([300, 300])
  const hidden = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFHexString.fromText('Instructions') }))
  const shown = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFHexString.fromText('Drawing') }))
  const print = ctx.register(
    ctx.obj({ Type: 'OCG', Name: PDFHexString.fromText('Print stamp'), Usage: { View: { ViewState: 'OFF' }, Print: { PrintState: 'ON' } } }),
  )
  const english = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFHexString.fromText('English') }))
  const hebrew = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFHexString.fromText('עברית') }))
  page.node.set(PDFName.of('Resources'), ctx.obj({ Properties: { oc1: hidden, oc2: shown, oc3: print, oc4: english, oc5: hebrew } }))
  const content = [
    '/OC /oc1 BDC 1 0 0 rg 100 100 100 100 re f EMC',
    '/OC /oc2 BDC 0 0 1 rg 10 10 30 30 re f EMC',
    '/OC /oc3 BDC 0 1 0 rg 260 260 30 30 re f EMC',
    '/OC /oc4 BDC 0 0 0 rg 260 10 30 30 re f EMC',
    '/OC /oc5 BDC 1 0 1 rg 10 140 30 30 re f EMC',
    '/P <</MCID 0>> BDC EMC',
  ].join('\n')
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(content)))
  doc.catalog.set(
    PDFName.of('OCProperties'),
    ctx.obj({
      OCGs: [hidden, shown, print, english, hebrew],
      D: {
        OFF: [hidden, hebrew],
        Order: [shown, hidden, print, [PDFHexString.fromText('Languages'), english, hebrew]],
        RBGroups: [[english, hebrew]],
        AS: [{ Event: 'View', Category: ['View'], OCGs: [print] }],
      },
    }),
  )
  // One tagged paragraph, so that the tagged-PDF flags below describe something.
  const treeRoot = ctx.nextRef()
  const paragraph = ctx.register(ctx.obj({ Type: 'StructElem', S: 'P', P: treeRoot, Pg: page.ref, K: 0 }))
  ctx.assign(treeRoot, ctx.obj({ Type: 'StructTreeRoot', K: [paragraph], ParentTree: { Nums: [0, [paragraph]] }, ParentTreeNextKey: 1 }))
  page.node.set(PDFName.of('StructParents'), PDFNumber.of(0))
  doc.catalog.set(PDFName.of('StructTreeRoot'), treeRoot)
  doc.catalog.set(PDFName.of('Lang'), PDFString.of('he-IL'))
  doc.catalog.set(PDFName.of('PageLabels'), ctx.obj({ Nums: [0, { S: 'r' }] }))
  doc.catalog.set(PDFName.of('ViewerPreferences'), ctx.obj({ Direction: 'R2L', DisplayDocTitle: true }))
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOC'))
  doc.catalog.set(PDFName.of('MarkInfo'), ctx.obj({ Marked: true }))
  return doc.save({ useObjectStreams: false })
}

const isWhite = ([r, g, b]: number[]) => r > 245 && g > 245 && b > 245

async function expectLayersAsInOriginal(out: Uint8Array) {
  const pdf = await openPdfjs(out)
  const raster = await renderPage(pdf, 1, 2)
  expect(isWhite(raster.at(150, 150)), 'hidden layer').toBe(true)
  expect(raster.at(25, 275).slice(0, 3), 'visible layer').toEqual([0, 0, 255])
  expect(isWhite(raster.at(275, 25)), 'print-only layer on screen').toBe(true)
  expect(raster.at(275, 275).slice(0, 3), 'language that is on').toEqual([0, 0, 0])
  expect(isWhite(raster.at(25, 145)), 'language that is off').toBe(true)
  const config = await pdf.getOptionalContentConfig({ intent: 'any' })
  const states = Object.fromEntries([...config].map(([, g]) => [g.name, g.visible]))
  expect(states).toEqual({ Instructions: false, Drawing: true, 'Print stamp': true, English: true, עברית: false })
  const id = Object.fromEntries([...config].map(([key, g]) => [g.name, key]))
  expect(config.getOrder()).toEqual([id.Drawing, id.Instructions, id['Print stamp'], { name: 'Languages', order: [id.English, id['עברית']] }])
  // Still a radio-button pair: showing one language hides the other.
  config.setVisibility(id['עברית'], true)
  expect(config.getGroup(id.English)?.visible).toBe(false)
  expect(await pdf.getPageLabels()).toEqual(['i'])
  await pdf.loadingTask.destroy()

  const doc = await PDFDocument.load(out, { updateMetadata: false })
  const catalog = doc.catalog
  expect(catalog.lookup(PDFName.of('Lang'), PDFHexString).decodeText()).toBe('he-IL')
  expect(catalog.lookup(PDFName.of('PageMode'))).toBe(PDFName.of('UseOC'))
  expect(catalog.lookup(PDFName.of('ViewerPreferences'), PDFDict).get(PDFName.of('Direction'))).toBe(PDFName.of('R2L'))
  // The rewrite keeps a structure tree with content, which the tagged-PDF flags describe.
  expect(catalog.has(PDFName.of('StructTreeRoot'))).toBe(true)
  expect(String(catalog.lookup(PDFName.of('MarkInfo'), PDFDict).get(PDFName.of('Marked')))).toBe('true')
  const config2 = catalog.lookup(PDFName.of('OCProperties'), PDFDict).lookup(PDFName.of('D'), PDFDict)
  expect(config2.has(PDFName.of('Order'))).toBe(true)
  expect(config2.has(PDFName.of('AS'))).toBe(true)
}

describe('exportPdf: documents rewritten by pdf.js', () => {
  it('keeps hidden layers hidden and restores the catalog when decrypting', async () => {
    const plain = await layeredPdf()
    const secured = await encryptPdf(plain, { owner: 'owner-only' })
    const pages = await readPages(secured)
    // The fixture really hides the layer (in the original and its encrypted copy).
    const original = await openPdfjs(secured)
    expect(isWhite((await renderPage(original, 1, 2)).at(150, 150))).toBe(true)
    await original.loadingTask.destroy()

    const out = await renderPdf(makeInput(secured, pages, [makeText(0, 20, 20, 'Signed')]), { ...testDeps, decrypt: pdfjsDecrypt() })
    await expectLayersAsInOriginal(out)
  })

  it('does the same when repairing a file pdf-lib cannot read', async () => {
    const plain = await layeredPdf()
    const pages = await readPages(plain)
    const broken = new TextEncoder().encode('%PDF-1.7\nnot really a pdf')
    const out = await renderPdf(makeInput(broken, pages, [makeText(0, 20, 20, 'Signed')]), {
      ...testDeps,
      repair: () => pdfjsRepair()(plain),
    })
    await expectLayersAsInOriginal(out)
  })
})

/** A 12-page file whose page labels use the common schemes: front matter, prefixes, letters… */
async function labelledPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < 12; i++) doc.addPage([100, 100])
  const ranges = [0, { S: 'r' }, 2, { S: 'D' }, 4, { S: 'D', P: PDFString.of('A-') }, 6, { P: PDFString.of('Index') }, 8, { S: 'A' }, 10, { S: 'D', St: 5 }]
  doc.catalog.set(PDFName.of('PageLabels'), doc.context.obj({ Nums: ranges }))
  return doc.save({ useObjectStreams: false })
}

/** The labels pdf.js reads from `labelledPdf`. */
const LABELS = ['i', 'ii', '1', '2', 'A-1', 'A-2', 'Index', 'Index', 'A', 'B', '5', '6']

describe('exportPdf: page labels after a pdf.js rewrite', () => {
  it('keeps every page’s label when decrypting', async () => {
    const secured = await encryptPdf(await labelledPdf(), { owner: 'owner-only' })
    const original = await openPdfjs(secured)
    expect(await original.getPageLabels()).toEqual(LABELS)
    await original.loadingTask.destroy()

    const out = await renderPdf(makeInput(secured, await readPages(secured), [makeText(2, 20, 20, 'Signed')]), { ...testDeps, decrypt: pdfjsDecrypt() })
    const pdf = await openPdfjs(out)
    expect(await pdf.getPageLabels()).toEqual(LABELS)
    await pdf.loadingTask.destroy()
  })
})

describe('restoreRewritten: page labels', () => {
  /** The labels pdf.js reads back once `labels` are restored into a document with as many pages. */
  async function roundTrip(labels: string[]) {
    const doc = await PDFDocument.create()
    labels.forEach(() => doc.addPage([100, 100]))
    restoreRewritten(doc, { pageLabels: labels })
    const tree = doc.catalog.lookup(PDFName.of('PageLabels'), PDFDict).lookup(PDFName.of('Nums'), PDFArray)
    const pdf = await openPdfjs(await doc.save())
    const read = await pdf.getPageLabels()
    await pdf.loadingTask.destroy()
    return { read, ranges: tree.size() / 2 }
  }

  it('reproduces the labels exactly', async () => {
    for (const labels of [
      ['i', 'ii', '1', '2'],
      ['1', '2', '3'],
      ['3', '4', '1', '2'],
      ['1', '1', '2'],
      ['Cover', '1', '2', 'Cover'],
      ['', '1'],
      ['A-9', 'A-10', 'B-1', 'B-2'],
      ['01', '02', '2'],
      ['Annex 1', 'Annex 2', '3'],
      ['עמוד 1', 'עמוד 2'],
    ]) {
      expect((await roundTrip(labels)).read, labels.join(' ')).toEqual(labels)
    }
  })

  it('writes a run of page numbers, with or without a prefix, as one range', async () => {
    expect((await roundTrip(['1', '2', '3', '4'])).ranges).toBe(1)
    expect((await roundTrip(['A-1', 'A-2', 'A-3', 'B-1', 'B-2'])).ranges).toBe(2)
    expect((await roundTrip(['i', 'ii', '1', '2', '3'])).ranges).toBe(3)
  })
})

describe('restoreRewritten: catalog entries', () => {
  const catalog: RecoveredCatalog = { lang: 'he-IL', pageLabels: ['i'], viewerPreferences: { Direction: 'R2L' }, markInfo: ['Marked'] }

  async function copy() {
    const doc = await PDFDocument.create()
    doc.addPage([100, 100])
    return doc
  }

  it('does not claim a tagged PDF once the structure tree is gone', async () => {
    const doc = await copy()
    restoreRewritten(doc, catalog)
    expect(doc.catalog.has(PDFName.of('MarkInfo'))).toBe(false)
    expect(doc.catalog.lookup(PDFName.of('Lang'), PDFHexString).decodeText()).toBe('he-IL')
  })

  it('keeps the other entries when the layers cannot be put back', async () => {
    const doc = await copy()
    doc.context.register(doc.context.obj({ Type: 'OCG', Name: PDFHexString.fromText('Layer') }))
    // Radio-button sets in the shape pdf.js hands them over (Sets) once made the rebuild throw.
    const group = { id: '1R', name: 'Layer', intent: null, view: null, print: null, on: false, rbGroups: [new Set(['1R'])] as unknown as string[][] }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    restoreRewritten(doc, { ...catalog, layers: { name: null, creator: null, groups: [group], order: null } })
    expect(warn).toHaveBeenCalledWith('[export] could not restore the layers of the document', expect.any(TypeError))
    warn.mockRestore()
    expect(doc.catalog.lookup(PDFName.of('Lang'), PDFHexString).decodeText()).toBe('he-IL')
    expect(doc.catalog.has(PDFName.of('PageLabels'))).toBe(true)
    expect(doc.catalog.has(PDFName.of('ViewerPreferences'))).toBe(true)
  })

  it('reads a malformed /Usage as pdf.js does, so the layer still stays hidden', async () => {
    const doc = await copy()
    const layer = doc.context.register(doc.context.obj({ Type: 'OCG', Name: PDFHexString.fromText('Layer'), Usage: { View: 5 } }))
    const group = { id: '9R', name: 'Layer', intent: null, view: null, print: null, on: false, rbGroups: [] }
    restoreRewritten(doc, { layers: { name: null, creator: null, groups: [group], order: null } })
    const config = doc.catalog.lookup(PDFName.of('OCProperties'), PDFDict).lookup(PDFName.of('D'), PDFDict)
    expect(config.lookup(PDFName.of('OFF'), PDFArray).asArray()).toEqual([layer])
  })

  it('has viewers turn a layer on for an event only when pdf.js shows it then', async () => {
    const doc = await copy()
    const ctx = doc.context
    const layer = (name: string, usage: Record<string, Record<string, string>>) =>
      ctx.register(ctx.obj({ Type: 'OCG', Name: PDFHexString.fromText(name), Usage: usage }))
    // On by default, kept off the screen: printed only.
    const stamp = layer('Stamp', { View: { ViewState: 'OFF' }, Print: { PrintState: 'ON' } })
    // Off by default, so pdf.js never shows it, whatever its usage says.
    layer('Draft', { View: { ViewState: 'ON' }, Print: { PrintState: 'ON' } })
    const notes = layer('Notes', { Print: { PrintState: 'OFF' } })
    const group = (id: string, name: string, on: boolean, view: 'ON' | 'OFF' | null, print: 'ON' | 'OFF' | null) => ({ id, name, intent: null, view, print, on, rbGroups: [] })
    const groups = [group('1R', 'Stamp', true, 'OFF', 'ON'), group('2R', 'Draft', false, 'ON', 'ON'), group('3R', 'Notes', false, null, 'OFF')]
    restoreRewritten(doc, { layers: { name: null, creator: null, groups, order: null } })
    const config = doc.catalog.lookup(PDFName.of('OCProperties'), PDFDict).lookup(PDFName.of('D'), PDFDict)
    const listed = config
      .lookup(PDFName.of('AS'), PDFArray)
      .asArray()
      .map((entry) => {
        const app = doc.context.lookup(entry, PDFDict)
        return [String(app.get(PDFName.of('Event'))), app.lookup(PDFName.of('OCGs'), PDFArray).asArray()]
      })
    expect(Object.fromEntries(listed)).toEqual({ '/View': [stamp], '/Print': [stamp, notes] })
  })
})

/** Fields with hierarchical names, as Acrobat and LiveCycle make them. */
const NAMES = ['applicant.first', 'applicant.last', 'address.street', 'address.city', 'single', 'form1.page1.a', 'form1.page1.b', 'form1.page2.d']

async function hierarchicalForm(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([400, 600])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const form = doc.getForm()
  NAMES.forEach((name, i) => form.createTextField(name).addToPage(page, { x: 40, y: 540 - i * 50, width: 200, height: 24, font }))
  return doc.save({ useObjectStreams: false })
}

const fieldNames = async (bytes: Uint8Array) =>
  (await PDFDocument.load(bytes, { ignoreEncryption: true }))
    .getForm()
    .getFields()
    .map((f) => f.getName())
    .sort()

describe('exportPdf: field names after a pdf.js rewrite', () => {
  it('keeps fully qualified names when decrypting', async () => {
    const plain = await hierarchicalForm()
    const secured = await encryptPdf(plain, { owner: 'owner-only' })
    const pages = await readPages(secured)
    const pdf = await openPdfjs(secured)
    const fields = await extractFormFields(pdf as unknown as PDFDocumentProxy, pages)
    await pdf.loadingTask.destroy()
    const values = { ...defaultFormValues(fields), 'applicant.last': 'Lovelace', 'form1.page2.d': 'Fourth' }
    const out = await renderPdf(makeInput(secured, pages, [], { formFields: fields, formValues: values, options: { flattenForms: false } }), {
      ...testDeps,
      decrypt: pdfjsDecrypt(),
    })
    expect(await fieldNames(out)).toEqual([...NAMES].sort())
    const form = (await PDFDocument.load(out)).getForm()
    expect(form.getTextField('applicant.last').getText()).toBe('Lovelace')
    expect(form.getTextField('form1.page2.d').getText()).toBe('Fourth')
  })

  it('links every kid back to its parent after a repair', async () => {
    const plain = await hierarchicalForm()
    const copy = await pdfjsRepair()(plain)
    // pdf.js loses all but the first non-terminal kid's /Parent.
    expect(await fieldNames(copy.bytes)).not.toEqual([...NAMES].sort())
    const doc = await PDFDocument.load(copy.bytes)
    restoreRewritten(doc, copy.catalog)
    expect(await fieldNames(await doc.save())).toEqual([...NAMES].sort())
  })
})
