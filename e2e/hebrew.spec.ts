import { expect, test, type Page } from '@playwright/test'
import {
  SAMPLE_PDF,
  clickPagePoint,
  downloadPdf,
  gotoHome,
  openPdf,
  selectTool,
  showPage,
  trackPageErrors,
  typeAndCommit,
} from './support/app'
import { pageText, readViewSizes } from './support/pdf'

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
