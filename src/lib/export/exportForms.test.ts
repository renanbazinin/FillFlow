import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import type { Element, FormField, FormWidget } from '../../model/types'
import { renderPdf } from './engine'
import type { ApplyFormOptions } from './forms'
import { debugWrite } from './testing/debug'
import { buildPdf } from './testing/fixtures'
import { makeInput, makeText, testDeps } from './testing/helpers'
import { openPdfjs, readPages, renderPage, textInView } from './testing/pdfjs'

/**
 * The forms engine belongs to another module; here a minimal stand-in fills fields through
 * pdf-lib so we can check the exporter's side of the contract: call order, `flatten`,
 * `getUnicodeFont`, `flattenAlso`, and that field values and overlays end up together in the output.
 */
vi.mock('./forms', () => ({
  applyFormValues: vi.fn(async (doc: PDFDocument, _fields, values, opts: ApplyFormOptions) => {
    const form = doc.getForm()
    const name = form.getTextField('name')
    name.setText(String(values.name ?? ''))
    if (values.agree) form.getCheckBox('agree').check()
    if (/[^\x20-\x7e]/.test(String(values.name))) name.updateAppearances(await opts.getUnicodeFont())
    if (opts.flatten) form.flatten()
    // Flattens `flattenAlso` into a black box in place of each widget.
    const { fill, popGraphicsState, pushGraphicsState, rectangle, setFillingRgbColor } = await import('pdf-lib')
    for (const field of (opts.flattenAlso ?? []).map((n) => form.getField(n))) {
      for (const widget of field.acroField.getWidgets()) {
        const { x, y, width, height } = widget.getRectangle()
        const page = doc.getPages().find((p) => p.ref === widget.P())!
        page.pushOperators(pushGraphicsState(), setFillingRgbColor(0, 0, 0), rectangle(x, y, width, height), fill(), popGraphicsState())
        page.node.removeAnnot(doc.context.getObjectRef(widget.dict)!)
      }
      form.acroForm.removeField(field.acroField)
    }
    return { unwritten: [] }
  }),
}))

const FIELDS: FormField[] = [
  { name: 'name', type: 'text', widgets: [], readOnly: false, required: false, defaultValue: '' },
  { name: 'agree', type: 'checkbox', widgets: [], readOnly: false, required: false, defaultValue: false },
]

describe('exportPdf: form values and overlays', () => {
  it('keeps editable fields when not flattening', async () => {
    const bytes = await buildPdf([{ size: [612, 792] }], { form: true })
    const pages = await readPages(bytes)
    const out = await renderPdf(
      makeInput(bytes, pages, [makeText(0, 300, 180, 'Overlay text')], {
        formFields: FIELDS,
        formValues: { name: 'Ada Lovelace', agree: true },
        options: { flattenForms: false },
      }),
      testDeps,
    )
    const form = (await PDFDocument.load(out)).getForm()
    expect(form.getTextField('name').getText()).toBe('Ada Lovelace')
    expect(form.getCheckBox('agree').isChecked()).toBe(true)
    const pdf = await openPdfjs(out)
    const annots = await (await pdf.getPage(1)).getAnnotations()
    expect(annots.find((a) => a.fieldName === 'name')?.fieldValue).toBe('Ada Lovelace')
    expect((await textInView(pdf, 1)).map((t) => t.str)).toContain('Overlay text')
    await pdf.loadingTask.destroy()
  })

  it('bakes Hebrew field values with the shared Unicode font when flattening', async () => {
    const bytes = await buildPdf([{ size: [612, 792] }], { form: true })
    const pages = await readPages(bytes)
    // The overlay uses Arimo Regular too, so both share one subset.
    const out = await renderPdf(
      makeInput(bytes, pages, [makeText(0, 300, 180, 'שלום overlay')], {
        formFields: FIELDS,
        formValues: { name: 'ישראל ישראלי', agree: true },
        options: { flattenForms: true },
      }),
      testDeps,
    )
    await debugWrite('forms-flat.pdf', out)
    const doc = await PDFDocument.load(out)
    expect(doc.getForm().getFields()).toHaveLength(0)
    const pdf = await openPdfjs(out)
    const strings = (await textInView(pdf, 1)).map((t) => t.str)
    expect(strings).toContain('ישראל ישראלי')
    expect(strings.join(' ')).toContain('overlay')
    // Field appearance and overlay are both visible.
    const raster = await renderPage(pdf, 1, 2)
    expect(raster.inkIn(60, 792 - 624, 200, 24)).toBeGreaterThan(0.01)
    expect(raster.inkIn(300, 180, 120, 20)).toBeGreaterThan(0.01)
    await pdf.loadingTask.destroy()
    // One embedded copy of Arimo Regular (shared subset), not two.
    const arimo = doc.context
      .enumerateIndirectObjects()
      .map(([, obj]) => obj)
      .filter((obj): obj is PDFDict => obj instanceof PDFDict && obj.get(PDFName.of('Subtype')) === PDFName.of('Type0'))
      .filter((font) => String(font.get(PDFName.of('BaseFont'))).includes('Arimo-Regular'))
    expect(arimo).toHaveLength(1)
  })

  it('flattens the fields under placed items even when not flattening, on every page they are on', async () => {
    const { applyFormValues } = await import('./forms')
    // "name" has a second widget on page 2, whose own content leaves its graphics state dirty.
    const built = await PDFDocument.load(
      await buildPdf([{ size: [612, 792] }, { size: [612, 792], content: 'q 0.5 0 0 0.5 0 0 cm q 3 0 0 3 0 0 cm BT' }], { form: true }),
    )
    built.getForm().getTextField('name').addToPage(built.getPage(1), { x: 60, y: 600, width: 200, height: 24 })
    const bytes = await built.save({ useObjectStreams: false })
    const pages = await readPages(bytes)
    // The widgets as the editor reads them (pdf-lib pads their /Rect by half the border width).
    const nameRect = { x: 59.5, y: 167.5, width: 201, height: 25 }
    const widget = (page: number, rect: FormWidget['rect']): FormWidget => ({ id: `${page}-${rect.y}`, page, rect })
    const fields: FormField[] = [
      { ...FIELDS[0], widgets: [widget(0, nameRect), widget(1, nameRect)] },
      { ...FIELDS[1], widgets: [widget(0, { x: 59.5, y: 215.5, width: 17, height: 17 })] },
    ]
    // A text box over the name field on page 1, and a checkmark right next to the check box.
    const check: Element = { id: 'check', kind: 'mark', page: 0, x: 76.2, y: 217, width: 14, height: 14, shape: 'check', color: '#111827' }
    const elements = [makeText(0, 200, 172, 'Over it'), check]
    for (const flattenForms of [true, false]) {
      vi.mocked(applyFormValues).mockClear()
      const out = await renderPdf(makeInput(bytes, pages, elements, { formFields: fields, options: { flattenForms } }), testDeps)
      expect(vi.mocked(applyFormValues).mock.calls[0][3].flattenAlso).toEqual(flattenForms ? [] : ['name'])
      if (flattenForms) continue
      // Page 2 has no elements, but the flattened widget lands where it was there too.
      const pdf = await openPdfjs(out)
      const raster = await renderPage(pdf, 2, 2)
      expect(raster.bbox((r, g, b) => r + g + b < 100)).toEqual(nameRect)
      await pdf.loadingTask.destroy()
    }
  })

  it('skips the forms step entirely for documents without fields', async () => {
    const { applyFormValues } = await import('./forms')
    vi.mocked(applyFormValues).mockClear()
    const bytes = await buildPdf([{ size: [200, 200] }])
    const pages = await readPages(bytes)
    await renderPdf(makeInput(bytes, pages, [makeText(0, 10, 10, 'x')]), testDeps)
    expect(applyFormValues).not.toHaveBeenCalled()
  })

  it('passes on the fields whose values could not be written', async () => {
    const { applyFormValues } = await import('./forms')
    vi.mocked(applyFormValues).mockResolvedValueOnce({ unwritten: ['name'] })
    const bytes = await buildPdf([{ size: [612, 792] }], { form: true })
    const pages = await readPages(bytes)
    const onUnwrittenFields = vi.fn()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await renderPdf(makeInput(bytes, pages, [], { formFields: FIELDS, formValues: { name: 'x' } }), { ...testDeps, onUnwrittenFields })
    warn.mockRestore()
    expect(onUnwrittenFields).toHaveBeenCalledWith(['name'])
  })

  it('reports a forms failure as an ExportError', async () => {
    const { applyFormValues } = await import('./forms')
    vi.mocked(applyFormValues).mockRejectedValueOnce(new Error('boom'))
    const bytes = await buildPdf([{ size: [612, 792] }], { form: true })
    const pages = await readPages(bytes)
    await expect(
      renderPdf(makeInput(bytes, pages, [], { formFields: FIELDS, formValues: { name: 'x' } }), testDeps),
    ).rejects.toMatchObject({ name: 'ExportError', code: 'forms' })
  })
})
