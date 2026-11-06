import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFStream,
  PDFString,
  decodePDFRawStream,
  fill,
  rectangle,
  setFillingRgbColor,
  type PDFRawStream,
  type PDFRef,
} from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import type { MarkElement, ShapeElement } from '../../model/types'
import { renderPdf } from './engine'
import { encryptPdf } from './testing/fixtures'
import { makeInput, testDeps } from './testing/helpers'
import { openPdfjs, pdfjsDecrypt, readPages, renderPage } from './testing/pdfjs'

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

/** The content of an annotation's normal appearance ('' when it draws nothing). */
function normalContent(annot: PDFDict): string {
  const stream = annot.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'), PDFStream) as PDFRawStream
  return new TextDecoder().decode(decodePDFRawStream(stream).decode()).trim()
}

/** The graphics states the resources of an annotation's normal appearance declare. */
function normalGraphicsStates(annot: PDFDict): string[] {
  const stream = annot.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'), PDFStream)
  const states = stream.dict.lookupMaybe(PDFName.of('Resources'), PDFDict)?.lookupMaybe(PDFName.of('ExtGState'), PDFDict)
  return states?.keys().map((key) => key.decodeText()) ?? []
}

/** Decoded content of the first page: its content streams, in order. */
async function pageContent(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes)
  const contents = doc.getPage(0).node.Contents()
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents]
  return streams.map((stream) => new TextDecoder('latin1').decode(decodePDFRawStream(stream as PDFRawStream).decode())).join('\n')
}

/** The annotations of the first page, in /Annots order. */
async function pageAnnots(bytes: Uint8Array): Promise<PDFDict[]> {
  const doc = await PDFDocument.load(bytes)
  return doc
    .getPage(0)
    .node.Annots()!
    .asArray()
    .map((ref) => doc.context.lookup(ref) as PDFDict)
}

/**
 * Comments on a 300×300 page (view y = 300 − PDF y), in /Annots order:
 *  - a yellow Highlight with a comment, an author and a pop-up, at view x 40–200, y 80–100,
 *  - its pop-up,
 *  - a blue sticky note (Text) with a comment and a pop-up, at view x 190–214, y 81–105 (over
 *    the right end of the highlight),
 *  - its pop-up,
 *  - a reply to the note (no appearance of its own).
 */
async function commentedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const ctx = doc.context
  const page = doc.addPage([300, 300])
  const appearance = (rgb: [number, number, number], width: number, height: number) =>
    ctx.register(ctx.formXObject([setFillingRgbColor(...rgb), rectangle(0, 0, width, height), fill()], { BBox: [0, 0, width, height] }))
  const annot = (dict: Record<string, unknown>) => ctx.register(ctx.obj({ Type: 'Annot', F: 4, ...dict } as never))
  const highlight = annot({
    Subtype: 'Highlight',
    Rect: [40, 200, 200, 220],
    QuadPoints: [40, 220, 200, 220, 40, 200, 200, 200],
    AP: { N: appearance([1, 1, 0], 160, 20) },
    Contents: PDFString.of('Is 30 days right?'),
    T: PDFString.of('Dana (Reviewer)'),
  })
  const highlightPopup = annot({ Subtype: 'Popup', Rect: [200, 230, 300, 290], Parent: highlight })
  const note = annot({
    Subtype: 'Text',
    F: 28,
    Rect: [190, 195, 214, 219],
    AP: { N: appearance([0, 0, 1], 24, 24) },
    Name: 'Comment',
    Contents: PDFString.of('Please sign on the line'),
    T: PDFString.of('Reviewer'),
  })
  const notePopup = annot({ Subtype: 'Popup', Rect: [214, 120, 300, 200], Parent: note })
  ;(ctx.lookup(highlight) as PDFDict).set(PDFName.of('Popup'), highlightPopup)
  ;(ctx.lookup(note) as PDFDict).set(PDFName.of('Popup'), notePopup)
  const reply = annot({ Subtype: 'Text', F: 28, Rect: [190, 195, 214, 219], IRT: note, Contents: PDFString.of('Will do'), T: PDFString.of('Signer') })
  page.node.set(PDFName.of('Annots'), ctx.obj([highlight, highlightPopup, note, notePopup, reply]))
  return doc.save({ useObjectStreams: false })
}

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

      // The Square under the FreeText is gone. The FreeText (its text) and the note with its
      // pop-up are comments: they stay, drawing nothing. The others aren't under an element.
      const doc = await PDFDocument.load(out)
      const annots = doc
        .getPage(0)
        .node.Annots()!
        .asArray()
        .map((ref) => doc.context.lookup(ref as PDFRef) as PDFDict)
      expect(annots.map((a) => String(a.get(PDFName.of('Subtype'))))).toEqual(['/FreeText', '/Text', '/Popup', '/Stamp', '/Square'])
      expect(annots[0].lookup(PDFName.of('Contents'), PDFString).decodeText()).toBe('Old value')
      expect(annots[1].get(PDFName.of('Popup'))).toBe(doc.getPage(0).node.Annots()!.get(2))
      expect(annots.slice(0, 2).map(normalContent)).toEqual(['', ''])
      expect(normalContent(annots[3])).not.toBe('')
    }
  })

  it('marks what it bakes as an artifact in a tagged PDF, and only there', async () => {
    const plain = await annotatedPdf()
    const doc = await PDFDocument.load(plain)
    doc.catalog.set(PDFName.of('MarkInfo'), doc.context.obj({ Marked: true }))
    doc.catalog.set(PDFName.of('StructTreeRoot'), doc.context.register(doc.context.obj({ Type: 'StructTreeRoot' })))
    const tagged = await doc.save({ useObjectStreams: false })
    for (const [what, bytes] of [
      ['untagged', plain],
      ['tagged', tagged],
    ] as const) {
      const pages = await readPages(bytes)
      const out = await renderPdf(makeInput(bytes, pages, [box('whiteout', 150, 50, 110, 60, '#ffffff')]), testDeps)
      const content = await pageContent(out)
      // The FreeText under the whiteout and the Square under it, drawn one after the other.
      const baked = String.raw`(q\s+[-\d. ]+ cm\s+/FlatAnnot-\d+ Do\s+Q\s+){2}`
      expect(content, what).toMatch(new RegExp(what === 'tagged' ? String.raw`/Artifact BMC\s+${baked}EMC` : baked))
      if (what === 'untagged') expect(content).not.toContain('/Artifact')
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

  it('keeps the comments it bakes, with their text, author, pop-ups and replies', async () => {
    const plain = await commentedPdf()
    // Encrypted files are rewritten by pdf.js first; the comments survive that too.
    for (const bytes of [plain, await encryptPdf(plain, { owner: 'owner-secret' })]) {
      const pages = await readPages(bytes)
      // A signature over the note, right of the highlight (which is under the note).
      const out = await renderPdf(makeInput(bytes, pages, [box('sign', 205, 85, 55, 20, '#ff0000')]), { ...testDeps, decrypt: pdfjsDecrypt() })
      const pdf = await openPdfjs(out)
      const raster = await renderPage(pdf, 1, 2)
      // As in the editor: the signature over the note, the note over the highlight.
      expect(near(raster.at(210, 95), [255, 0, 0]), 'signature over the note').toBe(true)
      expect(near(raster.at(195, 90), [0, 0, 255]), 'note over the highlight').toBe(true)
      expect(near(raster.at(100, 90), [255, 255, 0]), 'highlight').toBe(true)
      // Viewers still list every comment.
      const comments = (await (await pdf.getPage(1)).getAnnotations()).filter((a) => a.subtype !== 'Popup')
      expect(comments.map((a) => [a.subtype, a.contentsObj?.str, a.titleObj?.str])).toEqual([
        ['Highlight', 'Is 30 days right?', 'Dana (Reviewer)'],
        ['Text', 'Please sign on the line', 'Reviewer'],
        ['Text', 'Will do', 'Signer'],
      ])
      expect(comments[2].inReplyTo).toBe(comments[1].id)
      await pdf.loadingTask.destroy()

      // Their pop-ups are kept too; the two baked ones draw nothing now.
      const annots = await pageAnnots(out)
      expect(annots.map((a) => String(a.get(PDFName.of('Subtype'))))).toEqual(['/Highlight', '/Popup', '/Text', '/Popup', '/Text'])
      for (const [annot, popup] of [annots.slice(0, 2), annots.slice(2, 4)]) {
        expect(annot.lookup(PDFName.of('Popup'))).toBe(popup)
        expect(popup.lookup(PDFName.of('Parent'))).toBe(annot)
      }
      expect([annots[0], annots[2]].map(normalContent)).toEqual(['', ''])
      // Poppler (like Adobe Reader) ignores a Highlight's appearance that declares no graphics
      // state, and draws one of its own from /QuadPoints, over the page.
      expect([annots[0], annots[2]].map((a) => normalGraphicsStates(a).length > 0)).toEqual([true, true])
    }
  })

  it('counts as a comment: a note, text, rich text, a pop-up linked either way, or a reply', async () => {
    const doc = await PDFDocument.create()
    const ctx = doc.context
    const page = doc.addPage([300, 300])
    const blue = () => ctx.register(ctx.formXObject([setFillingRgbColor(0, 0, 1), rectangle(0, 0, 20, 20), fill()], { BBox: [0, 0, 20, 20] }))
    // Blue squares along view y 80–100, at view x `x`…x + 20.
    const square = (x: number, extra: Record<string, unknown> = {}) =>
      ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Square', F: 4, Rect: [x, 200, x + 20, 220], AP: { N: blue() }, ...extra } as never))
    const popupFor = (parent: PDFRef) => ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [0, 0, 100, 50], Parent: parent }))
    const note = square(10, { Subtype: 'Text' })
    const text = square(40, { Contents: PDFString.of('A comment') })
    const rich = square(70, { RC: PDFString.of('<body><p>A rich comment</p></body>') })
    const withPopup = square(100)
    const popup = popupFor(withPopup)
    ;(ctx.lookup(withPopup) as PDFDict).set(PDFName.of('Popup'), popup)
    const popupParent = square(130)
    const parentsPopup = popupFor(popupParent)
    const repliedTo = square(160)
    const reply = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', F: 4, Rect: [160, 20, 180, 40], IRT: repliedTo, Contents: PDFString.of('Why?') }))
    const blank = square(190, { Contents: PDFString.of('  ') })
    const plain = square(220)
    // A markup reply in the thread, with no text of its own.
    const replying = square(250, { IRT: reply })
    const commented = [note, text, rich, withPopup, popupParent, repliedTo, replying]
    page.node.set(PDFName.of('Annots'), ctx.obj([note, text, rich, withPopup, popup, popupParent, parentsPopup, repliedTo, reply, blank, plain, replying]))
    const bytes = await doc.save({ useObjectStreams: false })
    const pages = await readPages(bytes)

    const out = await renderPdf(makeInput(bytes, pages, [box('bar', 5, 75, 290, 30, '#ff0000')]), testDeps)
    const pdf = await openPdfjs(out)
    const raster = await renderPage(pdf, 1, 2)
    for (const x of [20, 50, 80, 110, 140, 170, 200, 230, 260]) expect(near(raster.at(x, 90), [255, 0, 0]), `bar at x ${x}`).toBe(true)
    await pdf.loadingTask.destroy()

    // All baked; only the two without a comment are gone. The others draw nothing now.
    const saved = await PDFDocument.load(out)
    const annots = saved.getPage(0).node.Annots()!.asArray()
    expect(annots).toEqual([note, text, rich, withPopup, popup, popupParent, parentsPopup, repliedTo, reply, replying])
    expect(commented.map((ref) => normalContent(saved.context.lookup(ref, PDFDict)))).toEqual(commented.map(() => ''))
  })

  it('leaves an annotation alone when an element only sits next to it', async () => {
    const bytes = await annotatedPdf()
    const pages = await readPages(bytes)
    // Checkmarks just right of the note (view x 200–220, y 180–200): 0.2 pt clear of it, and 0.3 pt over its edge.
    const mark = (id: string, x: number): MarkElement => ({ id, kind: 'mark', page: 0, x, y: 183, width: 14, height: 14, shape: 'check', color: '#111827' })
    for (const el of [mark('clear', 220.2), mark('edge', 219.7)]) {
      const out = await renderPdf(makeInput(bytes, pages, [el]), testDeps)
      const annots = await pageAnnots(out)
      expect(annots).toHaveLength(6)
      expect(normalContent(annots[2]), `the note, with a mark at x ${el.x}`).not.toBe('')
    }
  })
})
