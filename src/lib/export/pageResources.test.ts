import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { HIGHLIGHT_COLOR, HIGHLIGHT_OPACITY } from '../../model/elements'
import type { Asset, Element } from '../../model/types'
import { renderPdf } from './engine'
import { debugWrite } from './testing/debug'
import { buildPdf } from './testing/fixtures'
import { makeInput, makeText, testDeps } from './testing/helpers'
import { openPdfjs, pdfjs, readPages, renderPage, type PdfjsProxy } from './testing/pdfjs'

const XMP = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/"><pdfuaid:part>1</pdfuaid:part></rdf:Description>
</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`

/** Page 1's own content: a label tagged as a paragraph (MCID 0), and an MCID the parent tree lacks (2). */
const LABELS = '/P <</MCID 0>> BDC BT /F1 12 Tf 300 250 Td (Name) Tj ET EMC /Span /MC1 BDC BT /F1 12 Tf 300 230 Td (ID) Tj ET EMC'

/**
 * Two pages claiming PDF/UA, tagged the way Word does it, with a Document element (or `top`)
 * holding the structure. Page 1 has its labels in it, page 2 has no structure. Untagged, the
 * same pages.
 */
async function sourcePdf(tagged: boolean, { extraContent, top = 'Document' }: { extraContent?: Uint8Array; top?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await buildPdf([{ size: [400, 300], content: LABELS }, { size: [400, 300] }]))
  const { context, catalog } = doc
  const [page] = doc.getPages()
  page.node.Resources()!.set(PDFName.of('Properties'), context.obj({ MC1: { MCID: 2 } }))
  if (!tagged) return doc.save()
  const rootRef = context.nextRef()
  const docRef = context.nextRef()
  const label = context.register(context.obj({ Type: 'StructElem', S: 'P', P: docRef, Pg: page.ref, K: 0 }))
  context.assign(docRef, context.obj({ Type: 'StructElem', S: top, P: rootRef, K: [label] }))
  const parentTree = { Nums: [0, context.register(context.obj([label]))] }
  context.assign(rootRef, context.obj({ Type: 'StructTreeRoot', K: [docRef], ParentTree: parentTree, ParentTreeNextKey: 1 }))
  page.node.set(PDFName.of('StructParents'), PDFNumber.of(0))
  if (extraContent) {
    const stream = context.register(PDFRawStream.of(context.obj({ Filter: 'FlateDecode', Length: extraContent.length }), extraContent))
    page.node.set(PDFName.of('Contents'), context.obj([page.node.get(PDFName.of('Contents'))!, stream]))
  }
  catalog.set(PDFName.of('StructTreeRoot'), rootRef)
  catalog.set(PDFName.of('MarkInfo'), context.obj({ Marked: true }))
  catalog.set(PDFName.of('Metadata'), context.register(context.stream(XMP, { Type: 'Metadata', Subtype: 'XML' })))
  return doc.save()
}

// A 1×1 PNG standing in for a signature.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const ASSETS: Record<string, Asset> = { sig: { id: 'sig', mime: 'image/png', dataUrl: PNG, width: 1, height: 1 } }

/** Something of every kind on page 1 (in paint order), and a Hebrew line on page 2. */
const elements = (): Element[] => [
  makeText(0, 40, 40, 'ישראל כהן'),
  makeText(0, 40, 80, 'israel.cohen@example.com'),
  { id: 'hl', kind: 'shape', page: 0, x: 30, y: 75, width: 200, height: 20, shape: 'rect', strokeColor: null, fillColor: HIGHLIGHT_COLOR, strokeWidth: 0, opacity: HIGHLIGHT_OPACITY },
  { id: 'check', kind: 'mark', page: 0, x: 40, y: 120, width: 20, height: 20, shape: 'check', color: '#111827' },
  { id: 'sig', kind: 'image', page: 0, x: 100, y: 120, width: 60, height: 20, role: 'signature', assetId: 'sig', opacity: 1 },
  { id: 'ink', kind: 'ink', page: 0, x: 40, y: 160, width: 100, height: 40, strokes: [[0, 0, 1, 1]], color: '#1d4ed8', strokeWidth: 2 },
  makeText(1, 40, 40, 'שלום'),
]

async function exportTo(source: Uint8Array, name: string): Promise<Uint8Array> {
  const out = await renderPdf(makeInput(source, await readPages(source), elements(), { assets: ASSETS }), testDeps)
  await debugWrite(name, out)
  return out
}

const PAINTING = new Set<number>([
  pdfjs.OPS.showText,
  pdfjs.OPS.showSpacedText,
  pdfjs.OPS.nextLineShowText,
  pdfjs.OPS.nextLineSetSpacingShowText,
  pdfjs.OPS.paintImageXObject,
  pdfjs.OPS.paintInlineImageXObject,
  pdfjs.OPS.paintImageMaskXObject,
  pdfjs.OPS.paintSolidColorImageMask,
  pdfjs.OPS.shadingFill,
  pdfjs.OPS.fill,
  pdfjs.OPS.stroke,
  pdfjs.OPS.fillStroke,
])

/** Painting operators of a page outside any marked-content sequence, and the marked-content tags. */
async function markedContent(pdf: PdfjsProxy, pageNumber: number): Promise<{ untagged: number; tags: string[] }> {
  const { fnArray, argsArray } = await (await pdf.getPage(pageNumber)).getOperatorList()
  let depth = 0
  let untagged = 0
  const tags: string[] = []
  fnArray.forEach((fn, i) => {
    if (fn === pdfjs.OPS.beginMarkedContent || fn === pdfjs.OPS.beginMarkedContentProps) {
      depth++
      const tag: string | { name: string } = argsArray[i][0]
      tags.push(typeof tag === 'string' ? tag : tag.name)
    } else if (fn === pdfjs.OPS.endMarkedContent) depth--
    // Paths are painted by constructPath, whose first argument says how (endPath: not at all).
    else if (depth === 0 && (PAINTING.has(fn) || (fn === pdfjs.OPS.constructPath && argsArray[i][0] !== pdfjs.OPS.endPath))) untagged++
  })
  return { untagged, tags }
}

interface Node {
  role?: string
  alt?: string
  lang?: string
  type?: string
  id?: string
  children?: Node[]
}

/** The page's structure as pdf.js reads it (what Firefox gives assistive technology): role, text, language, MCIDs. */
async function structure(pdf: PdfjsProxy, pageNumber: number): Promise<unknown> {
  const simplify = (node: Node): unknown =>
    node.type === 'content'
      ? Number(/_mc(\d+)$/.exec(node.id!)![1])
      : { role: node.role, ...(node.alt && { alt: node.alt }), ...(node.lang && { lang: node.lang }), children: node.children?.map(simplify) }
  return simplify((await (await pdf.getPage(pageNumber)).getStructTree()) as Node)
}

function catalogOf(doc: PDFDocument) {
  const root = doc.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict)
  const xmp = new TextDecoder().decode(decodePDFRawStream(doc.catalog.lookup(PDFName.of('Metadata')) as PDFRawStream).decode())
  return { root, xmp }
}

describe('exportPdf: tagged PDFs', () => {
  it('tags what it adds, so that screen readers read it', async () => {
    const out = await exportTo(await sourcePdf(true), 'tagged.pdf')
    const pdf = await openPdfjs(out)

    // Every painting operator is in marked content: text and figures as structure, the rest as artifacts.
    expect(await markedContent(pdf, 1)).toEqual({ untagged: 0, tags: ['P', 'Span', 'Span', 'Span', 'Artifact', 'Figure', 'Figure', 'Artifact'] })
    expect(await markedContent(pdf, 2)).toEqual({ untagged: 0, tags: ['Span'] })

    // Each text or figure is an element of its own, after the page's labels, with its text or a
    // description; Hebrew says so. Their MCIDs follow every one the page already uses (0 and 2).
    expect(await structure(pdf, 1)).toEqual({
      role: 'Root',
      children: [
        {
          role: 'Document',
          children: [
            { role: 'P', children: [0] },
            { role: 'Span', alt: 'ישראל כהן', lang: 'he-IL', children: [3] },
            { role: 'Span', alt: 'israel.cohen@example.com', children: [4] },
            { role: 'Figure', alt: 'Checkmark', lang: 'en', children: [5] },
            { role: 'Figure', alt: 'Signature', lang: 'en', children: [6] },
          ],
        },
      ],
    })
    // A page without structure joins the parent tree under its next key.
    expect(await structure(pdf, 2)).toEqual({
      role: 'Root',
      children: [{ role: 'Document', children: [{ role: 'Span', alt: 'שלום', lang: 'he-IL', children: [0] }] }],
    })
    await pdf.loadingTask.destroy()

    const doc = await PDFDocument.load(out)
    const { root, xmp } = catalogOf(doc)
    expect(doc.getPage(1).node.get(PDFName.of('StructParents'))).toEqual(PDFNumber.of(1))
    expect(root.get(PDFName.of('ParentTreeNextKey'))).toEqual(PDFNumber.of(2))
    const mcids = root.lookup(PDFName.of('ParentTree'), PDFDict).lookup(PDFName.of('Nums'), PDFArray).lookup(1, PDFArray)
    const span = mcids.lookup(3, PDFDict)
    expect(span.lookup(PDFName.of('ActualText'), PDFHexString).decodeText()).toBe('ישראל כהן')
    expect(span.get(PDFName.of('Pg'))).toBe(doc.getPage(0).ref)
    expect(xmp).toContain('<pdfuaid:part>1</pdfuaid:part>')
  })

  it('draws the same as without tags', async () => {
    const tagged = await openPdfjs(await exportTo(await sourcePdf(true), 'tagged-render.pdf'))
    const plain = await openPdfjs(await exportTo(await sourcePdf(false), 'untagged-render.pdf'))
    for (const n of [1, 2]) {
      const a = (await renderPage(tagged, n, 2)).data
      const b = (await renderPage(plain, n, 2)).data
      let differ = 0
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differ++
      expect(a.length).toBe(b.length)
      expect(differ, `page ${n}`).toBe(0)
    }
    await tagged.loadingTask.destroy()
    await plain.loadingTask.destroy()
  })

  it('leaves untagged PDFs untagged', async () => {
    const out = await exportTo(await sourcePdf(false), 'untagged.pdf')
    const pdf = await openPdfjs(out)
    // Only the page's own marked content.
    expect((await markedContent(pdf, 1)).tags).toEqual(['P', 'Span'])
    expect((await markedContent(pdf, 2)).tags).toEqual([])
    await pdf.loadingTask.destroy()
    expect((await PDFDocument.load(out)).catalog.has(PDFName.of('StructTreeRoot'))).toBe(false)
  })

  it('adds its elements at the root when no Document element holds the structure', async () => {
    const pdf = await openPdfjs(await exportTo(await sourcePdf(true, { top: 'Sect' }), 'tagged-sections.pdf'))
    expect(await structure(pdf, 2)).toEqual({ role: 'Root', children: [{ role: 'Span', alt: 'שלום', lang: 'he-IL', children: [0] }] })
    await pdf.loadingTask.destroy()
  })

  it('stops claiming PDF/UA when the structure of a page cannot be read', async () => {
    // A content stream that can't be decoded hides which MCIDs the page uses.
    const out = await exportTo(await sourcePdf(true, { extraContent: new Uint8Array([1, 2, 3, 4]) }), 'tagged-broken.pdf')
    const doc = await PDFDocument.load(out)
    const { root, xmp } = catalogOf(doc)
    expect(xmp).not.toContain('pdfuaid:part')
    expect(xmp).toContain('xmpmeta')
    // Page 1 is left as it was; page 2 is tagged.
    const document = root.lookup(PDFName.of('K'), PDFArray).lookup(0, PDFDict)
    expect(document.lookup(PDFName.of('K'), PDFArray).asArray().map((ref) => doc.context.lookup(ref, PDFDict).get(PDFName.of('S'))?.toString())).toEqual(['/P', '/Span'])
  })
})
