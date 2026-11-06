import { readFile, writeFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { PDFDocument, PDFName } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { SAMPLE_PDF, clickPagePoint, downloadPdf, gotoHome, openPdf, selectTool, showPage, trackPageErrors, typeAndCommit, type Point } from './support/app'
import { readPageText, readViewSizes, withPdf, type ViewSize } from './support/pdf'

/**
 * Regression tests for the text inside downloads: what copying it, or searching for it, gives in
 * PDF viewers, and what screen readers get from a tagged PDF, checked with pdf.js (Firefox's viewer).
 */

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Item options' })

/** Places a text item on page 2 of the sample form and types `text` into it. */
async function addText(page: Page, at: Point, size: ViewSize, text: string): Promise<void> {
  await selectTool(page, 'Text', 'T')
  await clickPagePoint(page, 1, at, size)
  await typeAndCommit(page, text)
}

async function setFont(page: Page, font: 'Sans' | 'Serif' | 'Mono'): Promise<void> {
  await toolbar(page).getByRole('radiogroup', { name: 'Font' }).getByRole('radio', { name: `${font} font` }).click()
}

async function setFontSize(page: Page, points: number): Promise<void> {
  const field = page.getByRole('group', { name: 'Font size' }).getByRole('textbox')
  await field.fill(String(points))
  await field.press('Enter')
}

async function setLetterSpacing(page: Page, points: number): Promise<void> {
  await toolbar(page).getByRole('button', { name: 'Alignment and spacing' }).click()
  const slider = page.getByRole('dialog', { name: 'Alignment and spacing' }).getByRole('slider', { name: 'Letter spacing' })
  await slider.focus()
  for (let i = 0; i < points / 0.5; i++) await page.keyboard.press('ArrowRight')
  await expect(slider).toHaveAttribute('aria-valuenow', String(points))
  await page.keyboard.press('Escape')
}

/** The lines of a page as copied out of it: pdf.js text runs on the same baseline, in order. */
async function copiedLines(bytes: Uint8Array, pageIndex: number): Promise<string[]> {
  const lines: { y: number; text: string }[] = []
  for (const item of await readPageText(bytes, pageIndex)) {
    const line = lines.find((l) => Math.abs(l.y - item.y) < 1)
    if (line) line.text += item.str
    else lines.push({ y: item.y, text: item.str })
  }
  return lines.map((l) => l.text.trim())
}

test('the download copies as typed: pointed Hebrew, brackets, Mono and letter-spaced text', async ({ page }) => {
  const errors = trackPageErrors(page)
  const sizes = await readViewSizes(SAMPLE_PDF)
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 1)

  const typed = {
    pointed: 'שָׁלוֹם — דָּוִד כֹּהֵן',
    serif: 'בְּרֵאשִׁית בָּרָא',
    brackets: 'טלפון נייד חדש: 054-1234567 (לא חובה)',
    mono: 'שינוי שכר: ₪1,234.50 לחודש, 50% משרה',
    id: '123456782',
    name: 'ישראל כהן',
  }
  await addText(page, { x: 400, y: 140 }, sizes[1], typed.pointed)
  await addText(page, { x: 520, y: 265 }, sizes[1], typed.serif)
  await setFont(page, 'Serif')
  await addText(page, { x: 520, y: 440 }, sizes[1], typed.brackets)
  await addText(page, { x: 520, y: 575 }, sizes[1], typed.mono)
  await setFont(page, 'Mono')
  // An ID number spaced out into the boxes of a form, and a spaced name.
  await addText(page, { x: 100, y: 630 }, sizes[1], typed.id)
  await setLetterSpacing(page, 4.5)
  await addText(page, { x: 520, y: 740 }, sizes[1], typed.name)
  await setLetterSpacing(page, 10)

  const { bytes } = await downloadPdf(page)
  const lines = await copiedLines(bytes, 1)
  for (const text of Object.values(typed)) expect(lines).toContain(text)
  expect(errors).toEqual([])
})

test('a later download copies as typed after one with Hebrew presentation forms, and so do words ending in a pointed letter and runs of spaces', async ({
  page,
}) => {
  const errors = trackPageErrors(page)
  const sizes = await readViewSizes(SAMPLE_PDF)
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 1)
  // שׁ and וֹ typed as one character each (U+FB2A, U+FB4B), as text copied out of some PDFs is.
  // Downloads in a tab share their fonts: these used to make later ones copy "ׁשָלוֹם".
  const forms = `${String.fromCodePoint(0xfb2a)}לום ${String.fromCodePoint(0xfb4b)}ת`
  await addText(page, { x: 400, y: 140 }, sizes[1], forms)
  const first = await downloadPdf(page)
  expect(await copiedLines(first.bytes, 1)).toContain(forms.normalize('NFD'))

  const pointed = 'שָׁלוֹם עולם — מֶלֶךְ דָּוִד'
  await addText(page, { x: 520, y: 265 }, sizes[1], pointed)
  await addText(page, { x: 520, y: 440 }, sizes[1], 'שם:  ישראל כהן')
  await setFont(page, 'Mono')

  const { bytes } = await downloadPdf(page)
  const lines = await copiedLines(bytes, 1)
  expect(lines).toContain(pointed)
  // In reading order (pdf.js reads a run of spaces as one).
  expect(lines).toContain('שם: ישראל כהן')
  expect(errors).toEqual([])
})

test('a text box with a character the fonts lack keeps all of its text copyable', async ({ page }) => {
  const errors = trackPageErrors(page)
  const sizes = await readViewSizes(SAMPLE_PDF)
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 1)
  // "✓" (often pasted, or from a phone keyboard) is in none of the fonts: that line is drawn as
  // the browser shows it, a picture, with its text kept over it; the line below stays text.
  await addText(page, { x: 520, y: 140 }, sizes[1], '✓ כן (אושר)\nרחוב הרצל 12')

  const { bytes } = await downloadPdf(page)
  const lines = await copiedLines(bytes, 1)
  expect(lines).toContain('✓ כן (אושר)')
  expect(lines).toContain('רחוב הרצל 12')
  const ops = (src: Uint8Array | string) => withPdf(src, async (pdf) => (await pdf.getPage(2)).getOperatorList())
  const images = (fnArray: number[]) => fnArray.filter((fn) => fn === pdfjs.OPS.paintImageXObject).length
  const { fnArray, argsArray } = await ops(bytes)
  expect(images(fnArray)).toBe(images((await ops(SAMPLE_PDF)).fnArray) + 1)
  // The text over the picture is invisible (rendering mode 3), and the next line visible again.
  const modes = fnArray.flatMap((fn, i) => (fn === pdfjs.OPS.setTextRenderingMode ? [argsArray[i][0]] : []))
  expect(modes).toEqual([3, 0])
  expect(errors).toEqual([])
})

interface StructNode {
  role?: string
  alt?: string
  lang?: string
  type?: string
  children?: StructNode[]
}

test('in a tagged (accessible) PDF, the items added are tagged too, so screen readers read them', async ({ page }) => {
  const errors = trackPageErrors(page)
  // The sample form with a logical structure (still empty), as an accessible PDF has.
  const doc = await PDFDocument.load(await readFile(SAMPLE_PDF))
  const { context } = doc
  const root = context.nextRef()
  const document = context.register(context.obj({ Type: 'StructElem', S: 'Document', P: root, K: [] }))
  context.assign(root, context.obj({ Type: 'StructTreeRoot', K: [document], ParentTree: { Nums: [] }, ParentTreeNextKey: 0 }))
  doc.catalog.set(PDFName.of('StructTreeRoot'), root)
  doc.catalog.set(PDFName.of('MarkInfo'), context.obj({ Marked: true }))
  const file = test.info().outputPath('accessible-form.pdf')
  await writeFile(file, await doc.save())

  const sizes = await readViewSizes(file)
  await gotoHome(page)
  await openPdf(page, file)
  await showPage(page, 1)
  await addText(page, { x: 400, y: 140 }, sizes[1], 'ישראל כהן')
  await selectTool(page, 'Checkmark', 'C')
  await clickPagePoint(page, 1, { x: 300, y: 400 }, sizes[1])

  const { bytes } = await downloadPdf(page)
  const tree = await withPdf(bytes, async (pdf) => (await pdf.getPage(2)).getStructTree())
  const simplify = (node: StructNode): unknown =>
    node.type ? node.type : { role: node.role, alt: node.alt, lang: node.lang, children: node.children?.map(simplify) }
  expect(simplify(tree as StructNode)).toEqual({
    role: 'Root',
    children: [
      {
        role: 'Document',
        children: [
          { role: 'Span', alt: 'ישראל כהן', lang: 'he-IL', children: ['content'] },
          { role: 'Figure', alt: 'Checkmark', lang: 'en', children: ['content'] },
        ],
      },
    ],
  })
  expect(errors).toEqual([])
})

test('in Serif, a point sits on its letter in the download whether or not the letter before it is pointed', async ({ page }) => {
  const errors = trackPageErrors(page)
  const sizes = await readViewSizes(SAMPLE_PDF)
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 1)
  for (const [text, y] of [
    ['רֵא', 130],
    ['בְרֵא', 710],
  ] as const) {
    await addText(page, { x: 330, y }, sizes[1], text)
    await setFont(page, 'Serif')
    await setFontSize(page, 40)
  }

  const { bytes } = await downloadPdf(page)
  const items = await readPageText(bytes, 1)
  const alone = items.find((it) => it.str === 'רֵא')!
  const after = items.find((it) => it.str === 'בְרֵא')!
  const scale = 4
  const raster = await withPdf(bytes, async (pdf) => {
    const p = await pdf.getPage(2)
    const viewport = p.getViewport({ scale })
    const factory = (pdf as unknown as { canvasFactory: { create(w: number, h: number): { canvas: unknown; context: CanvasRenderingContext2D } } }).canvasFactory
    const { canvas, context } = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height))
    await p.render({ canvas: canvas as HTMLCanvasElement, canvasContext: context, viewport, background: 'white' }).promise
    return { data: context.getImageData(0, 0, Math.ceil(viewport.width), Math.ceil(viewport.height)).data, width: Math.ceil(viewport.width) }
  })
  const dark = (x: number, y: number) => raster.data[(Math.floor(y * scale) * raster.width + Math.floor(x * scale)) * 4] < 128
  const columns = (line: { x: number; y: number }) => {
    const xs: number[] = []
    for (let x = line.x - 5; x < line.x + 90; x += 0.25) {
      for (let y = line.y - 30; y < line.y; y += 0.25) if (dark(x, y) && xs.at(-1) !== x) xs.push(x)
    }
    return xs
  }
  /** Middle of the ink below the baseline (the tsere) within `width` of the line's left edge. */
  const tsere = (line: { x: number; y: number }, width: number) => {
    const left = columns(line)[0]
    let sum = 0
    let n = 0
    for (let x = left; x < left + width; x += 0.25) {
      for (let y = line.y + 2; y < line.y + 16; y += 0.25) {
        if (dark(x, y)) {
          sum += x - left
          n++
        }
      }
    }
    return { at: sum / n, n }
  }
  // Both lines start with א and ר on the left: רֵא alone gives their width.
  const ink = columns(alone)
  const width = ink.at(-1)! - ink[0] - 2
  const a = tsere(alone, width)
  const b = tsere(after, width)
  expect(a.n).toBeGreaterThan(20)
  expect(Math.abs(a.at - b.at)).toBeLessThan(0.5)
  expect(errors).toEqual([])
})
