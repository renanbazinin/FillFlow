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

/**
 * Waits until the pages stop scrolling: a smooth scroll has run its course. (Found by CSS: a sheet
 * open over the pages hides them from the accessibility tree.)
 */
async function scrollSettled(page: Page): Promise<void> {
  await page.locator('[role="region"][aria-label="Document pages"]').evaluate(
    (el) =>
      new Promise<void>((done) => {
        let last = ''
        let still = 0
        const check = () => {
          const now = `${el.scrollLeft} ${el.scrollTop}`
          still = now === last ? still + 1 : 0
          last = now
          if (still < 10) requestAnimationFrame(check)
          else done()
        }
        requestAnimationFrame(check)
      }),
  )
}

/** The field whose control on a page has focus, if any. */
function focusedField(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.closest<HTMLElement>('[data-page-index] [data-form-field]')?.dataset.formField ?? null)
}

/**
 * How much of a field's box on a page the floating tool dock covers, and how much of it is out of
 * sight (outside the visible part of the pages), in percent.
 */
function hiddenShare(widget: Locator): Promise<{ underDock: number; outOfSight: number }> {
  return widget.evaluate((el) => {
    const box = el.getBoundingClientRect()
    const pages = document.querySelector('[role="region"][aria-label="Document pages"]')!
    const { left, top } = pages.getBoundingClientRect()
    const view = { left, top, right: left + pages.clientWidth, bottom: top + pages.clientHeight }
    const dock = document.querySelector('[role="toolbar"][aria-label="Tools"]')!.getBoundingClientRect()
    const share = (r: { left: number; top: number; right: number; bottom: number }) =>
      (Math.max(0, Math.min(box.right, r.right) - Math.max(box.left, r.left)) * Math.max(0, Math.min(box.bottom, r.bottom) - Math.max(box.top, r.top))) /
      (box.width * box.height)
    return { underDock: Math.round(share(dock) * 100), outOfSight: Math.round((1 - share(view)) * 100) }
  })
}

test.describe('on a phone held sideways, with a keyboard that leaves 190px of the page', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true })

  test('"Next empty field", Enter and Tab bring the field clear of the tool dock', async ({ page }) => {
    const errors = trackPageErrors(page)
    await gotoHome(page)
    await openPdf(page, SAMPLE_PDF)
    await showPage(page, 0)
    const pages = page.getByRole('region', { name: 'Document pages' })
    // The first fields filled in: the next empty one is Home address, further down.
    for (const [name, value] of [
      ['Full name', 'Dana Levi'],
      ['Date of birth', '01/01/1990'],
      ['Email', 'dana@example.com'],
      ['Phone', '050-1234567'],
    ] as const) {
      await (await formField(page, name)).locator('input').fill(value)
    }
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.setViewportSize({ width: 844, height: 190 })

    // From the Form & items sheet, with the page behind it: the dock shows (nothing on the pages has focus).
    const address = await formField(page, 'Address')
    await pages.evaluate((el) => el.scrollTo({ top: 0 }))
    expect((await hiddenShare(address)).outOfSight).toBe(100)
    await page.getByRole('button', { name: 'Form & items' }).tap()
    const sheet = page.getByRole('dialog', { name: 'Form and items' })
    await sheet.getByRole('button', { name: 'Next empty field' }).tap()
    await scrollSettled(page)
    expect(await hiddenShare(address)).toEqual({ underDock: 0, outOfSight: 0 })
    await sheet.getByRole('button', { name: 'Close' }).first().tap()
    await expect(sheet).toHaveCount(0)

    // On from a text box, where the dock makes way while typing, to the next field below the view: a
    // text box, where it still does, or a choice, where it is back.
    for (const [from, key, to] of [
      ['Phone', 'Enter', 'Address'],
      ['ID number', 'Enter', 'Membership type'],
      ['ID number', 'Tab', 'Membership type'],
      ['Comments', 'Tab', 'Signature'],
    ] as const) {
      const control = (await formField(page, from)).locator('input, textarea')
      await control.focus()
      // At the bottom of the view.
      await control.evaluate((el) => {
        const view = el.closest('[role="region"]')!
        view.scrollTop += el.getBoundingClientRect().bottom - (view.getBoundingClientRect().top + view.clientHeight - 4)
      })
      expect((await hiddenShare(await formField(page, to))).outOfSight).toBe(100)
      await page.keyboard.press(key)
      await expect.poll(() => focusedField(page)).toBe(to)
      await scrollSettled(page)
      const widget = page.locator('[data-page-index] [data-form-widget]:focus-within')
      expect(await hiddenShare(widget), `${key} from ${from}`).toEqual({ underDock: 0, outOfSight: 0 })
    }
    expect(errors).toEqual([])
  })
})

/** Where a text field's text ends on screen (its right edge, inside its padding), next to the field's width and the view. */
function textEnd(input: Locator): Promise<{ width: number; text: number; view: { left: number; right: number } }> {
  return input.evaluate((el) => {
    const pages = el.closest('[role="region"]')!
    const left = pages.getBoundingClientRect().left + pages.clientLeft
    const box = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return {
      width: box.width,
      text: box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
      view: { left, right: left + pages.clientWidth },
    }
  })
}

test('Enter and "Next empty field" bring in the end of a wide field that its text sits at', async ({ page }) => {
  const errors = trackPageErrors(page)
  await page.setViewportSize({ width: 1366, height: 657 })
  await gotoHome(page)
  await openPdf(page, fixture('form-basic.pdf'))
  await showPage(page, 0)
  const pages = page.getByRole('region', { name: 'Document pages' })
  const name = (await formField(page, 'Name')).locator('input')
  const hebrewName = (await formField(page, 'Hebrew name')).locator('input')
  await page.getByRole('button', { name: /^Zoom level/ }).click()
  await page.getByRole('menuitemradio', { name: '300%' }).click()
  await expect.poll(async () => (await textEnd(name)).width).toBeGreaterThan(850)

  // Hebrew in a right-aligned field, then in a left-aligned one (where it starts at the right edge too).
  await name.fill('דנה לוי')
  await hebrewName.fill('ישראל כהן')
  for (const [from, key, to] of [
    [name, 'Enter', hebrewName],
    [hebrewName, 'Shift+Enter', name],
  ] as const) {
    await from.focus()
    await pages.evaluate((el) => el.scrollTo({ left: 0 }))
    const before = await textEnd(to)
    expect(before.text).toBeGreaterThan(before.view.right)
    await page.keyboard.press(key)
    await expect(to).toBeFocused()
    await scrollSettled(page)
    const { width, text, view } = await textEnd(to)
    expect(width).toBeGreaterThan(view.right - view.left)
    expect(text, `${key} into ${await to.inputValue()}`).toBeLessThanOrEqual(view.right)
    expect(text).toBeGreaterThan(view.left)
  }

  // The empty right-aligned field, where typing starts at its right edge: next after Name.
  await hebrewName.fill('')
  await name.focus()
  await pages.evaluate((el) => el.scrollTo({ left: 0 }))
  const before = await textEnd(hebrewName)
  expect(before.text).toBeGreaterThan(before.view.right)
  await page.getByRole('button', { name: 'Next empty field' }).click()
  await expect(hebrewName).toBeFocused()
  await scrollSettled(page)
  const { text, view } = await textEnd(hebrewName)
  expect(text).toBeLessThanOrEqual(view.right)
  expect(text).toBeGreaterThan(view.left)
  expect(errors).toEqual([])
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
