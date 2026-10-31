import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { defaultFormValues, extractFormFields } from '../pdf/formFields'
import type { PDFDocumentProxy } from '../pdf/pdfjs'
import { renderPdf } from './engine'
import { buildPdf } from './testing/fixtures'
import { makeInput, testDeps } from './testing/helpers'
import { openPdfjs, readPages, renderPage } from './testing/pdfjs'

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
})
