import { writeFile } from 'node:fs/promises'
import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { SAMPLE_PDF, clickPagePoint, expectEditing, fillFormField, expectFormFieldValue, gotoHome, openPdf, pdfPage, selectTool, showPage, trackPageErrors } from './support/app'
import { readViewSizes } from './support/pdf'

/**
 * Regression tests for placing, selecting and editing items: text editing sessions, selection
 * handles, the items clipboard, keyboard handling and the Items panel.
 */

/** More pages than are always kept mounted (large documents mount page layers near the viewport only). */
const LONG_PAGES = 70
const LETTER = { width: 612, height: 792 }

/** A long document with a text field "far" on page 12. */
async function longPdf(path: string): Promise<string> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const form = doc.getForm()
  for (let i = 0; i < LONG_PAGES; i++) {
    const page = doc.addPage([LETTER.width, LETTER.height])
    page.drawText(`Page ${i + 1}`, { x: 50, y: 740, size: 24, font })
    if (i === 11) form.createTextField('far').addToPage(page, { x: 72, y: 600, width: 300, height: 24 })
  }
  await writeFile(path, await doc.save())
  return path
}

/**
 * Opens the sample form and waits until the view has settled: on wide windows the form panel
 * opens next to the pages and the zoom re-fits, which would move the pages under a click.
 */
async function openSample(page: Page): Promise<void> {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  const sheet = await showPage(page, 1)
  let last = ''
  await expect
    .poll(async () => {
      const box = await sheet.boundingBox()
      const now = box ? `${Math.round(box.x)},${Math.round(box.width)}` : ''
      const same = now === last
      last = now
      return same
    }, { intervals: [250] })
    .toBe(true)
}

/** Wheel-scrolls the document until page `index` (0-based) reaches the upper part of the window. */
async function wheelToPage(page: Page, index: number): Promise<void> {
  const target = await pdfPage(page, index)
  await page.mouse.move(720, 450)
  for (let i = 0; i < 200; i++) {
    const box = await target.boundingBox()
    if (box && box.y < 300) break
    await page.mouse.wheel(0, Math.min(3000, (box?.y ?? 3000) - 200))
    await page.waitForTimeout(30)
  }
}

/** Page 1's element layer (where its items and their editor live). */
const firstPageLayer = (page: Page): Locator => page.locator('[data-element-layer="0"]')
const textEditor = (page: Page): Locator => page.locator('textarea[aria-label="Edit text"]')

/** The Items list of the right-hand panel, opened (on its Items tab when there's a form). */
async function itemsList(page: Page): Promise<Locator> {
  const list = page.locator('[data-items-panel]')
  const tab = page.getByRole('tab', { name: /Items/ })
  if (!(await tab.isVisible()) && !(await list.isVisible())) {
    await page.getByRole('button', { name: /^(Form & items|Items)$/ }).filter({ visible: true }).first().click()
  }
  if (await tab.count()) await tab.click()
  return list
}

/** Center of a placed item on screen. */
async function centerOf(item: Locator): Promise<{ x: number; y: number }> {
  const box = await item.boundingBox()
  if (!box) throw new Error('The item is not visible')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** A one-finger drag (touch events go through the browser's own input pipeline, so it may scroll). */
async function touchDrag(cdp: CDPSession, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
  for (let i = 1; i <= 12; i++) {
    const t = i / 12
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

/** Dispatches a paste of text and/or a small PNG, as if copied in another app. */
async function paste(page: Page, data: { text?: string; image?: boolean }): Promise<void> {
  await page.evaluate(async ({ text, image }) => {
    const dt = new DataTransfer()
    if (text !== undefined) dt.setData('text/plain', text)
    if (image) {
      const canvas = document.createElement('canvas')
      canvas.width = 40
      canvas.height = 20
      canvas.getContext('2d')?.fillRect(0, 0, 40, 20)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (blob) dt.items.add(new File([blob], 'screenshot.png', { type: 'image/png' }))
    }
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, data)
}

const placedKinds = (page: Page) => page.locator('[data-element-id]').evaluateAll((els) => els.map((el) => el.getAttribute('data-kind')))

test.describe('a long document', () => {
  test('scrolling a new text box out of reach ends its edit, without undoing later work', async ({ page }, testInfo) => {
    const errors = trackPageErrors(page)
    await gotoHome(page)
    await openPdf(page, await longPdf(testInfo.outputPath('long.pdf')))
    await showPage(page, 0)

    await selectTool(page, 'Text', 'T')
    await clickPagePoint(page, 0, { x: 300, y: 300 }, LETTER)
    await expectEditing(page)
    await wheelToPage(page, 11)
    await expect(firstPageLayer(page)).toHaveCount(0)
    // The edit ended with its page: no editor left open, and the empty box is gone.
    await expect(textEditor(page)).toHaveCount(0)
    await expect((await itemsList(page)).locator('[data-item-row]')).toHaveCount(0)

    await fillFormField(page, 'far', 'Hello world')
    await clickPagePoint(page, 11, { x: 400, y: 500 }, LETTER)
    await expectFormFieldValue(page, 'far', 'Hello world')
    await page.keyboard.press('ControlOrMeta+z')
    await expectFormFieldValue(page, 'far', '')
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expectFormFieldValue(page, 'far', 'Hello world')
    expect(errors).toEqual([])
  })

  test('editing a far-away text from the Items panel puts the caret at the end', async ({ page }, testInfo) => {
    const errors = trackPageErrors(page)
    await gotoHome(page)
    await openPdf(page, await longPdf(testInfo.outputPath('long.pdf')))
    await showPage(page, 0)
    await selectTool(page, 'Text', 'T')
    await clickPagePoint(page, 0, { x: 300, y: 300 }, LETTER)
    await expectEditing(page)
    await page.keyboard.type('Hello')
    await page.keyboard.press('Escape')

    await wheelToPage(page, 40)
    await expect(firstPageLayer(page)).toHaveCount(0)
    const list = await itemsList(page)
    await list.locator('[data-item-row]', { hasText: 'Hello' }).dblclick()
    await expect(textEditor(page)).toBeFocused()
    await page.keyboard.type('!')
    await page.keyboard.press('Escape')
    await expect(list.locator('[data-item-row]', { hasText: 'Hello!' })).toHaveCount(1)
    expect(errors).toEqual([])
  })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

  test('dragging a small selected item moves it instead of resizing it', async ({ page }) => {
    const errors = trackPageErrors(page)
    const sizes = await readViewSizes(SAMPLE_PDF)
    await openSample(page)
    await selectTool(page, 'Checkmark', 'C')
    await clickPagePoint(page, 1, { x: 300, y: 400 }, sizes[1])
    await selectTool(page, 'Select', 'V')
    const mark = page.locator('[data-element-id][data-kind="mark"]')
    await expect(page.locator(`[data-handle-for]`).first()).toBeAttached()
    const before = await mark.boundingBox()
    const center = await centerOf(mark)
    // The knobs drawn on the corners of a mark this small cover its middle: they must not take the press.
    const pressed = await page.evaluate(({ x, y }) => {
      const t = document.elementFromPoint(x, y)
      return { handle: !!t?.closest('[data-handle]'), body: !!t?.closest('[data-hit]') }
    }, center)
    expect(pressed).toEqual({ handle: false, body: true })

    const cdp = await page.context().newCDPSession(page)
    await touchDrag(cdp, center, { x: center.x + 40, y: center.y })
    await expect.poll(async () => (await mark.boundingBox())?.x ?? 0).toBeGreaterThan((before?.x ?? 0) + 30)
    expect((await mark.boundingBox())?.width).toBeCloseTo(before?.width ?? 0, 1)
    expect(errors).toEqual([])
  })

  test('scrolling the page with one finger keeps a text edit (and its keyboard) open', async ({ page }) => {
    const errors = trackPageErrors(page)
    const sizes = await readViewSizes(SAMPLE_PDF)
    await openSample(page)
    const cdp = await page.context().newCDPSession(page)
    const sheet = await pdfPage(page, 1)
    const top = async () => (await sheet.boundingBox())?.y ?? 0
    /** Screen point of a view-space point on page 2. */
    const onPage = async (x: number, y: number) => {
      const box = await sheet.boundingBox()
      if (!box) throw new Error('Page 2 is not visible')
      return { x: box.x + (x / sizes[1].width) * box.width, y: box.y + (y / sizes[1].height) * box.height }
    }

    await selectTool(page, 'Text', 'T')
    await clickPagePoint(page, 1, { x: 100, y: 300 }, sizes[1])
    await expectEditing(page)
    await page.keyboard.type('ab')
    const before = await top()
    const from = await onPage(450, 340)
    await touchDrag(cdp, from, { x: from.x, y: from.y - 200 })
    await expect.poll(top).toBeLessThan(before - 100)
    await expect(textEditor(page)).toBeFocused()
    await expect(textEditor(page)).toHaveValue('ab')

    // With the Text tool kept on (double-click), a new, still empty box survives a scroll too.
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Text', exact: true }).filter({ visible: true }).first().dblclick()
    await clickPagePoint(page, 1, { x: 100, y: 500 }, sizes[1])
    await expectEditing(page)
    const from2 = await onPage(450, 540)
    await touchDrag(cdp, from2, { x: from2.x, y: from2.y + 150 })
    await expect(textEditor(page)).toBeFocused()
    await expect(textEditor(page)).toHaveValue('')
    expect(errors).toEqual([])
  })
})

test.describe('the items clipboard', () => {
  test.beforeEach(async ({ context }) => {
    // Keep the real system clipboard out of it: record what the app writes there.
    await context.addInitScript(() => {
      const writes: string[] = []
      Object.assign(window, { __clipboardWrites: writes })
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text: string) => void writes.push(text), readText: async () => writes.at(-1) ?? '' },
      })
    })
  })

  test('after Copy from the right-click menu, things copied elsewhere still paste', async ({ page }) => {
    const errors = trackPageErrors(page)
    const sizes = await readViewSizes(SAMPLE_PDF)
    await openSample(page)
    await selectTool(page, 'Checkmark', 'C')
    await clickPagePoint(page, 1, { x: 300, y: 300 }, sizes[1])
    await page.keyboard.press('Escape')
    const mark = page.locator('[data-element-id][data-kind="mark"]')
    const at = await centerOf(mark)
    await page.mouse.click(at.x, at.y, { button: 'right' })
    await page.getByRole('menuitem', { name: /^Copy/ }).click()
    const writes = () => page.evaluate(() => (window as unknown as { __clipboardWrites: string[] }).__clipboardWrites)
    await expect.poll(async () => (await writes()).length).toBe(1)
    const marker = (await writes())[0]

    await paste(page, { text: marker })
    await expect.poll(() => placedKinds(page)).toEqual(['mark', 'mark'])
    await paste(page, { text: 'Jane Doe, 12 Main St' })
    await expect(page.locator('[data-element-id][data-kind="text"]')).toHaveText('Jane Doe, 12 Main St')
    await paste(page, { image: true })
    await expect(page.locator('[data-element-id][data-kind="image"]')).toHaveCount(1)

    // Another tab has no copied items: the marker must not turn into a text box.
    const other = await page.context().newPage()
    await openSample(other)
    const count = await other.locator('[data-element-id]').count()
    await paste(other, { text: marker })
    await expect(other.getByText('Copy the items again to paste them here')).toBeVisible()
    await expect(other.locator('[data-element-id]')).toHaveCount(count)
    await expect(other.locator('[data-element-id][data-kind="text"]', { hasText: 'fillflow-items' })).toHaveCount(0)
    expect(errors).toEqual([])
  })
})

test('Escape that cancels an IME composition keeps the text edit open', async ({ page }) => {
  const errors = trackPageErrors(page)
  const sizes = await readViewSizes(SAMPLE_PDF)
  await openSample(page)
  await selectTool(page, 'Text', 'T')
  await clickPagePoint(page, 1, { x: 100, y: 300 }, sizes[1])
  await expectEditing(page)
  await page.keyboard.type('ab')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.imeSetComposition', { text: 'にほ', selectionStart: 2, selectionEnd: 2 })
  const escape = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...escape })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...escape })
  await expect(textEditor(page)).toBeFocused()
  await cdp.send('Input.insertText', { text: 'にほん' })
  await page.keyboard.press('Escape')
  await expect(textEditor(page)).toHaveCount(0)
  await expect(page.locator('[data-element-id][data-kind="text"]')).toHaveText('abにほん')
  expect(errors).toEqual([])
})

test('the toolbar does not resize a locked item', async ({ page }) => {
  const errors = trackPageErrors(page)
  const sizes = await readViewSizes(SAMPLE_PDF)
  await openSample(page)
  await selectTool(page, 'Checkmark', 'C')
  await clickPagePoint(page, 1, { x: 300, y: 200 }, sizes[1])
  await page.keyboard.press('Escape')
  const size = page.getByRole('group', { name: 'Size' })
  await expect(size.getByRole('textbox')).toBeEnabled()
  await page.keyboard.press('ControlOrMeta+Shift+L')
  await expect(size.getByRole('textbox')).toBeDisabled()
  await expect(size.getByRole('button', { name: 'Increase size' })).toBeDisabled()
  await page.keyboard.press('ControlOrMeta+Shift+L')
  await expect(size.getByRole('textbox')).toBeEnabled()
  expect(errors).toEqual([])
})

test('Delete on a focused Items row deletes that item, not the selection elsewhere', async ({ page }) => {
  const errors = trackPageErrors(page)
  const sizes = await readViewSizes(SAMPLE_PDF)
  await openSample(page)
  await selectTool(page, 'Checkmark', 'C')
  await clickPagePoint(page, 1, { x: 300, y: 200 }, sizes[1])
  await selectTool(page, 'Cross', 'X')
  await clickPagePoint(page, 1, { x: 300, y: 400 }, sizes[1])
  await page.keyboard.press('Escape')
  const check = page.locator('[data-element-id][data-kind="mark"][aria-label="Checkmark"]')
  const at = await centerOf(check)
  await page.mouse.click(at.x, at.y)

  const list = await itemsList(page)
  await list.locator('[data-item-row]', { hasText: 'Checkmark' }).focus()
  await page.keyboard.press('ArrowDown')
  await expect(list.locator('[data-item-row]', { hasText: 'Cross' })).toBeFocused()
  await page.keyboard.press('Delete')
  await expect(page.locator('[data-element-id][aria-label="Cross"]')).toHaveCount(0)
  await expect(check).toHaveCount(1)
  await expect(list.locator('[data-item-row]', { hasText: 'Checkmark' })).toBeFocused()
  expect(errors).toEqual([])
})
