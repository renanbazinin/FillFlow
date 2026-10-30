import { PDFArray, PDFContentStream, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { protectOriginalContent, scanContentStream } from './contentBalance'

const scan = (src: string | Uint8Array) => scanContentStream(typeof src === 'string' ? new TextEncoder().encode(src) : src)

describe('scanContentStream', () => {
  it('counts unclosed q and open text objects', () => {
    expect(scan('q 1 0 0 1 5 5 cm q 0 0 m 10 10 l S Q')).toEqual({ depth: 1, inText: false, underflow: false })
    expect(scan('BT /F1 12 Tf (hi) Tj')).toEqual({ depth: 0, inText: true, underflow: false })
    expect(scan('q Q Q')).toEqual({ depth: 0, inText: false, underflow: true })
  })

  it('ignores operators hidden in strings, names, comments and dictionaries', () => {
    expect(scan('(q q \\) q) Tj <71> Tj /q gs % q q q\n[(Q) 3 (q)] TJ <</Q 1>> BDC EMC')).toEqual({
      depth: 0,
      inText: false,
      underflow: false,
    })
    expect(scan('(nested (q (q)) parens Q) Tj q')).toMatchObject({ depth: 1 })
  })

  it('treats run-together tokens correctly', () => {
    // "q" glued to delimiters still counts; "qq" is not an operator.
    expect(scan('q[1 2]0 d q/GS1 gs qq')).toMatchObject({ depth: 2 })
  })

  it('skips binary inline image data', () => {
    const head = new TextEncoder().encode('q BI /W 2 /H 2 /BPC 8 /CS /G ID ')
    const data = new Uint8Array([0x51, 0x20, 0x71, 0x20, 0x51, 0x0a]) // "Q q Q\n" as pixel bytes
    const tail = new TextEncoder().encode(' EI Q q')
    const all = new Uint8Array([...head, ...data, ...tail])
    expect(scan(all)).toMatchObject({ depth: 1, underflow: false })
  })

  it('continues across the streams of one page', () => {
    const first = scan('q 2 0 0 2 0 0 cm BT')
    expect(scanContentStream(new TextEncoder().encode('ET Q q'), first)).toEqual({ depth: 1, inText: false, underflow: false })
  })
})

describe('protectOriginalContent', () => {
  async function pageWith(content: string) {
    const doc = await PDFDocument.create()
    const page = doc.addPage([200, 200])
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(content)))
    const loaded = await PDFDocument.load(await doc.save())
    return { doc: loaded, page: loaded.getPage(0) }
  }

  function contentOf(doc: PDFDocument, contents: PDFArray): string[] {
    return contents.asArray().map((ref) => {
      const s = doc.context.lookup(ref)
      const bytes = s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : (s as PDFContentStream).getUnencodedContents()
      return new TextDecoder().decode(bytes).trim()
    })
  }

  it('closes what the original content leaves open, before the wrapper restore', async () => {
    const { doc, page } = await pageWith('q 3 0 0 3 0 0 cm q BT /F1 9 Tf (x) Tj')
    const result = protectOriginalContent(doc, page)
    expect(result).toEqual({ depth: 2, inText: true, underflow: false })
    const parts = contentOf(doc, page.node.Contents() as PDFArray)
    expect(parts[0]).toBe('q')
    expect(parts[2].replace(/\s+/g, ' ')).toBe('ET Q Q')
    expect(parts[3]).toBe('Q')
  })

  it('leaves balanced content with just the wrapper', async () => {
    const { doc, page } = await pageWith('q 2 0 0 2 0 0 cm Q 0 0 m 5 5 l S')
    protectOriginalContent(doc, page)
    expect(contentOf(doc, page.node.Contents() as PDFArray)).toHaveLength(3)
  })
})
