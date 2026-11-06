import { AnnotationFlags, PDFDocument, PDFHexString, PDFName, PDFString, degrees, fill, rectangle, rgb, setFillingRgbColor } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import type { Asset, ImageElement, MarkElement } from '../../model/types'
import { extractFormFields } from '../pdf/formFields'
import type { PDFDocumentProxy } from '../pdf/pdfjs'
import { renderPdf } from './engine'
import { debugWrite } from './testing/debug'
import { encryptPdf } from './testing/fixtures'
import { makeInput, makeText, testDeps } from './testing/helpers'
import { openPdfjs, pdfjsDecrypt, readPages, renderPage, textInView, type PdfjsProxy } from './testing/pdfjs'

/** @napi-rs/canvas ships with pdfjs-dist (pdf.js renders with it in Node) and encodes real PNGs. */
type NapiCanvas = {
  createCanvas(w: number, h: number): { getContext(t: '2d'): CanvasRenderingContext2D; toBuffer(mime: 'image/png'): Uint8Array }
}
const napi: NapiCanvas = await import(/* @vite-ignore */ `@napi-rs/${'canvas'}`)

/** A solid dark PNG, standing in for a signature. */
function inkAsset(): Asset {
  const canvas = napi.createCanvas(10, 4)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#111827'
  ctx.fillRect(0, 0, 10, 4)
  const png = new Uint8Array(canvas.toBuffer('image/png'))
  return { id: 'ink', mime: 'image/png', dataUrl: `data:image/png;base64,${btoa(String.fromCharCode(...png))}`, width: 10, height: 4 }
}

/**
 * A Letter page (view y = 792 − PDF y) with fields drawn opaque, as most forms have them:
 *  - text fields "Name" at view x 100–300, y 168–192, and "Email" at y 208–232 (pdf-lib's look:
 *    white, with a border),
 *  - a signature field "Signature" at view x 100–300, y 542–592, whose appearance fills it light
 *    yellow (a field given a fill colour).
 */
async function formPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  const form = doc.getForm()
  form.createTextField('Name').addToPage(page, { x: 100, y: 600, width: 200, height: 24 })
  form.createTextField('Email').addToPage(page, { x: 100, y: 560, width: 200, height: 24 })
  const ctx = doc.context
  const look = ctx.register(ctx.formXObject([setFillingRgbColor(1, 1, 0.8), rectangle(0, 0, 200, 50), fill()], { BBox: [0, 0, 200, 50] }))
  const sig = ctx.register(
    ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFString.of('Signature'), F: 4, Rect: [100, 200, 300, 250], P: page.ref, MK: { BG: [1, 1, 0.8] }, AP: { N: look } }),
  )
  page.node.addAnnot(sig)
  form.acroForm.addField(sig)
  return doc.save({ useObjectStreams: false })
}

/**
 * What the forms panel doesn't offer, drawn opaque, on a Letter page (view y = 792 − PDF y):
 *  - push buttons "Photo" at view x 350–470, y 182–332 (light blue, printable), "Print" at view
 *    x 100–180, y 668–692 (grey, on screen only) and "Reset" at view x 400–480, y 668–692 (grey),
 *  - a signature field "Approved" at view x 100–300, y 542–592, signed already, whose appearance
 *    fills it light yellow,
 *  - with `name`, a text field "Name" at view x 100–300, y 168–192.
 * And on a second page, turned 90° (view = 792 × 612, view x = PDF y, view y = PDF x), a push
 * button "Next" at view x 500–540, y 300–380 (light blue).
 */
async function buttonsPdf({ name }: { name: boolean }): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const ctx = doc.context
  const page = doc.addPage([612, 792])
  const form = doc.getForm()
  if (name) form.createTextField('Name').addToPage(page, { x: 100, y: 600, width: 200, height: 24 })
  const button = (fieldName: string, caption: string, on: typeof page, rect: { x: number; y: number; width: number; height: number }, color = rgb(0.8, 0.9, 1)) => {
    const field = form.createButton(fieldName)
    field.addToPage(caption, on, { ...rect, backgroundColor: color, borderWidth: 0 })
    const widget = field.acroField.getWidgets()[0]
    // An action, as push buttons have (pdf.js warns about those without one).
    widget.dict.set(PDFName.of('A'), ctx.obj({ Type: 'Action', S: 'Named', N: 'Print' }))
    return widget
  }
  button('Photo', 'Attach photo', page, { x: 350, y: 460, width: 120, height: 150 })
  button('Print', 'Print', page, { x: 100, y: 100, width: 80, height: 24 }, rgb(0.8, 0.8, 0.8)).setFlagTo(AnnotationFlags.Print, false)
  button('Reset', 'Reset', page, { x: 400, y: 100, width: 80, height: 24 }, rgb(0.8, 0.8, 0.8))
  const look = ctx.register(ctx.formXObject([setFillingRgbColor(1, 1, 0.8), rectangle(0, 0, 200, 50), fill()], { BBox: [0, 0, 200, 50] }))
  const signature = ctx.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached', ByteRange: [0, 10, 20, 10] })
  signature.set(PDFName.of('Contents'), PDFHexString.of('3082000102'))
  const sig = ctx.register(
    ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFString.of('Approved'), F: 4, Rect: [100, 200, 300, 250], P: page.ref, AP: { N: look }, V: ctx.register(signature) }),
  )
  page.node.addAnnot(sig)
  form.acroForm.addField(sig)
  form.acroForm.dict.set(PDFName.of('SigFlags'), ctx.obj(3))
  const turned = doc.addPage([612, 792])
  turned.setRotation(degrees(90))
  button('Next', 'Next', turned, { x: 300, y: 500, width: 80, height: 40 })
  return doc.save({ useObjectStreams: false })
}

const fieldsOf = async (pdf: PdfjsProxy, bytes: Uint8Array) => extractFormFields(pdf as unknown as PDFDocumentProxy, await readPages(bytes))
const near = (a: number[], b: number[], tol = 24) => b.every((v, i) => Math.abs(a[i] - v) <= tol)

describe('exportPdf: items over form fields that stay fillable', () => {
  it('flattens the fields under items, so that viewers show the items over them', async () => {
    const plain = await formPdf()
    // Encrypted files are rewritten by pdf.js first, and their fields found again by position.
    for (const [kind, bytes] of [
      ['plain', plain],
      ['encrypted', await encryptPdf(plain, { owner: 'owner-secret' })],
    ] as const) {
      const original = await openPdfjs(bytes)
      const formFields = await fieldsOf(original, bytes)
      await original.loadingTask.destroy()
      // A signature in the signature field (where its "Sign here" puts it), and a text box and a
      // checkmark over the right end of the name field.
      const signature: ImageElement = { id: 'sig', kind: 'image', page: 0, x: 150, y: 547, width: 100, height: 40, role: 'signature', assetId: 'ink', opacity: 1 }
      const text = makeText(0, 200, 173, 'OVER FIELD')
      const check: MarkElement = { id: 'check', kind: 'mark', page: 0, x: 280, y: 173, width: 14, height: 14, shape: 'check', color: '#111827' }
      const out = await renderPdf(
        makeInput(bytes, await readPages(bytes), [signature, text, check], {
          assets: { ink: inkAsset() },
          formFields,
          formValues: { Name: 'Dana Levi', Email: 'dana@example.com' },
          options: { flattenForms: false },
        }),
        { ...testDeps, decrypt: pdfjsDecrypt() },
      )
      await debugWrite(`over-fields-${kind}.pdf`, out)

      // Rendered as viewers do (annotations over the page): every item shows, over its field.
      const pdf = await openPdfjs(out)
      const raster = await renderPage(pdf, 1, 2)
      expect(raster.inkIn(152, 549, 96, 36), `${kind}: signature`).toBeGreaterThan(0.9)
      expect(near(raster.at(110, 560), [255, 255, 204]), `${kind}: the signature field’s look, under it`).toBe(true)
      expect(raster.inkIn(text.x, text.y, text.width, text.height), `${kind}: text box`).toBeGreaterThan(0.05)
      expect(raster.inkIn(283, 176, 8, 8), `${kind}: checkmark`).toBeGreaterThan(0.1)
      expect((await textInView(pdf, 1)).map((t) => t.str)).toContain('Dana Levi')
      // The field no item covers stays fillable. The signature field is gone, so reopening the copy
      // shows no "Sign here" over the signature.
      const widgets = await (await pdf.getPage(1)).getAnnotations()
      expect(widgets.map((a) => [a.fieldName, a.fieldValue])).toEqual([['Email', 'dana@example.com']])
      expect((await fieldsOf(pdf, out)).map((f) => f.name)).toEqual(['Email'])
      await pdf.loadingTask.destroy()
    }
  })

  it('flattens push buttons and signed signatures under items too, which aren’t fields to fill', async () => {
    const check = (id: string, page: number, x: number, y: number): MarkElement => ({ id, kind: 'mark', page, x, y, width: 14, height: 14, shape: 'check', color: '#111827' })
    const withName = await buttonsPdf({ name: true })
    // A file whose only fields are those has nothing to fill, and so no forms step.
    for (const [kind, bytes] of [
      ['plain', withName],
      ['encrypted', await encryptPdf(withName, { owner: 'owner-secret' })],
      ['buttons only', await buttonsPdf({ name: false })],
    ] as const) {
      const original = await openPdfjs(bytes)
      const formFields = await fieldsOf(original, bytes)
      await original.loadingTask.destroy()
      expect(formFields.map((f) => f.name), kind).toEqual(kind === 'buttons only' ? [] : ['Name'])
      // A checkmark and a text box on the photo button, a signature on the signed signature, and
      // checkmarks on the "Print" button and on the button of the turned page.
      const text = makeText(0, 360, 280, 'MY PHOTO')
      const signature: ImageElement = { id: 'sig', kind: 'image', page: 0, x: 150, y: 547, width: 100, height: 40, role: 'signature', assetId: 'ink', opacity: 1 }
      const elements = [check('photo', 0, 403, 243), text, signature, check('print', 0, 130, 673), check('next', 1, 513, 333)]
      const out = await renderPdf(
        makeInput(bytes, await readPages(bytes), elements, { assets: { ink: inkAsset() }, formFields, options: { flattenForms: false } }),
        { ...testDeps, decrypt: pdfjsDecrypt() },
      )
      await debugWrite(`over-buttons-${kind}.pdf`, out)

      // Rendered as viewers do: every item shows over what it was put on, whose look is kept
      // under it, except the "Print" button's (screen-only buttons go, as with flattening).
      const pdf = await openPdfjs(out)
      const raster = await renderPage(pdf, 1, 2)
      expect(raster.inkIn(406, 246, 8, 8), `${kind}: checkmark on the photo button`).toBeGreaterThan(0.1)
      expect(raster.inkIn(text.x, text.y, text.width, text.height), `${kind}: text box`).toBeGreaterThan(0.05)
      expect(near(raster.at(355, 320), [204, 230, 255]), `${kind}: the photo button’s look, under them`).toBe(true)
      expect(raster.inkIn(152, 549, 96, 36), `${kind}: signature`).toBeGreaterThan(0.9)
      expect(near(raster.at(110, 560), [255, 255, 204]), `${kind}: the signed signature’s look, under it`).toBe(true)
      expect(raster.inkIn(133, 676, 8, 8), `${kind}: checkmark on the "Print" button`).toBeGreaterThan(0.1)
      expect(near(raster.at(105, 688), [255, 255, 255]), `${kind}: no "Print" button`).toBe(true)
      expect(near(raster.at(405, 688), [204, 204, 204]), `${kind}: the "Reset" button, under nothing, stays`).toBe(true)
      const turned = await renderPage(pdf, 2, 2)
      expect(turned.inkIn(516, 336, 8, 8), `${kind}: checkmark on the turned page’s button`).toBeGreaterThan(0.1)
      expect(near(turned.at(503, 375), [204, 230, 255]), `${kind}: its look, under it`).toBe(true)
      // Only what no item covers is still a field.
      const widgets = [...(await (await pdf.getPage(1)).getAnnotations()), ...(await (await pdf.getPage(2)).getAnnotations())]
      expect(widgets.map((a) => a.fieldName).sort(), kind).toEqual(kind === 'buttons only' ? ['Reset'] : ['Name', 'Reset'])
      await pdf.loadingTask.destroy()
    }
  })
})
