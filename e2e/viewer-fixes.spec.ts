import { writeFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { PDFDocument, PDFTextField, StandardFonts, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } from 'pdf-lib'
import {
  SAMPLE_PDF,
  clickPagePoint,
  downloadPdf,
  expectEditing,
  fillFormField,
  fixture,
  formField,
  gotoHome,
  openPdf,
  pdfPage,
  selectTool,
  showPage,
  trackPageErrors,
} from './support/app'
import { pageText } from './support/pdf'

/**
 * Regression tests for the document view, the Pages panel and pdf.js. The memory test looks at
 * pdf.js state that has no user-facing contract: it imports the app's store from the dev server.
 */

/** A PDF whose every page is one full-page RGB image of its own, like a scan. */
async function scannedPdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const size = 400
  for (let i = 0; i < pageCount; i++) {
    const pixels = new Uint8Array(size * size * 3).fill(40 + ((i * 37) % 200))
    const image = doc.context.register(
      doc.context.flateStream(pixels, { Type: 'XObject', Subtype: 'Image', Width: size, Height: size, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }),
    )
    const page = doc.addPage([595, 842])
    const name = page.node.newXObject('Scan', image)
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(595, 0, 0, 842, 0, 0), drawObject(name), popGraphicsState())
  }
  return doc.save()
}

/** More pages than are always kept ready: large documents mount page layers near the viewport only. */
const LONG_PAGES = 70
const LETTER = { width: 612, height: 792 }

/** A long document with a text field "Name" on page 1. */
async function longFormPdf(path: string): Promise<string> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const name = doc.getForm().createTextField('Name')
  for (let i = 0; i < LONG_PAGES; i++) {
    const page = doc.addPage([LETTER.width, LETTER.height])
    page.drawText(`Page ${i + 1}`, { x: 50, y: 740, size: 24, font })
    if (i === 0) name.addToPage(page, { x: 72, y: 600, width: 300, height: 24 })
  }
  await writeFile(path, await doc.save())
  return path
}

/** Wheel-scrolls the document until page `index` (0-based) reaches the upper part of the window. */
async function wheelToPage(page: Page, index: number): Promise<void> {
  const target = await pdfPage(page, index)
  await page.mouse.move(720, 450)
  for (let i = 0; i < 100; i++) {
    const box = await target.boundingBox()
    if (box && box.y > -200 && box.y < 300) return
    await page.mouse.wheel(0, Math.max(-3000, Math.min(3000, (box?.y ?? 3000) - 150)))
    await page.waitForTimeout(30)
  }
  throw new Error(`Could not scroll to page ${index + 1}`)
}

/** The Pages panel's list (CSS only: a collapsed panel is inert, so it has no accessible role then). */
const pagesList = (page: Page): Locator => page.locator('ol[aria-label="Pages"]')

/** Scroll position of the list's scroll area. */
function listScrollTop(list: Locator): Promise<number> {
  return list.evaluate((ol) => {
    let area = ol.parentElement
    while (area && getComputedStyle(area).overflowY !== 'auto') area = area.parentElement
    return Math.round(area?.scrollTop ?? -1)
  })
}

interface Retention {
  /** 0-based pages whose pdf.js objects (decoded images) are still in memory. */
  held: number[]
  /** 0-based pages the document view currently keeps rendered. */
  shown: number[]
}

type PdfjsDocument = { numPages: number; getPage(n: number): Promise<{ objs: Iterable<unknown> }> }
type EditorWindow = Window & { __ffEditor?: { getState(): { doc: { pdf: PdfjsDocument } | null } } }

/**
 * Puts the app's store on `window`. The dev server serves it at its source path, plus a `?t=`
 * stamp after a hot update: import the exact URL the app loaded to get the same instance.
 */
async function exposeStore(page: Page): Promise<void> {
  const url = await page.evaluate(
    () =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((name) => /\/src\/store\/editor\.ts(\?|$)/.test(name))
        .pop() ?? './src/store/editor.ts',
  )
  await page.addScriptTag({ type: 'module', content: `import { useEditor } from ${JSON.stringify(url)}; window.__ffEditor = useEditor` })
  await page.waitForFunction(() => !!(window as EditorWindow).__ffEditor?.getState().doc)
}

/** Which pages pdf.js still holds resources for, next to the pages the document view shows. */
function retention(page: Page): Promise<Retention> {
  return page.evaluate(async () => {
    const pdf = (window as EditorWindow).__ffEditor?.getState().doc?.pdf
    if (!pdf) throw new Error('No open document')
    const held: number[] = []
    for (let i = 0; i < pdf.numPages; i++) if ([...(await pdf.getPage(i + 1)).objs].length > 0) held.push(i)
    const shown = [...document.querySelectorAll<HTMLElement>('[data-page-index] > [data-state]')]
      .filter((el) => el.dataset.state !== 'empty')
      .map((el) => Number(el.parentElement?.dataset.pageIndex))
    return { held, shown }
  })
}

test('thumbnails let pdf.js free the pages they rendered', async ({ page }, testInfo) => {
  const errors = trackPageErrors(page)
  const pageCount = 24
  const file = testInfo.outputPath('scanned.pdf')
  await writeFile(file, await scannedPdf(pageCount))
  // Keep every resource timing entry (the dev server serves hundreds of modules); see exposeStore.
  await page.addInitScript(() => performance.setResourceTimingBufferSize(100_000))

  await gotoHome(page)
  await openPdf(page, file)
  await showPage(page, 0)

  // Browse the whole Pages list (the document view stays on the first pages).
  const list = pagesList(page)
  await list.locator('button').first().hover()
  for (let i = 0; i < 30 && (await list.locator('img').count()) < pageCount; i++) {
    await page.mouse.wheel(0, 350)
    await page.waitForTimeout(200)
  }
  await expect(list.locator('img')).toHaveCount(pageCount, { timeout: 30_000 })

  // Only pages the document view still shows keep their decoded images.
  await exposeStore(page)
  await expect
    .poll(async () => {
      const { held, shown } = await retention(page)
      return held.filter((index) => !shown.includes(index))
    })
    .toEqual([])
  expect((await retention(page)).shown.length).toBeLessThan(pageCount / 2)
  expect(errors).toEqual([])
})

test('a collapsed Pages panel neither renders nor scrolls its thumbnails', async ({ page }) => {
  const errors = trackPageErrors(page)
  await gotoHome(page)
  await openPdf(page, fixture('long.pdf'))
  await showPage(page, 0)
  const list = pagesList(page)
  await expect(list.locator('img').first()).toBeVisible()

  await page.getByRole('button', { name: 'Hide pages' }).click()
  await expect(page.locator('aside[aria-label="Pages"]')).toHaveAttribute('inert', '')
  await page.waitForTimeout(300)
  const before = { scrollTop: await listScrollTop(list), thumbnails: await list.locator('img').count() }

  // Reading on far into the document must not touch the hidden list.
  await showPage(page, 40)
  await page.waitForTimeout(1_000)
  expect({ scrollTop: await listScrollTop(list), thumbnails: await list.locator('img').count() }).toEqual(before)

  // Opening the panel brings the current page's thumbnail into view and renders it.
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  const current = list.locator('[aria-current="page"]')
  await expect(current).toBeInViewport()
  await expect(current.locator('img')).toBeVisible()
  expect(Number(await current.getAttribute('data-thumb-index'))).toBeGreaterThan(30)
  expect(errors).toEqual([])
})

test.describe('a document too long to keep every page ready', () => {
  test('scrolling away from a text being typed keeps the edit going', async ({ page }, testInfo) => {
    const errors = trackPageErrors(page)
    await gotoHome(page)
    await openPdf(page, await longFormPdf(testInfo.outputPath('long.pdf')))
    await showPage(page, 0)
    await selectTool(page, 'Text', 'T')
    await clickPagePoint(page, 0, { x: 300, y: 300 }, LETTER)
    await expectEditing(page)
    await page.keyboard.type('Hello')

    await wheelToPage(page, 40)
    const editor = page.locator('textarea[aria-label="Edit text"]')
    await expect(editor).toBeFocused()
    await page.keyboard.type(' world')
    await wheelToPage(page, 0)
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-element-layer="0"] [data-element-id][data-kind="text"]')).toHaveText('Hello world')
    expect(errors).toEqual([])
  })

  test('scrolling away from a form field being typed into keeps its focus', async ({ page }, testInfo) => {
    const errors = trackPageErrors(page)
    await gotoHome(page)
    await openPdf(page, await longFormPdf(testInfo.outputPath('long.pdf')))
    await showPage(page, 0)
    const input = page.locator('[data-page-index="0"] [data-form-field="Name"] input')
    await input.click()
    await page.keyboard.type('Ada')

    await wheelToPage(page, 40)
    await expect(input).toBeFocused()
    // Not page shortcuts: "l" would pick the Line tool, "e" the Ellipse…
    await page.keyboard.type(' Lovelace')
    await expect(input).toHaveValue('Ada Lovelace')
    const selectButton = page.getByRole('button', { name: 'Select', exact: true }).filter({ visible: true }).first()
    await expect(selectButton).toHaveAttribute('aria-pressed', 'true')
    expect(errors).toEqual([])
  })

  test('an item dragged pages away lands where it is dropped', async ({ page }, testInfo) => {
    const errors = trackPageErrors(page)
    await gotoHome(page)
    await openPdf(page, await longFormPdf(testInfo.outputPath('long.pdf')))
    await showPage(page, 0)
    await selectTool(page, 'Checkmark', 'C')
    await clickPagePoint(page, 0, { x: 300, y: 250 }, LETTER)
    await selectTool(page, 'Select', 'V')
    const mark = page.locator('[data-element-id][data-kind="mark"]')
    const start = await mark.boundingBox()
    const area = await page.getByRole('region', { name: 'Document pages' }).boundingBox()
    if (!start || !area) throw new Error('The item or the document is not visible')
    const from = { x: start.x + start.width / 2, y: start.y + start.height / 2 }

    // Held at the bottom edge, the item carries the document along: page 1 scrolls far out of range.
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x, area.y + area.height - 8, { steps: 10 })
    const fourth = await pdfPage(page, 3)
    await expect
      .poll(async () => (await fourth.boundingBox())?.y ?? Infinity, { intervals: [100], timeout: 30_000 })
      .toBeLessThan(area.y + area.height / 2 - 100)
    const drop = { x: from.x + 60, y: area.y + area.height / 2 }
    await page.mouse.move(drop.x, drop.y, { steps: 6 })
    await page.mouse.up()

    const dropped = page.locator('[data-element-layer="3"] [data-element-id][data-kind="mark"]')
    await expect(dropped).toHaveCount(1)
    const end = await dropped.boundingBox()
    expect(Math.abs((end?.x ?? 0) + (end?.width ?? 0) / 2 - drop.x)).toBeLessThan(3)
    expect(Math.abs((end?.y ?? 0) + (end?.height ?? 0) / 2 - drop.y)).toBeLessThan(3)
    expect(errors).toEqual([])
  })
})

test.describe('in a browser without the newest JavaScript built-ins', () => {
  // Baseline 2025-2026 features that pdf.js' default build calls without polyfills.
  const REMOVE_BUILT_INS = `
    delete Promise.try;
    delete Math.sumPrecise;
    for (const C of [Map, WeakMap]) { delete C.prototype.getOrInsert; delete C.prototype.getOrInsertComputed; }
    delete Uint8Array.fromBase64; delete Uint8Array.fromHex;
    for (const m of ['toBase64', 'toHex', 'setFromBase64', 'setFromHex']) delete Uint8Array.prototype[m];
  `

  let patchedWorkers = 0
  test.beforeEach(async ({ page }) => {
    patchedWorkers = 0
    await page.addInitScript(REMOVE_BUILT_INS)
    // The pdf.js worker script gets the same treatment (not the dev server's `?url` module).
    await page.route(/\/pdf\.worker[^/?]*\.m?js$/, async (route) => {
      const response = await route.fetch()
      await route.fulfill({ response, body: REMOVE_BUILT_INS + (await response.text()) })
      patchedWorkers++
    })
  })

  test('pages render and form fields are detected', async ({ page }) => {
    const errors = trackPageErrors(page)
    await gotoHome(page)
    await openPdf(page, SAMPLE_PDF)
    await showPage(page, 0)
    await expect(page.locator('[data-page-index="0"] > [data-state]')).toHaveAttribute('data-state', 'ready')
    await formField(page, 'Full name')
    expect(patchedWorkers).toBeGreaterThan(0)
    expect(errors).toEqual([])
  })

  test('an encrypted PDF opens, fills and downloads', async ({ page }) => {
    const errors = trackPageErrors(page)
    await gotoHome(page)
    await openPdf(page, fixture('password.pdf'))
    await page.getByLabel('Password', { exact: true }).fill('fillflow')
    await page.keyboard.press('Enter')
    await showPage(page, 0)
    await fillFormField(page, 'Name', 'Ada Lovelace')

    // Saving an encrypted file goes through pdf.js' page writer (in the worker).
    const { bytes } = await downloadPdf(page)
    const field = (await PDFDocument.load(bytes)).getForm().getFieldMaybe('Name')
    if (field instanceof PDFTextField) expect(field.getText()).toBe('Ada Lovelace')
    else expect(await pageText(bytes, 0)).toContain('Ada Lovelace')
    expect(patchedWorkers).toBeGreaterThan(0)
    expect(errors).toEqual([])
  })
})
