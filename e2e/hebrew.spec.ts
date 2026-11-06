import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  SAMPLE_PDF,
  clickPagePoint,
  downloadPdf,
  expectEditing,
  gotoHome,
  openPdf,
  pdfPage,
  selectTool,
  showPage,
  trackPageErrors,
  typeAndCommit,
} from './support/app'
import { pageText, readViewSizes } from './support/pdf'

/** The text item showing `text`. */
const textItem = (page: Page, text: string): Locator => page.locator('[data-element-id][data-kind="text"]', { hasText: text }).first()

/** Screen box of characters [from, to) of a line of a text item (its first by default), as the browser laid them out. */
async function charsBox(item: Locator, from: number, to: number, line = 0) {
  return item.evaluate(
    (el, [from, to, line]) => {
      const range = document.createRange()
      const text = el.querySelectorAll('div[dir="auto"]')[line].firstChild!
      range.setStart(text, from)
      range.setEnd(text, to)
      const r = range.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    },
    [from, to, line],
  )
}

/** Screen box of the page frame. */
async function pageFrame(page: Page, index: number) {
  return (await (await showPage(page, index)).boundingBox())!
}

/** Where a point of page `index` (view space) is on screen. */
async function clientX(page: Page, index: number, x: number, width: number): Promise<number> {
  const canvas = (await showPage(page, index)).locator('canvas').first()
  const box = (await canvas.boundingBox())!
  return box.x + (x / width) * box.width
}

/** Screen box of the text item showing `text`. */
async function textItemBox(page: Page, text: string) {
  const item = page.locator('[data-element-id][data-kind="text"]', { hasText: text }).first()
  await expect(item).toBeVisible()
  return (await item.boundingBox())!
}

test('Hebrew typed into a new text box grows leftwards from where it was started', async ({ page }) => {
  const errors = trackPageErrors(page)
  const sizes = await readViewSizes(SAMPLE_PDF)
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 1)

  // A Hebrew user starts at the right end of the line (where Hebrew starts) and types.
  const start = { x: 480, y: 197 }
  await selectTool(page, 'Text', 'T')
  await clickPagePoint(page, 1, start, sizes[1])
  await typeAndCommit(page, 'ישראל כהן, רחוב הרצל 12')
  const startX = await clientX(page, 1, start.x, sizes[1].width)
  const hebrew = await textItemBox(page, 'ישראל')
  // Its right edge stayed where it was started: the text grew to the left.
  expect(Math.abs(hebrew.x + hebrew.width - startX)).toBeLessThan(3)
  expect(hebrew.x).toBeLessThan(startX - 50)

  // English (and a box that starts with digits) still starts where it was clicked.
  const left = { x: 110, y: 260 }
  await selectTool(page, 'Text', 'T')
  await clickPagePoint(page, 1, left, sizes[1])
  await typeAndCommit(page, '12 Main Street')
  const english = await textItemBox(page, 'Main Street')
  expect(Math.abs(english.x - (await clientX(page, 1, left.x, sizes[1].width)))).toBeLessThan(3)

  // A double-click puts the caret where it lands in the Hebrew, not at the end of the line:
  // the right end of the line is where the text starts.
  await selectTool(page, 'Select', 'V')
  const item = page.locator('[data-element-id][data-kind="text"]', { hasText: 'ישראל' }).first()
  let box = await textItemBox(page, 'ישראל')
  await page.mouse.dblclick(box.x + box.width - 2, box.y + box.height / 2)
  await page.keyboard.type('מר ')
  await page.keyboard.press('Escape')
  await expect(item).toHaveText('מר ישראל כהן, רחוב הרצל 12')
  // …and its left end is where it ends.
  box = await textItemBox(page, 'ישראל')
  await page.mouse.dblclick(box.x + 2, box.y + box.height / 2)
  await page.keyboard.type(' א׳')
  await page.keyboard.press('Escape')
  await expect(item).toHaveText('מר ישראל כהן, רחוב הרצל 12 א׳')

  // The download has the Hebrew as real text.
  const { bytes } = await downloadPdf(page)
  const text = await pageText(bytes, 1)
  for (const word of ['ישראל', 'כהן', 'הרצל', 'Main Street']) expect(text).toContain(word)
  expect(errors).toEqual([])
})

test('Hebrew started near a page edge stays on the page, and the download has all of it', async ({ page }) => {
  const errors = trackPageErrors(page)
  const sizes = await readViewSizes(SAMPLE_PDF)
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 1)

  // Started 40pt from the left edge, the name grows leftwards to the edge, then rightwards.
  await selectTool(page, 'Text', 'T')
  await clickPagePoint(page, 1, { x: 40, y: 600 }, sizes[1])
  await typeAndCommit(page, 'חברת דוגמה בע״מ, סניף ראשי')
  // English started at the right end grows leftwards from the edge once it reaches it.
  await selectTool(page, 'Text', 'T')
  await clickPagePoint(page, 1, { x: 560, y: 650 }, sizes[1])
  await typeAndCommit(page, 'israel.cohen@example.com')

  const frame = await pageFrame(page, 1)
  for (const text of ['חברת', 'israel.cohen']) {
    const box = (await textItem(page, text).boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(frame.x - 1)
    expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width + 1)
  }

  const { bytes } = await downloadPdf(page)
  const text = await pageText(bytes, 1)
  for (const word of ['חברת', 'דוגמה', 'ראשי', 'israel.cohen@example.com']) expect(text).toContain(word)
  expect(errors).toEqual([])
})

test('a click or double-click inside Hebrew puts the caret where it lands', async ({ page }) => {
  const errors = trackPageErrors(page)
  const sizes = await readViewSizes(SAMPLE_PDF)
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 1)
  await selectTool(page, 'Text', 'T')
  await clickPagePoint(page, 1, { x: 300, y: 400 }, sizes[1])
  await typeAndCommit(page, 'ישרל כהן')
  await selectTool(page, 'Text', 'T')
  await clickPagePoint(page, 1, { x: 300, y: 450 }, sizes[1])
  await typeAndCommit(page, 'חברת דגמה בע״מ')

  // Text tool, between ר and ל (ר is to the right; its left edge is the spot): the missing א goes there.
  const name = textItem(page, 'כהן')
  let r = await charsBox(name, 2, 3)
  await selectTool(page, 'Text', 'T')
  await page.mouse.click(r.x + r.width / 4, r.y + r.height / 2)
  await expectEditing(page)
  await page.keyboard.type('א')
  await page.keyboard.press('Escape')
  await expect(name).toHaveText('ישראל כהן')

  // Select tool, double-click between ד and ג: the missing ו goes there.
  await selectTool(page, 'Select', 'V')
  const company = textItem(page, 'בע״מ')
  r = await charsBox(company, 5, 6)
  await page.mouse.dblclick(r.x + r.width / 4, r.y + r.height / 2)
  await expectEditing(page)
  await page.keyboard.type('ו')
  await page.keyboard.press('Escape')
  await expect(company).toHaveText('חברת דוגמה בע״מ')

  // An English line ending in Hebrew: a double-click between "x" and "m" of the English part.
  await selectTool(page, 'Text', 'T')
  await clickPagePoint(page, 1, { x: 100, y: 500 }, sizes[1])
  await typeAndCommit(page, 'israel.cohen@exmple.com (פרטי)')
  await selectTool(page, 'Select', 'V')
  const email = textItem(page, 'israel')
  r = await charsBox(email, 14, 15)
  await page.mouse.dblclick(r.x + (r.width * 3) / 4, r.y + r.height / 2)
  await expectEditing(page)
  await page.keyboard.type('a')
  await page.keyboard.press('Escape')
  await expect(email).toHaveText('israel.cohen@example.com (פרטי)')

  // The second line of a Hebrew block, between א and ב: the Text tool.
  await selectTool(page, 'Text', 'T')
  await clickPagePoint(page, 1, { x: 300, y: 550 }, sizes[1])
  await expectEditing(page)
  await page.keyboard.type('רחוב הרצל 12')
  await page.keyboard.press('Enter')
  await page.keyboard.type('תל אביב-יפו')
  await page.keyboard.press('Escape')
  const address = textItem(page, 'הרצל')
  r = await charsBox(address, 3, 4, 1)
  await selectTool(page, 'Text', 'T')
  await page.mouse.click(r.x + r.width / 4, r.y + r.height / 2)
  await expectEditing(page)
  await page.keyboard.type('ו')
  await page.keyboard.press('Escape')
  await expect(address).toHaveText('רחוב הרצל 12תל אוביב-יפו')

  // A letter with niqqud is one character: the caret goes beside it, never between it and its marks.
  await selectTool(page, 'Text', 'T')
  await clickPagePoint(page, 1, { x: 300, y: 600 }, sizes[1])
  await expectEditing(page)
  await page.keyboard.insertText('שָׁלוֹם עולם')
  await page.keyboard.press('Escape')
  const vowelled = textItem(page, 'עולם')
  r = await charsBox(vowelled, 0, 3)
  await selectTool(page, 'Select', 'V')
  await page.mouse.dblclick(r.x + r.width / 4, r.y + r.height / 2)
  await expectEditing(page)
  await page.keyboard.type('א')
  await page.keyboard.press('Escape')
  await expect(vowelled).toHaveText('שָׁאלוֹם עולם')
  expect(errors).toEqual([])
})

test('Align right picked before typing ends the text where it was started, and stays picked', async ({ page }) => {
  const errors = trackPageErrors(page)
  const sizes = await readViewSizes(SAMPLE_PDF)
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 1)

  await selectTool(page, 'Text', 'T')
  await clickPagePoint(page, 1, { x: 300, y: 400 }, sizes[1])
  await expectEditing(page)
  await page.getByRole('radio', { name: 'Align right' }).click()
  await expectEditing(page)
  await page.keyboard.type('כהן-לוי')
  await page.keyboard.press('Escape')
  const first = (await textItem(page, 'כהן-לוי').boundingBox())!
  expect(Math.abs(first.x + first.width - (await clientX(page, 1, 300, sizes[1].width)))).toBeLessThan(3)

  // The next new box starts right-aligned, ending where it is started.
  await selectTool(page, 'Text', 'T')
  await clickPagePoint(page, 1, { x: 300, y: 450 }, sizes[1])
  await expectEditing(page)
  await expect(page.getByRole('radio', { name: 'Align right' })).toBeChecked()
  await page.keyboard.type('054-1234567')
  await page.keyboard.press('Escape')
  const second = (await textItem(page, '054').boundingBox())!
  expect(Math.abs(second.x + second.width - (await clientX(page, 1, 300, sizes[1].width)))).toBeLessThan(3)
  expect(errors).toEqual([])
})

test('Hebrew pasted onto the page lines up on the right', async ({ page }) => {
  const errors = trackPageErrors(page)
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 1)
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.setData('text/plain', 'רחוב הרצל 12\r\nתל אביב-יפו 6100000')
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })
  const pasted = textItem(page, 'הרצל')
  await expect(pasted).toBeVisible()
  const ends = await pasted.evaluate((el) =>
    [...el.querySelectorAll('div[dir="auto"]')].map((line) => {
      const range = document.createRange()
      range.selectNodeContents(line)
      return range.getBoundingClientRect().right
    }),
  )
  expect(ends).toHaveLength(2)
  expect(Math.abs(ends[0] - ends[1])).toBeLessThan(1)
  expect(errors).toEqual([])
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

  test('a click far into a long Hebrew line puts the caret where it lands', async ({ page }) => {
    const errors = trackPageErrors(page)
    const sizes = await readViewSizes(SAMPLE_PDF)
    await gotoHome(page)
    await openPdf(page, SAMPLE_PDF)
    await showPage(page, 1)
    // Wider than the window would be at 100% (but not than the page): the click lands more
    // than 390pt into the line.
    const line = ['אבגד', ...Array<string>(15).fill('מילה')].join(' ')
    await selectTool(page, 'Text', 'T')
    await clickPagePoint(page, 1, { x: 570, y: 400 }, sizes[1])
    await expectEditing(page)
    await page.keyboard.insertText(line)
    await page.keyboard.press('Escape')

    // Between ב and ג, at the line's right end where it starts.
    const item = textItem(page, 'מילה')
    const r = await charsBox(item, 1, 2)
    const scale = (await (await pdfPage(page, 1)).boundingBox())!.width / sizes[1].width
    expect((r.x - (await item.boundingBox())!.x) / scale).toBeGreaterThan(390)
    await selectTool(page, 'Text', 'T')
    await page.mouse.click(r.x + r.width / 4, r.y + r.height / 2)
    await expectEditing(page)
    await page.keyboard.insertText('ה')
    await page.keyboard.press('Escape')
    await expect(item).toHaveText(line.replace('אבגד', 'אבהגד'))
    expect(errors).toEqual([])
  })
})
