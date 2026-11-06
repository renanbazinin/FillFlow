import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  beginText,
  decodePDFRawStream,
  endText,
  setFontAndSize,
  setTextMatrix,
  showText,
} from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import type { TextElement } from '../../model/types'
import { visualOrder } from '../pdf/forms/bidi'
import { layoutTextBlock } from '../text/layout'
import { renderPdf } from './engine'
import { encodeTyped, SubsetFont } from './subsetFont'
import { debugWrite } from './testing/debug'
import { buildPdf } from './testing/fixtures'
import { fontkitMeasurer, testFont, testFontBytes } from './testing/fonts'
import { makeInput, makeText, testDeps } from './testing/helpers'
import { openPdfjs, pdfjs, readPages, renderPage, type PdfjsProxy } from './testing/pdfjs'
import type { ExportDeps } from './types'

type Case = [text: string, style?: Partial<TextElement>]

const FONTS = [
  { fontId: 'sans', bold: false },
  { fontId: 'sans', bold: true },
  { fontId: 'serif', bold: false },
  { fontId: 'serif', bold: true },
  { fontId: 'mono', bold: false },
  { fontId: 'mono', bold: true },
] as const

/** Exports each text on a page of its own. */
async function exportTexts(cases: Case[], name: string, deps: ExportDeps = testDeps): Promise<Uint8Array> {
  const bytes = await buildPdf(cases.map(() => ({ size: [500, 120] })))
  const pages = await readPages(bytes)
  const elements = cases.map(([text, style], i) => makeText(i, 30, 30, text, { fontSize: 18, ...style }))
  const out = await renderPdf(makeInput(bytes, pages, elements), deps)
  await debugWrite(name, out)
  return out
}

/** The text of a page as pdf.js gives it (what Firefox's viewer copies and finds). */
async function pageText(pdf: PdfjsProxy, pageNumber: number): Promise<string> {
  const { items } = await (await pdf.getPage(pageNumber)).getTextContent()
  return items
    .map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : '') : ''))
    .join('')
    .trim()
}

/** Exports the cases and checks that each copies exactly as typed (or as `copied` gives it). */
async function expectCopiedAsTyped(cases: Case[], name: string, copied = (text: string) => text) {
  const pdf = await openPdfjs(await exportTexts(cases, name))
  for (let i = 0; i < cases.length; i++) {
    const [text, style] = cases[i]
    expect(await pageText(pdf, i + 1), `${text} ${JSON.stringify(style ?? {})}`).toBe(copied(text))
  }
  await pdf.loadingTask.destroy()
}

describe('exportPdf: copying text out', () => {
  it('copies pointed Hebrew exactly as typed, in every font', async () => {
    const words = ['שָׁלוֹם', 'דָּוִד כֹּהֵן', 'בְּרֵאשִׁית בָּרָא', 'יִשְׂרָאֵל שׁוּשַׁן', 'שָׁלוֹם — גרש׳ וגרשיים ״']
    const cases: Case[] = FONTS.flatMap((font) => words.map((w): Case => [w, font]))
    // Points typed in another order come out in that order.
    cases.push(['שָׁלוֹם'], ['שָׁלוֹם 12', { fontId: 'mono', letterSpacing: 2 }])
    await expectCopiedAsTyped(cases, 'copy-niqqud.pdf')
  })

  it('copies brackets in right-to-left text the way they were typed', async () => {
    await expectCopiedAsTyped(
      [
        ['(שלום)'],
        ['טלפון נייד חדש: 054-1234567 (לא חובה)'],
        ['רחוב הרצל (דירה 4, קומה 2)'],
        ['הערה (1): ראו סעיף 5(א).', { fontId: 'serif' }],
        ['israel.cohen@example.com (work)'],
      ],
      'copy-brackets.pdf',
    )
  })

  it('copies Hebrew in Mono, and letter-spaced Hebrew, in reading order', async () => {
    await expectCopiedAsTyped(
      [
        ['שינוי שכר: ₪1,234.50 לחודש, 50% משרה', { fontId: 'mono', fontSize: 10 }],
        ['בדיקה 123', { fontId: 'mono', bold: true }],
        ['רחוב הרצל 12\nתל אביב-יפו', { fontId: 'mono', fontSize: 12 }],
        ['רחוב הרצל (12)', { fontSize: 14, letterSpacing: 3 }],
        ['ישראל', { fontSize: 12, letterSpacing: 10 }],
        ['ישראל כהן, רחוב הרצל 12', { fontSize: 12, letterSpacing: 7.5 }],
        ['ישראל כהן, רחוב הרצל 12', { fontId: 'serif', fontSize: 12, letterSpacing: 2.5 }],
      ],
      'copy-spaced-hebrew.pdf',
    )
  })

  it('copies a word that ends in a pointed letter whole, before another word', async () => {
    // pdf.js put a space on either side of the last point: "מֶלֶך ְ דָּוִד".
    const words = ['מֶלֶךְ דָּוִד', 'לְךָ שָׁלוֹם', 'רוּחַ טוֹבָה', 'אַתְּ יָפָה']
    const cases: Case[] = FONTS.flatMap((font) => words.map((w): Case => [w, font]))
    cases.push(
      ['מֶלֶךְ דָּוִד', { letterSpacing: 3 }],
      ['מֶלֶךְ דָּוִד', { fontId: 'mono', letterSpacing: 4 }],
      ['מֶלֶךְ  דָּוִד', { fontId: 'mono' }],
      ['שָׁלוֹם לְךָ מֶלֶךְ'],
      ['לְךָ (שָׁלוֹם)'],
      ['אֵלֶיךָ הַיּוֹם\nמֶלֶךְ דָּוִד', { fontId: 'serif' }],
      ['מֶלֶךְ 12'],
    )
    await expectCopiedAsTyped(cases, 'copy-pointed-word-end.pdf')
  })

  it('copies lines with runs of spaces in reading order, a space for each run', async () => {
    // pdf.js reads a gap between words as a space only within 0.1–0.6 em; past that it splits the
    // line, and a right-to-left one comes out word by word in reverse.
    await expectCopiedAsTyped(
      [
        ['ישראל  כהן', { fontId: 'mono' }],
        ['ישראל   כהן'],
        ['שם:      ישראל', { fontId: 'serif' }],
        ['ישראל    כהן', { fontId: 'serif', bold: true }],
        ['ישראל    כהן', { fontId: 'mono' }],
        ['שם:    ישראל כהן', { fontId: 'mono' }],
        ['ישראל  כהן', { letterSpacing: 3 }],
        ['שם:  ישראל\nעיר:  חיפה', { fontId: 'mono', bold: true }],
      ],
      'copy-space-runs.pdf',
      (text) => text.replace(/ +/g, ' '),
    )
  })

  it('copies Hebrew presentation forms as their letter and points, without changing how later downloads copy', async () => {
    // Downloads in a tab share parsed fonts, and fontkit keeps one glyph object per glyph with the
    // characters of its first use: after שׁ typed as one character (U+FB2A), the same glyph drawn
    // for ש and its dot stood for that, which pdf.js spells out before reordering ("ׁשָלוֹם").
    const own = new Map<string, Uint8Array>()
    const deps: ExportDeps = {
      ...testDeps,
      loadFontBytes: async (fontId, bold) => {
        const key = `${fontId}:${bold}`
        if (!own.has(key)) own.set(key, (await testDeps.loadFontBytes(fontId, bold)).slice())
        return own.get(key)!
      },
    }
    const [shin, vav, shinDagesh] = [0xfb2a, 0xfb4b, 0xfb2c].map((cp) => String.fromCodePoint(cp))
    const forms = `${shin}לום ${vav}ת ${shinDagesh}מש`
    const first = await openPdfjs(await exportTexts(FONTS.map((font): Case => [forms, font]), 'copy-presentation-forms.pdf', deps))
    for (let n = 1; n <= FONTS.length; n++) expect(await pageText(first, n)).toBe(forms.normalize('NFD'))
    await first.loadingTask.destroy()
    const later = await openPdfjs(await exportTexts(FONTS.map((font): Case => ['שָׁלוֹם עולם', font]), 'copy-after-presentation-forms.pdf', deps))
    for (let n = 1; n <= FONTS.length; n++) expect(await pageText(later, n)).toBe('שָׁלוֹם עולם')
    await later.loadingTask.destroy()
  })

  it('copies letter-spaced digits without spaces between them', async () => {
    await expectCopiedAsTyped(
      [
        ['123456782', { fontSize: 12, letterSpacing: 4.5 }],
        ['01051990', { fontSize: 12, letterSpacing: 4.5, fontId: 'mono' }],
        ['01/05/1990', { fontSize: 12, letterSpacing: 3, fontId: 'serif' }],
        ['Hello world', { fontSize: 12, letterSpacing: 4.5 }],
      ],
      'copy-spaced-digits.pdf',
    )
  })

  it('draws every character with a glyph of its own and places glyphs without moving between them', async () => {
    // Other extractors (Chrome's PDFium, poppler, xpdf) read a move between glyphs as a gap
    // between words, and split a glyph that stands for several characters in their own way.
    const out = await exportTexts(
      [['שָׁלוֹם דָּוִד'], ['בְּרֵאשִׁית', { fontId: 'serif' }], ['123456782', { fontSize: 12, letterSpacing: 4.5 }], ['ישראל', { letterSpacing: 10 }], ['éte']],
      'copy-structure.pdf',
    )
    const doc = await PDFDocument.load(out)
    const maps = doc.context
      .enumerateIndirectObjects()
      .map(([, obj]) => obj)
      .filter((obj): obj is PDFDict => obj instanceof PDFDict && obj.get(PDFName.of('Subtype')) === PDFName.of('Type0'))
      .map((font) => new TextDecoder().decode(decodePDFRawStream(doc.context.lookup(font.get(PDFName.of('ToUnicode'))) as PDFRawStream).decode()))
    expect(maps.length).toBeGreaterThan(0)
    for (const map of maps) {
      for (const [, unicode] of map.matchAll(/^<[0-9a-f]{4}> <([0-9a-f]+)>$/gm)) {
        expect(String.fromCharCode(...unicode.match(/.{4}/g)!.map((h) => parseInt(h, 16))), map).toMatch(/^.$/u)
      }
    }
    const pdf = await openPdfjs(out)
    for (let n = 1; n <= pdf.numPages; n++) {
      const { fnArray } = await (await pdf.getPage(n)).getOperatorList()
      for (const op of [pdfjs.OPS.showSpacedText, pdfjs.OPS.setTextRise, pdfjs.OPS.setCharSpacing, pdfjs.OPS.setWordSpacing]) {
        expect(fnArray, `page ${n}`).not.toContain(op)
      }
    }
    await pdf.loadingTask.destroy()
  })
})

describe('exportPdf: Hebrew points', () => {
  it('draws a point where the editor does, whatever the letter before it', async () => {
    // The tsere under ר of רֵא, alone and after a pointed letter (בְרֵא): left-aligned, both lines
    // start with א and ר on the left, which must come out the same.
    for (const style of [{ fontId: 'serif' }, { fontId: 'serif', bold: true }, { fontId: 'mono' }] as const) {
      const bytes = await buildPdf([{ size: [400, 300] }])
      const pages = await readPages(bytes)
      const alone = makeText(0, 40, 40, 'רֵא', { fontSize: 60, ...style })
      const after = makeText(0, 40, 160, 'בְרֵא', { fontSize: 60, ...style })
      const out = await renderPdf(makeInput(bytes, pages, [alone, after]), testDeps)
      const pdf = await openPdfjs(out)
      const raster = await renderPage(pdf, 1, 2)
      await pdf.loadingTask.destroy()
      // Up to just before the ב of the second line.
      const width = layoutTextBlock('רֵא', alone, 'left', fontkitMeasurer).width - 5
      const ink = (top: number) => {
        const rows: string[] = []
        for (let y = top; y < top + 100; y += 0.5) {
          let row = ''
          for (let x = 30; x < 40 + width; x += 0.5) row += raster.at(x, y)[0] < 128 ? '#' : '.'
          rows.push(row)
        }
        return rows.join('\n')
      }
      expect(ink(after.y), style.fontId + (style.bold ? ' bold' : '')).toBe(ink(alone.y))
    }
  })
})

describe('encodeTyped: lines of form field values', () => {
  it('encodes a line it cannot line up with what was typed one character at a time, in the order shown', async () => {
    const doc = await PDFDocument.create()
    const font = new SubsetFont(doc, testFont('sans', false), testFontBytes('sans', false), { serif: false, fixedPitch: false }).asPdfLibFont()
    // "שלום עולם" in visual order, as field appearances draw it. fontkit would shape it as a whole,
    // right to left, and draw it backwards.
    const shown = 'םלוע םולש'
    const each = [...shown].map((ch) => font.encodeText(ch).asString()).join('')
    expect(encodeTyped(font, shown, 'שלום').asString()).toBe(each)
    expect(encodeTyped(font, shown, 'שלום עולם').asString()).toHaveLength(each.length)
  })

  it('copies a word that ends in a pointed letter whole, drawn the same', async () => {
    const doc = await PDFDocument.create()
    const subset = new SubsetFont(doc, testFont('sans', false), testFontBytes('sans', false), { serif: false, fixedPitch: false })
    const font = subset.asPdfLibFont()
    const text = 'מֶלֶךְ דָּוִד'
    const { shown, typed } = visualOrder(text)
    // And one character at a time, as field appearances drew it before.
    for (const hex of [encodeTyped(font, shown, typed).asString(), [...shown].map((ch) => font.encodeText(ch).asString()).join('')]) {
      const page = doc.addPage([300, 100])
      const name = page.node.newFontDictionary('F', subset.ref)
      page.pushOperators(beginText(), setFontAndSize(name, 30), setTextMatrix(1, 0, 0, 1, 20, 40), showText(PDFHexString.of(hex)), endText())
    }
    subset.finalize()
    const pdf = await openPdfjs(await doc.save())
    expect(await pageText(pdf, 1)).toBe(text)
    // The same pixels, but where the edges of a point and its letter overlap: drawn the other way
    // round, they blend a shade differently.
    const [a, b] = [(await renderPage(pdf, 1, 2)).data, (await renderPage(pdf, 2, 2)).data]
    let most = 0
    for (let i = 0; i < a.length; i++) most = Math.max(most, Math.abs(a[i] - b[i]))
    expect(most).toBeLessThan(10)
    await pdf.loadingTask.destroy()
  })
})
