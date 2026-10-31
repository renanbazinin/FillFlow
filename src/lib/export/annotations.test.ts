import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFString, fill, rectangle, setFillingRgbColor, type PDFRef } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import type { ShapeElement } from '../../model/types'
import { renderPdf } from './engine'
import { makeInput, testDeps } from './testing/helpers'
import { openPdfjs, readPages, renderPage } from './testing/pdfjs'

const box = (id: string, x: number, y: number, width: number, height: number, fillColor: string): ShapeElement => ({
  id,
  kind: 'shape',
  page: 0,
  x,
  y,
  width,
  height,
  shape: 'rect',
  strokeColor: null,
  fillColor,
  strokeWidth: 0,
  opacity: 1,
})

/**
 * A 300×300 page (view y = 300 − PDF y) with, in /Annots order:
 *  - a green Square at PDF x 40–100, y 190–250 (under the FreeText),
 *  - a black FreeText bar at x 50–250, y 200–240, its appearance offset by its BBox,
 *  - a blue sticky note (Text) at x 200–220, y 100–120 with its pop-up,
 *  - a blue Stamp at x 10–40, y 10–40, away from everything,
 *  - a hidden Square at x 150–200, y 150–200.
 */
async function annotatedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const ctx = doc.context
  const page = doc.addPage([300, 300])
  const appearance = (rgb: [number, number, number], bbox: [number, number, number, number]) =>
    ctx.register(ctx.formXObject([setFillingRgbColor(...rgb), rectangle(bbox[0], bbox[1], bbox[2] - bbox[0], bbox[3] - bbox[1]), fill()], { BBox: bbox }))
  const annot = (dict: Record<string, unknown>) => ctx.register(ctx.obj({ Type: 'Annot', F: 4, ...dict } as never))
  const square = annot({ Subtype: 'Square', Rect: [40, 190, 100, 250], AP: { N: appearance([0, 0.8, 0], [0, 0, 60, 60]) } })
  const freeText = annot({
    Subtype: 'FreeText',
    Rect: [50, 200, 250, 240],
    AP: { N: appearance([0, 0, 0], [10, 10, 210, 50]) },
    DA: PDFString.of('0 g /Helv 12 Tf'),
    Contents: PDFString.of('Old value'),
  })
  const popup = annot({ Subtype: 'Popup', Rect: [220, 60, 300, 120], Open: false })
  const note = annot({ Subtype: 'Text', Rect: [200, 100, 220, 120], AP: { N: appearance([0, 0, 1], [0, 0, 20, 20]) }, Popup: popup })
  ;(ctx.lookup(popup) as PDFDict).set(PDFName.of('Parent'), note)
  const stamp = annot({ Subtype: 'Stamp', Rect: [10, 10, 40, 40], AP: { N: appearance([0, 0, 1], [0, 0, 30, 30]) } })
  const hidden = annot({ Subtype: 'Square', F: 2, Rect: [150, 150, 200, 200], AP: { N: appearance([0, 0, 0], [0, 0, 50, 50]) } })
  page.node.set(PDFName.of('Annots'), ctx.obj([square, freeText, note, popup, stamp, hidden]))
  return doc.save({ useObjectStreams: false })
}

const near = (a: number[], b: number[], tol = 24) => b.every((v, i) => Math.abs(a[i] - v) <= tol)

describe('exportPdf: existing annotations under placed elements', () => {
  it('bakes them into the page under the elements, keeping their order', async () => {
    const bytes = await annotatedPdf()
    const pages = await readPages(bytes)
    const elements = [box('whiteout', 150, 50, 110, 60, '#ffffff'), box('sign', 195, 175, 30, 30, '#ff0000')]
    for (const flattenForms of [true, false]) {
      const out = await renderPdf(makeInput(bytes, pages, elements, { options: { flattenForms } }), testDeps)
      const pdf = await openPdfjs(out)
      const raster = await renderPage(pdf, 1, 2)
      // The whiteout hides the part of the FreeText under it; the rest of the bar still shows.
      expect(near(raster.at(200, 80), [255, 255, 255]), 'under the whiteout').toBe(true)
      expect(near(raster.at(100, 80), [0, 0, 0]), 'rest of the FreeText').toBe(true)
      // The Square stays below the FreeText.
      expect(near(raster.at(70, 80), [0, 0, 0]), 'FreeText over the Square').toBe(true)
      expect(near(raster.at(45, 80), [0, 204, 0]), 'Square').toBe(true)
      expect(near(raster.at(210, 190), [255, 0, 0]), 'element over the note').toBe(true)
      expect(near(raster.at(25, 275), [0, 0, 255]), 'untouched stamp').toBe(true)
      await pdf.loadingTask.destroy()

      // Only the annotations no element covers are left (the pop-up went with its note).
      const doc = await PDFDocument.load(out)
      const subtypes = doc
        .getPage(0)
        .node.Annots()!
        .asArray()
        .map((ref) => String((doc.context.lookup(ref as PDFRef) as PDFDict).get(PDFName.of('Subtype'))))
      expect(subtypes).toEqual(['/Stamp', '/Square'])
    }
  })

  it('leaves screen-only annotations as they are, since page content prints', async () => {
    const doc = await PDFDocument.create()
    const ctx = doc.context
    const page = doc.addPage([300, 300])
    const bar = () => ctx.register(ctx.formXObject([setFillingRgbColor(0, 0, 0), rectangle(0, 0, 200, 40), fill()], { BBox: [0, 0, 200, 40] }))
    // Black bars at view y 60–100 (Print flag cleared) and y 160–200 (no flags at all).
    const noPrint = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'FreeText', F: 0, Rect: [50, 200, 250, 240], AP: { N: bar() } }))
    const noFlags = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [50, 100, 250, 140], AP: { N: bar() } }))
    page.node.set(PDFName.of('Annots'), ctx.obj([noPrint, noFlags]))
    const bytes = await doc.save({ useObjectStreams: false })
    const pages = await readPages(bytes)

    const out = await renderPdf(makeInput(bytes, pages, [box('whiteout', 150, 50, 110, 160, '#ffffff')]), testDeps)
    expect((await PDFDocument.load(out)).getPage(0).node.Annots()!.size()).toBe(2)
    const pdf = await openPdfjs(out)
    // As in the original, neither reaches paper; on screen both still show.
    const printed = await renderPage(pdf, 1, 2, 'print')
    const shown = await renderPage(pdf, 1, 2)
    for (const y of [80, 180]) {
      expect(near(printed.at(100, y), [255, 255, 255]), `printed at y ${y}`).toBe(true)
      expect(near(shown.at(100, y), [0, 0, 0]), `shown at y ${y}`).toBe(true)
    }
    await pdf.loadingTask.destroy()
  })

  it('leaves alone what pdf.js does not draw: text markup without valid /QuadPoints', async () => {
    const doc = await PDFDocument.create()
    const ctx = doc.context
    const page = doc.addPage([300, 300])
    const bar = () => ctx.register(ctx.formXObject([setFillingRgbColor(0, 0, 0), rectangle(0, 0, 200, 40), fill()], { BBox: [0, 0, 200, 40] }))
    const highlight = (y: number, quads?: (number | PDFRef)[]) =>
      ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Highlight', F: 4, Rect: [50, y, 250, y + 40], AP: { N: bar() }, ...(quads && { QuadPoints: quads }) }))
    // Black bars at view y 60–100 (no /QuadPoints), 160–200 (six numbers), 250–290 (valid) and
    // 110–150 (valid, its numbers indirect objects, which pdf.js resolves).
    const annots = [
      highlight(200),
      highlight(100, [50, 140, 250, 140, 50, 100]),
      highlight(10, [50, 50, 250, 50, 50, 10, 250, 10]),
      highlight(150, [50, 190, 250, 190, 50, 150, 250, 150].map((n) => ctx.register(PDFNumber.of(n)))),
    ]
    page.node.set(PDFName.of('Annots'), ctx.obj(annots))
    const bytes = await doc.save({ useObjectStreams: false })
    const pages = await readPages(bytes)

    const out = await renderPdf(makeInput(bytes, pages, [box('whiteout', 40, 50, 100, 245, '#ffffff')]), testDeps)
    const pdf = await openPdfjs(out)
    const raster = await renderPage(pdf, 1, 2)
    // As in the editor, the first two show nowhere; the valid ones show outside the whiteout only.
    expect(near(raster.at(200, 80), [255, 255, 255]), 'no quad points').toBe(true)
    expect(near(raster.at(200, 180), [255, 255, 255]), 'six quad points').toBe(true)
    expect(near(raster.at(200, 270), [0, 0, 0]), 'valid quad points').toBe(true)
    expect(near(raster.at(100, 270), [255, 255, 255]), 'under the whiteout').toBe(true)
    expect(near(raster.at(200, 130), [0, 0, 0]), 'indirect quad points').toBe(true)
    expect(near(raster.at(100, 130), [255, 255, 255]), 'indirect, under the whiteout').toBe(true)
    await pdf.loadingTask.destroy()
    expect((await PDFDocument.load(out)).getPage(0).node.Annots()!.asArray()).toEqual(annots.slice(0, 2))
  })

  it('reads the flags as pdf.js does', async () => {
    const doc = await PDFDocument.create()
    const ctx = doc.context
    const page = doc.addPage([300, 300])
    const square = () => ctx.register(ctx.formXObject([setFillingRgbColor(0, 0, 0), rectangle(0, 0, 40, 40), fill()], { BBox: [0, 0, 40, 40] }))
    const annot = (Subtype: string, F: number, x: number) => ctx.register(ctx.obj({ Type: 'Annot', Subtype, F, Rect: [x, 130, x + 40, 170], AP: { N: square() } }))
    // Invisible + Print: pdf.js ignores Invisible on the types it knows, not on others (Watermark).
    const known = annot('Square', 1 | 4, 20)
    const unknown = annot('Watermark', 1 | 4, 80)
    // pdf.js reads flags that aren't a positive integer as none: shown, but not printed.
    const fraction = annot('Square', 4.5, 140)
    const negative = annot('Square', -4, 200)
    page.node.set(PDFName.of('Annots'), ctx.obj([known, unknown, fraction, negative]))
    const bytes = await doc.save({ useObjectStreams: false })
    const pages = await readPages(bytes)

    const out = await renderPdf(makeInput(bytes, pages, [box('sign', 10, 145, 280, 10, '#ff0000')]), testDeps)
    expect((await PDFDocument.load(out)).getPage(0).node.Annots()!.asArray()).toEqual([unknown, fraction, negative])
  })

  it('leaves the annotations of pages without elements alone', async () => {
    const bytes = await annotatedPdf()
    const pages = await readPages(bytes)
    const out = await renderPdf(makeInput(bytes, pages, []), testDeps)
    expect((await PDFDocument.load(out)).getPage(0).node.Annots()!.size()).toBe(6)
  })
})
