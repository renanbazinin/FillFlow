import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  StandardFonts,
  beginText,
  decodePDFRawStream,
  endText,
  setFontAndSize,
  setTextMatrix,
  showText,
} from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import type { FormValues } from '../../model/types'
import { defaultFormValues, extractFormFields } from '../pdf/formFields'
import { visualOrder } from '../pdf/forms/bidi'
import type { PDFDocumentProxy } from '../pdf/pdfjs'
import { renderPdf } from './engine'
import { SubsetFont, encodeTyped } from './subsetFont'
import { buildPdf } from './testing/fixtures'
import { testFont, testFontBytes } from './testing/fonts'
import { makeInput, testDeps } from './testing/helpers'
import { openPdfjs, readPages, renderPage } from './testing/pdfjs'

// The real encodeTyped, which a test swaps for the encoding field appearances used before it.
vi.mock('./subsetFont', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./subsetFont')>()
  return { ...actual, encodeTyped: vi.fn(actual.encodeTyped) }
})

/** A form for right-to-left values: two single-line fields, a multi-line one, two combs and a list box. */
async function hebrewForm(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  const form = doc.getForm()
  form.createTextField('optional').addToPage(page, { x: 60, y: 700, width: 300, height: 24 })
  form.createTextField('greeting').addToPage(page, { x: 60, y: 660, width: 300, height: 24 })
  const notes = form.createTextField('notes')
  notes.enableMultiline()
  notes.addToPage(page, { x: 60, y: 560, width: 300, height: 80 })
  for (const [name, y] of [
    ['comb', 500],
    ['pointed', 460],
  ] as const) {
    const comb = form.createTextField(name)
    comb.setMaxLength(8)
    comb.enableCombing()
    comb.addToPage(page, { x: 60, y, width: 240, height: 30 })
  }
  const list = form.createOptionList('list')
  list.addToPage(page, { x: 60, y: 380, width: 200, height: 60 })
  // After the widget: pdf-lib would draw the options with Helvetica, which has no Hebrew.
  list.addOptions(['(א) ראשון', 'שֵׁנִי (ב)'])
  // pdf-lib bakes its own font sizes into /DA; real forms mostly say 0 (auto).
  for (const field of form.getFields()) field.acroField.setDefaultAppearance('0 g /Helv 0 Tf')
  return doc.save({ updateFieldAppearances: false })
}

describe('exportPdf: font for non-Latin field values', () => {
  it('embeds only the glyphs used, also when fields stay editable', async () => {
    const bytes = await buildPdf([{ size: [612, 792] }], { form: true })
    const pages = await readPages(bytes)
    const original = await openPdfjs(bytes)
    const fields = await extractFormFields(original as unknown as PDFDocumentProxy, pages)
    await original.loadingTask.destroy()
    const values = { ...defaultFormValues(fields), name: 'שלום' }
    const out = await renderPdf(makeInput(bytes, pages, [], { formFields: fields, formValues: values, options: { flattenForms: false } }), testDeps)

    // Arimo is about 190 KB; the subset needs a few glyphs.
    const doc = await PDFDocument.load(out)
    const fontFiles = doc.context
      .enumerateIndirectObjects()
      .map(([, obj]) => obj)
      .filter((obj): obj is PDFDict => obj instanceof PDFDict && obj.get(PDFName.of('Type')) === PDFName.of('FontDescriptor'))
      .map((d) => doc.context.lookup(d.get(PDFName.of('FontFile2'))))
      .filter((s): s is PDFRawStream => s instanceof PDFRawStream)
    expect(fontFiles).toHaveLength(1)
    expect(fontFiles[0].getContentsSize()).toBeLessThan(10_000)
    expect(out.length).toBeLessThan(40_000)

    // The field keeps its value, stays editable and shows it.
    expect(doc.getForm().getTextField('name').getText()).toBe('שלום')
    const pdf = await openPdfjs(out)
    const raster = await renderPage(pdf, 1, 2)
    expect(raster.inkIn(60, 792 - 624, 200, 24)).toBeGreaterThan(0.01)
    await pdf.loadingTask.destroy()
  })

  it('can encode a line of a field so that it copies as typed, drawn the same', async () => {
    const doc = await PDFDocument.create()
    const subset = new SubsetFont(doc, testFont('sans', false), testFontBytes('sans', false), { serif: false, fixedPitch: false })
    const font = subset.asPdfLibFont()
    // A right-to-left line as field appearances draw it: in visual order, brackets mirrored (the
    // "(" glyph on the left stands for the ")" typed), points after their letter; and the same
    // line before mirroring.
    const text = 'שָׁלוֹם (לא חובה)'
    const line = visualOrder(text)
    expect(line).toEqual({ shown: '(הבוח אל) םוֹלשָׁ', typed: ')הבוח אל( םוֹלשָׁ' })
    const { shown } = line
    const typed = encodeTyped(font, shown, line.typed).asString()
    // What field appearances draw without it: the same glyphs, one character at a time.
    const plain = [...shown].map((ch) => font.encodeText(ch).asString()).join('')
    for (const hex of [typed, plain]) {
      const page = doc.addPage([300, 100])
      const name = page.node.newFontDictionary('F', subset.ref)
      page.pushOperators(beginText(), setFontAndSize(name, 30), setTextMatrix(1, 0, 0, 1, 20, 40), showText(PDFHexString.of(hex)), endText())
    }
    subset.finalize()
    const map = new TextDecoder().decode(decodePDFRawStream(doc.context.lookup((doc.context.lookup(subset.ref) as PDFDict).get(PDFName.of('ToUnicode'))) as PDFRawStream).decode())
    const unicodeOf = (cid: string) => String.fromCharCode(parseInt(map.match(new RegExp(`^<${cid}> <([0-9a-f]{4})>$`, 'm'))![1], 16))
    // The same "(" glyph, standing for ")" on the left and for "(" on its own; the ")" glyph for "(".
    expect(unicodeOf(typed.slice(0, 4))).toBe(')')
    expect(unicodeOf(typed.slice(32, 36))).toBe('(')
    expect(unicodeOf(plain.slice(0, 4))).toBe('(')
    expect(typed.slice(0, 4)).not.toBe(plain.slice(0, 4))
    const pdf = await openPdfjs(await doc.save())
    // It copies as typed (pdf.js, Firefox's viewer)…
    const { items } = await (await pdf.getPage(1)).getTextContent()
    expect(items.map((it) => ('str' in it ? it.str : '')).join('')).toBe(text)
    // …and looks the same (but for where the edges of a point and its letter overlap: drawn the
    // other way round, they blend a shade differently).
    const [a, b] = [(await renderPage(pdf, 1, 2)).data, (await renderPage(pdf, 2, 2)).data]
    let most = 0
    for (let i = 0; i < a.length; i++) most = Math.max(most, Math.abs(a[i] - b[i]))
    expect(most).toBeLessThan(10)
    expect(a.some((v, i) => i % 4 === 0 && v < 128)).toBe(true)
    await pdf.loadingTask.destroy()
    // Other fonts encode what is shown.
    const helvetica = await doc.embedFont(StandardFonts.Helvetica)
    expect(encodeTyped(helvetica, ')a(', '(a)').asString()).toBe(helvetica.encodeText(')a(').asString())
  })

  it('flattens right-to-left values so that they copy as typed, drawn where they were', async () => {
    const bytes = await hebrewForm()
    const pages = await readPages(bytes)
    const original = await openPdfjs(bytes)
    const fields = await extractFormFields(original as unknown as PDFDocumentProxy, pages)
    await original.loadingTask.destroy()
    const values: FormValues = {
      ...defaultFormValues(fields),
      optional: '(לא חובה)',
      greeting: 'שָׁלוֹם (לא חובה)',
      notes: 'דָּוִד כֹּהֵן (מנהל)\n(הערה) שָׁלוֹם',
      comb: 'א(ב)ג',
      pointed: 'שָׁלוֹם',
      list: ['שֵׁנִי (ב)'],
    }
    const flattened = async () => {
      const out = await renderPdf(makeInput(bytes, pages, [], { formFields: fields, formValues: values, options: { flattenForms: true } }), testDeps)
      const pdf = await openPdfjs(out)
      try {
        const { items } = await (await pdf.getPage(1)).getTextContent()
        // Where each run starts in view space (the page isn't turned), and how wide it is.
        const runs = items.flatMap((i) => ('str' in i && i.str.trim() ? [{ str: i.str, x: i.transform[4], y: 792 - i.transform[5], width: i.width }] : []))
        const inField = (name: string) => {
          const { x, y, width, height } = fields.find((f) => f.name === name)!.widgets[0].rect
          return runs.filter((r) => r.x >= x && r.x <= x + width && r.y >= y && r.y <= y + height)
        }
        return { inField, raster: await renderPage(pdf, 1, 2) }
      } finally {
        await pdf.loadingTask.destroy()
      }
    }

    const now = await flattened()
    const text = (name: string) => now.inField(name).map((r) => r.str)
    // Each line and list label copies as typed (pdf.js, Firefox's viewer): brackets as they were
    // typed, points after their letter.
    expect(text('optional')).toEqual(['(לא חובה)'])
    expect(text('greeting')).toEqual(['שָׁלוֹם (לא חובה)'])
    expect(text('notes')).toEqual(['דָּוִד כֹּהֵן (מנהל)', '(הערה) שָׁלוֹם'])
    expect(text('list')).toEqual(['(א) ראשון', 'שֵׁנִי (ב)'])
    // Each comb cell copies as the character typed in it (pdf.js reads the cells left to right).
    expect(text('comb')).toEqual(['ג', ')', 'ב', '(', 'א'])

    // Encoded one character at a time, as field appearances did before…
    vi.mocked(encodeTyped).mockImplementation((font, shown) => PDFHexString.of([...shown].map((ch) => font.encodeText(ch).asString()).join('')))
    const before = await flattened().finally(() => vi.mocked(encodeTyped).mockReset())
    // …they copied mirrored, points before their letter…
    expect(before.inField('optional').map((r) => r.str)).toEqual([')לא חובה('])
    expect(before.inField('greeting').map((r) => r.str)).toEqual([expect.stringMatching(/^\p{M}+ש.*\)לא חובה\($/u)])
    // …and were drawn the same: the same runs, where they were and as wide…
    const geometry = (runs: { x: number; y: number; width: number }[]) => runs.map((r) => [r.x, r.y, r.width].map((v) => v.toFixed(2)).join(' '))
    for (const name of ['optional', 'greeting', 'notes', 'list']) expect(geometry(now.inField(name)), name).toEqual(geometry(before.inField(name)))
    // …in every pixel, but where the edges of a point and its letter overlap: drawn the other way
    // round, they blend a shade differently.
    const [a, b] = [now.raster.data, before.raster.data]
    let most = 0
    for (let i = 0; i < a.length; i++) most = Math.max(most, Math.abs(a[i] - b[i]))
    expect(most).toBeLessThan(10)
    expect(a.some((v, i) => i % 4 === 0 && v < 128)).toBe(true)
  })
})
