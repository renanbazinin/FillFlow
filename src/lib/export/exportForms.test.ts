import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import type { FormField } from '../../model/types'
import { renderPdf } from './engine'
import type { ApplyFormOptions } from './forms'
import { debugWrite } from './testing/debug'
import { buildPdf } from './testing/fixtures'
import { makeInput, makeText, testDeps } from './testing/helpers'
import { openPdfjs, readPages, renderPage, textInView } from './testing/pdfjs'

/**
 * The forms engine belongs to another module; here a minimal stand-in fills fields through
 * pdf-lib so we can check the exporter's side of the contract: call order, `flatten`,
 * `getUnicodeFont`, and that field values and overlays end up together in the output.
 */
vi.mock('./forms', () => ({
  applyFormValues: vi.fn(async (doc, _fields, values, opts: ApplyFormOptions) => {
    const form = doc.getForm()
    const name = form.getTextField('name')
    name.setText(String(values.name ?? ''))
    if (values.agree) form.getCheckBox('agree').check()
    if (/[^\x20-\x7e]/.test(String(values.name))) name.updateAppearances(await opts.getUnicodeFont())
    if (opts.flatten) form.flatten()
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

  it('skips the forms step entirely for documents without fields', async () => {
    const { applyFormValues } = await import('./forms')
    vi.mocked(applyFormValues).mockClear()
    const bytes = await buildPdf([{ size: [200, 200] }])
    const pages = await readPages(bytes)
    await renderPdf(makeInput(bytes, pages, [makeText(0, 10, 10, 'x')]), testDeps)
    expect(applyFormValues).not.toHaveBeenCalled()
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
