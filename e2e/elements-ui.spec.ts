import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument } from 'pdf-lib'
import {
  SAMPLE_PDF,
  SAMPLE_SPOTS,
  clickPagePoint,
  expectEditing,
  gotoHome,
  openPdf,
  selectTool,
  showPage,
  trackPageErrors,
  typeAndCommit,
} from './support/app'
import { readViewSizes } from './support/pdf'

// What placed items offer around them: touch gestures on them, placing them from the keyboard, the
// selection toolbar (its popovers, names, sizes on touch screens), the Items panel's order, and
// letter shortcuts on every keyboard layout.

interface Box {
  x: number
  y: number
  width: number
  height: number
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
    .poll(
      async () => {
        const box = await sheet.boundingBox()
        const now = box ? `${Math.round(box.x)},${Math.round(box.width)}` : ''
        const same = now === last
        last = now
        return same
      },
      { intervals: [250] },
    )
    .toBe(true)
}

const scroller = (page: Page): Locator => page.getByRole('region', { name: 'Document pages' })
const scrollTop = (page: Page): Promise<number> => scroller(page).evaluate((el) => el.scrollTop)
const toolbar = (page: Page): Locator => page.locator('[data-element-toolbar] [role="toolbar"]')
const handles = (page: Page): Locator => page.locator('[data-handle-for]')

async function boxOf(el: Locator): Promise<Box> {
  const box = await el.boundingBox()
  if (!box) throw new Error('Not visible')
  return box
}

const centerOf = async (el: Locator) => {
  const b = await boxOf(el)
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

/** Where an item sits on its page, as fractions of the page (unchanged by scrolling). */
function placeOnPage(item: Locator): Promise<{ x: number; y: number }> {
  return item.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const page = el.closest('[data-page-index]')!.getBoundingClientRect()
    const round = (n: number) => Math.round(n * 1000) / 1000
    return { x: round((r.x - page.x) / page.width), y: round((r.y - page.y) / page.height) }
  })
}

/** How much two boxes overlap (px²). */
function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return Math.max(0, w) * Math.max(0, h)
}

/**
 * A one-finger drag (touch events go through the browser's own input pipeline, so it may scroll).
 * The finger comes to rest before it lifts: lifted while moving, it would fling the page, which
 * then keeps scrolling under the taps and drags that follow.
 */
async function touchDrag(cdp: CDPSession, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const rest = () => new Promise((resolve) => setTimeout(resolve, 150))
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
  for (let i = 1; i <= 12; i++) {
    const t = i / 12
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }] })
  }
  await rest()
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [to] })
  await rest()
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

/** The Items list of the right-hand panel, opened (on its Items tab when there's a form). */
async function itemsList(page: Page): Promise<Locator> {
  const list = page.locator('[data-items-panel]')
  const tab = page.getByRole('tab', { name: /Items/ })
  if (!(await tab.isVisible()) && !(await list.isVisible())) {
    const button = page.getByRole('button', { name: /^(Form & items|Items)$/ }).filter({ visible: true })
    if (await button.count()) await button.first().click()
    else {
      // Phones have it in the top bar's menu.
      await page.getByRole('button', { name: 'More', exact: true }).click()
      await page.getByRole('menuitem', { name: /^(Form & items|Items)$/ }).click()
    }
  }
  if (await tab.count()) await tab.click()
  return list
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

  /** A tap beside the pages (once a closing dialog's backdrop is gone): nothing is selected then. */
  async function deselect(page: Page): Promise<void> {
    await expect.poll(() => page.evaluate(() => !!document.elementFromPoint(4, 400)?.closest('[aria-label="Document pages"]'))).toBe(true)
    await page.touchscreen.tap(4, 400)
    await expect(handles(page)).toHaveCount(0)
  }

  /** Scrolls the document so `item` is in the middle of the view (room to scroll either way). */
  async function centerInView(page: Page, item: Locator): Promise<void> {
    const y = (await centerOf(item)).y
    await scroller(page).evaluate((sc, y) => sc.scrollTo({ top: sc.scrollTop + y - (sc.getBoundingClientRect().top + sc.clientHeight / 2), behavior: 'instant' }), y)
  }

  /**
   * A one-finger swipe that starts on `item` (not selected) scrolls the document by most of the
   * swipe, and leaves the item where it is on its page.
   */
  async function expectSwipeScrolls(page: Page, cdp: CDPSession, item: Locator): Promise<void> {
    await expect(handles(page)).toHaveCount(0)
    await centerInView(page, item)
    const place = await placeOnPage(item)
    const top = await scrollTop(page)
    const from = await centerOf(item)
    const up = top < 150
    await touchDrag(cdp, from, { x: from.x, y: from.y + (up ? -150 : 150) })
    await expect.poll(async () => Math.abs((await scrollTop(page)) - top)).toBeGreaterThan(100)
    expect((await scrollTop(page)) > top).toBe(up)
    expect(await placeOnPage(item)).toEqual(place)
    await expect(handles(page)).toHaveCount(0)
  }

  test('a swipe that starts on an item scrolls the document; a tap selects the item, and then it drags', async ({ page }) => {
    const errors = trackPageErrors(page)
    const sizes = await readViewSizes(SAMPLE_PDF)
    await openSample(page)
    const cdp = await page.context().newCDPSession(page)

    // A signature in its field: scrolling past it must not knock it out of the field.
    const field = page.locator('[data-page-index] [data-form-field="Signature"]')
    await field.scrollIntoViewIfNeeded()
    await field.click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('tab', { name: 'Type' }).click()
    await dialog.getByLabel('Your full name').fill('Dana Levi')
    await dialog.getByRole('button', { name: 'Use signature' }).click()
    await expect(dialog).toBeHidden()
    await expect(field).toHaveAttribute('aria-label', 'Signature: signed — sign again')
    await deselect(page)
    const signature = page.locator('[data-element-id][data-kind="image"]')
    await expectSwipeScrolls(page, cdp, signature)
    await expect(field).toHaveAttribute('aria-label', 'Signature: signed — sign again')

    // Text, a checkmark and a drawing on page 2.
    await selectTool(page, 'Text', 'T')
    await clickPagePoint(page, 1, SAMPLE_SPOTS.emergencyName, sizes[1])
    await typeAndCommit(page, 'Jane Doe')
    await selectTool(page, 'Checkmark', 'C')
    await clickPagePoint(page, 1, SAMPLE_SPOTS.allergiesYes, sizes[1])
    await selectTool(page, 'Draw', 'P')
    const sheet = await showPage(page, 1)
    const pageBox = await boxOf(sheet)
    const k = pageBox.width / sizes[1].width
    await page.mouse.move(pageBox.x + 150 * k, pageBox.y + 420 * k)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++) await page.mouse.move(pageBox.x + (150 + i * 20) * k, pageBox.y + (420 + (i % 2) * 20) * k)
    await page.mouse.up()
    await selectTool(page, 'Select', 'V')
    await deselect(page)
    for (const kind of ['text', 'mark', 'ink']) await expectSwipeScrolls(page, cdp, page.locator(`[data-element-id][data-kind="${kind}"]`))

    // A tap selects the signature; then a drag moves it (and the page stays put).
    await centerInView(page, signature)
    const place = await placeOnPage(signature)
    const at = await centerOf(signature)
    await page.touchscreen.tap(at.x, at.y)
    await expect(handles(page).first()).toBeAttached()
    const top = await scrollTop(page)
    await touchDrag(cdp, at, { x: at.x + 40, y: at.y - 40 })
    await expect.poll(async () => (await placeOnPage(signature)).y).toBeLessThan(place.y - 0.02)
    expect(Math.abs((await scrollTop(page)) - top)).toBeLessThan(5)

    // A locked text can't be dragged, but a double tap still edits it, selected or not.
    const text = page.locator('[data-element-id][data-kind="text"]')
    await centerInView(page, text)
    const spot = await centerOf(text)
    await page.touchscreen.tap(spot.x, spot.y)
    await expect(handles(page).first()).toBeAttached()
    await page.keyboard.press('Control+Shift+L')
    await expect(text.locator('[data-hit]')).toHaveCSS('cursor', 'default')
    for (const selected of [true, false]) {
      if (!selected) await deselect(page)
      await page.touchscreen.tap(spot.x, spot.y)
      await page.touchscreen.tap(spot.x, spot.y)
      await expectEditing(page)
      await expect(page.locator('textarea[aria-label="Edit text"]')).toHaveValue('Jane Doe')
      await page.keyboard.press('Escape')
      await expect(page.locator('textarea[aria-label="Edit text"]')).toHaveCount(0)
    }
    expect(errors).toEqual([])
  })

  test('the selection toolbar, its menus and the Items panel have finger-sized targets', async ({ page }) => {
    const errors = trackPageErrors(page)
    const sizes = await readViewSizes(SAMPLE_PDF)
    await openSample(page)
    await selectTool(page, 'Text', 'T')
    await clickPagePoint(page, 1, SAMPLE_SPOTS.emergencyName, sizes[1])
    await typeAndCommit(page, 'Avi')
    const bar = toolbar(page)
    await expect(bar).toBeVisible()
    const small = async (scope: Locator, selector: string) => {
      // Measured once it has finished scaling in: until then, everything in it is drawn a bit smaller.
      await scope.evaluate(async (el) => {
        await Promise.all(el.getAnimations().map((a) => a.finished))
      })
      return scope.locator(selector).evaluateAll((els) =>
        els
          .map((el) => ({ name: el.getAttribute('aria-label') || el.textContent?.trim(), r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && (r.width < 40 || r.height < 40))
          .map(({ name, r }) => `${name} ${Math.round(r.width)}x${Math.round(r.height)}`),
      )
    }
    expect(await small(bar, 'button, input')).toEqual([])

    await bar.getByRole('button', { name: 'More actions' }).tap()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    expect(await small(menu, '[role="menuitem"]')).toEqual([])
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()

    // The menu a long press opens.
    await page.locator('[data-element-id][data-kind="text"] [data-hit]').dispatchEvent('contextmenu')
    await expect(menu).toBeVisible()
    expect(await small(menu, '[role="menuitem"]')).toEqual([])
    await page.keyboard.press('Escape')

    const list = await itemsList(page)
    const row = list.locator('[data-item-id]').first()
    await expect(row).toBeVisible()
    expect(await small(row, 'button')).toEqual([])
    const [lock, del] = await Promise.all([boxOf(row.getByRole('button', { name: 'Lock' })), boxOf(row.getByRole('button', { name: 'Delete' }))])
    expect(del.x - (lock.x + lock.width)).toBeGreaterThanOrEqual(8)
    expect(errors).toEqual([])
  })
})

test.describe('on a narrow phone', () => {
  test.use({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

  test('the selection toolbar keeps its actions in view, and its style controls scroll from any of them', async ({ page }) => {
    const errors = trackPageErrors(page)
    const sizes = await readViewSizes(SAMPLE_PDF)
    await openSample(page)
    const cdp = await page.context().newCDPSession(page)
    await selectTool(page, 'Text', 'T')
    await clickPagePoint(page, 1, SAMPLE_SPOTS.emergencyName, sizes[1])
    await typeAndCommit(page, 'Avi')
    const bar = toolbar(page)
    await expect(bar).toBeVisible()
    const barBox = await boxOf(bar)
    for (const name of ['Edit text', 'More actions', 'Delete']) {
      const b = await boxOf(bar.getByRole('button', { name }))
      expect(b.x).toBeGreaterThanOrEqual(barBox.x)
      expect(b.x + b.width).toBeLessThanOrEqual(barBox.x + barBox.width)
    }
    expect(barBox.x + barBox.width).toBeLessThanOrEqual(360)

    // The style controls don't all fit: they scroll, behind a fade on the side there's more.
    const strip = bar.locator('[data-toolbar-strip]')
    const scrolled = () => strip.evaluate((el) => el.scrollLeft)
    expect(await strip.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    await expect(strip).toHaveCSS('mask-image', /linear-gradient/)

    // A swipe that starts on a menu button scrolls them, and opens nothing; a tap opens the menu.
    const font = bar.getByRole('button', { name: /^Font: / })
    const from = await centerOf(font)
    await touchDrag(cdp, from, { x: from.x - 120, y: from.y })
    await expect.poll(scrolled).toBeGreaterThan(20)
    await expect(page.getByRole('menu')).toHaveCount(0)
    await strip.evaluate((el) => el.scrollTo({ left: 0 }))
    await expect.poll(scrolled).toBe(0)
    await font.tap()
    await expect(page.getByRole('menu')).toBeVisible()
    await page.keyboard.press('Escape')

    const more = await centerOf(bar.getByRole('button', { name: 'More actions' }))
    await touchDrag(cdp, more, { x: more.x - 120, y: more.y })
    await expect(page.getByRole('menu')).toHaveCount(0)

    // From a keyboard, each style control comes into view clear of the fades as it takes focus.
    await strip.evaluate((el) => el.scrollTo({ left: 0 }))
    await font.focus()
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab')
      const place = await page.evaluate(() => {
        const el = document.activeElement!
        const strip = el.closest('[data-toolbar-strip]')
        if (!strip) return null
        const r = el.getBoundingClientRect()
        const s = strip.getBoundingClientRect()
        const fadeStart = strip.scrollLeft > 2 ? 40 : 0
        const fadeEnd = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 2 ? 40 : 0
        return { clear: r.left >= s.left + fadeStart - 1 && r.right <= s.right - fadeEnd + 1, name: el.getAttribute('aria-label') }
      })
      if (!place) break
      expect(place, place.name ?? '').toMatchObject({ clear: true })
    }
    expect(errors).toEqual([])
  })
})

test.describe('on a phone held sideways', () => {
  test.use({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

  test('the selection toolbar’s popovers stay on screen, over the selection when there’s no room past it', async ({ page }) => {
    const errors = trackPageErrors(page)
    await openSample(page)
    await scroller(page).focus()
    await page.keyboard.press('t')
    await page.keyboard.press('Enter')
    await expectEditing(page)
    for (const [i, line] of ['First line', 'שורה שנייה', 'Third line'].entries()) {
      if (i) await page.keyboard.press('Enter')
      await page.keyboard.type(line)
    }
    await page.keyboard.press('Escape')
    const text = page.locator('[data-element-id][data-kind="text"]')
    const bar = toolbar(page)
    await expect(bar).toBeVisible()
    // The "fillable fields found" hint sits mid-screen here, where the toolbar goes: let it go first
    // (the mouse that opened the file rests there, and a hovered hint stays).
    await page.mouse.move(0, 0)
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
    const top = (await boxOf(scroller(page))).y
    // The text's top this far below the top of the pages: the toolbar above or below it, and the
    // 177px popover fits past it on neither side.
    for (const offset of [50, 110, 140]) {
      const y = (await boxOf(text)).y
      await scroller(page).evaluate((sc, dy) => sc.scrollBy({ top: dy, behavior: 'instant' }), y - (top + offset))
      await bar.getByRole('button', { name: 'Alignment and spacing' }).tap()
      const popover = page.getByRole('dialog', { name: 'Alignment and spacing' })
      await expect(popover).toBeVisible()
      for (const el of [popover, ...(await popover.getByRole('slider').all())]) {
        const b = await boxOf(el)
        expect(b.y).toBeGreaterThanOrEqual(0)
        expect(b.y + b.height).toBeLessThanOrEqual(390)
      }
      await page.keyboard.press('Escape')
      await expect(popover).toBeHidden()
    }
    expect(errors).toEqual([])
  })
})

test('keyboard users can add each kind of item, move it, and edit text from the Items panel', async ({ page }) => {
  const errors = trackPageErrors(page)
  await gotoHome(page)
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab')
    if (await page.evaluate(() => /sample form/i.test(document.activeElement?.textContent ?? ''))) break
  }
  await page.keyboard.press('Enter')
  await showPage(page, 1)
  const count = (kind: string) => page.locator(`[data-element-id][data-kind="${kind}"]`).count()

  // Text: Enter adds it where the view is, the arrows move it, and Enter edits it again.
  await page.keyboard.press('t')
  await page.keyboard.press('Enter')
  await typeAndCommit(page, 'Jane')
  const text = page.locator('[data-element-id][data-kind="text"]')
  await expect(handles(page).first()).toBeAttached()
  const before = await boxOf(text)
  await page.keyboard.press('Shift+ArrowDown')
  await expect.poll(async () => (await boxOf(text)).y).toBeGreaterThan(before.y + 5)
  await page.keyboard.press('Enter')
  await expectEditing(page)
  await expect(page.locator('textarea[aria-label="Edit text"]')).toHaveValue('Jane')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  // Checkmarks (the tool stays on): each Enter adds one, a step down and right of the last.
  await page.keyboard.press('c')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await expect.poll(() => count('mark')).toBe(2)
  const marks = page.locator('[data-element-id][data-kind="mark"]')
  const [first, second] = [await boxOf(marks.nth(0)), await boxOf(marks.nth(1))]
  expect(second.x - first.x).toBeGreaterThan(8)
  expect(second.y - first.y).toBeGreaterThan(8)
  await page.keyboard.press('Escape')

  // Today's date and a rectangle.
  await page.keyboard.press('d')
  await page.keyboard.press('Enter')
  await expect.poll(() => count('text')).toBe(2)
  await page.keyboard.press('Escape')
  await page.keyboard.press('r')
  await page.keyboard.press('Enter')
  await expect.poll(() => count('shape')).toBe(1)
  await page.keyboard.press('Escape')

  // A signature: made in its dialog, then placed with Enter.
  await page.keyboard.press('s')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('tab', { name: 'Type' }).focus()
  await page.keyboard.press('Enter')
  const name = dialog.getByLabel('Your full name')
  for (let i = 0; i < 6 && !(await name.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab')
  await page.keyboard.type('Jane Cooper')
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await page.keyboard.press('Enter')
  await expect.poll(() => count('image')).toBe(1)

  // The Items panel: Enter on a text row selects it, the next Enter edits it (F2 straight away).
  const list = await itemsList(page)
  const row = list.locator('[data-item-id]', { hasText: '“Jane”' }).getByRole('button').first()
  await row.focus()
  await page.keyboard.press('Enter')
  await expect(row).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Enter')
  await expectEditing(page)
  await expect(page.locator('textarea[aria-label="Edit text"]')).toHaveValue('Jane')
  await page.keyboard.press('Escape')
  await row.focus()
  await page.keyboard.press('F2')
  await expectEditing(page)
  await page.keyboard.press('Escape')
  expect(errors).toEqual([])
})

test('the selection toolbar’s popovers open away from the selection, so it stays in sight', async ({ page }) => {
  const errors = trackPageErrors(page)
  const sizes = await readViewSizes(SAMPLE_PDF)
  await openSample(page)
  await selectTool(page, 'Text', 'T')
  await clickPagePoint(page, 1, { x: 100, y: 250 }, sizes[1])
  await typeAndCommit(page, 'Hello עולם')
  const text = page.locator('[data-element-id][data-kind="text"]')
  const bar = toolbar(page)
  for (const name of ['Text color', 'Alignment and spacing']) {
    await bar.getByRole('button', { name }).click()
    const popover = page.getByRole('dialog', { name })
    await expect(popover).toBeVisible()
    expect(overlap(await boxOf(popover), await boxOf(text))).toBe(0)
    await page.keyboard.press('Escape')
    await expect(popover).toBeHidden()
  }

  // A shape's, opened as soon as it's there.
  await page.keyboard.press('Escape')
  await page.keyboard.press('r')
  await page.keyboard.press('Enter')
  const shape = page.locator('[data-element-id][data-kind="shape"]')
  await expect(shape).toBeVisible()
  for (const [button, name] of [['Fill', 'Fill'], ['Border', 'Border'], [/^Opacity/, 'Opacity']] as const) {
    await bar.getByRole('button', { name: button, exact: typeof button === 'string' }).click()
    const popover = page.getByRole('dialog', { name })
    await expect(popover).toBeVisible()
    expect(overlap(await boxOf(popover), await boxOf(shape))).toBe(0)
    await page.keyboard.press('Escape')
    await expect(popover).toBeHidden()
  }
  expect(errors).toEqual([])
})

test('the selection toolbar’s keyboard focus rings are drawn whole', async ({ page }) => {
  const errors = trackPageErrors(page)
  const sizes = await readViewSizes(SAMPLE_PDF)
  await openSample(page)
  await selectTool(page, 'Text', 'T')
  await clickPagePoint(page, 1, { x: 100, y: 250 }, sizes[1])
  await typeAndCommit(page, 'Focus ring')
  const bar = toolbar(page)
  await expect(bar).toBeVisible()
  for (const name of ['Sans font', 'Decrease font size', 'Bold', 'Text color', 'Alignment and spacing', 'Edit text', 'Delete']) {
    // Focus that follows a key press shows its ring, as when tabbing.
    await page.keyboard.press('Shift')
    await bar.locator(`[aria-label="${name}"]`).focus()
    const ring = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement
      const style = getComputedStyle(el)
      const reach = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth)
      const r = el.getBoundingClientRect()
      // What would cut it off: the scrolling strip it sits in, or else the bar.
      const clip = (el.closest('[data-toolbar-strip]') ?? el.closest('[role="toolbar"]'))!.getBoundingClientRect()
      return {
        shown: el.matches(':focus-visible') && style.outlineStyle !== 'none',
        whole: r.top - reach >= clip.top && r.bottom + reach <= clip.bottom && r.left - reach >= clip.left && r.right + reach <= clip.right,
      }
    })
    expect(ring, name).toEqual({ shown: true, whole: true })
  }
  expect(errors).toEqual([])
})

test('the selection toolbar’s groups, popovers, swatches and sliders are named', async ({ page }) => {
  const errors = trackPageErrors(page)
  const sizes = await readViewSizes(SAMPLE_PDF)
  await openSample(page)
  await selectTool(page, 'Text', 'T')
  await clickPagePoint(page, 1, { x: 100, y: 250 }, sizes[1])
  await typeAndCommit(page, 'Hello')
  const bar = toolbar(page)
  await expect(bar.getByRole('radiogroup', { name: 'Font' })).toBeVisible()
  await expect(bar.getByRole('radiogroup', { name: 'Text alignment' })).toBeVisible()

  await bar.getByRole('button', { name: 'Text color' }).click()
  const colors = page.getByRole('dialog', { name: 'Text color' })
  await colors.getByRole('radiogroup', { name: 'Text color' }).getByRole('radio', { name: 'Blue' }).click()
  await expect(page.locator('[data-element-id][data-kind="text"] div[dir="auto"]').first()).toHaveCSS('color', 'rgb(29, 78, 216)')
  await page.keyboard.press('Escape')

  await bar.getByRole('button', { name: 'Alignment and spacing' }).click()
  const spacing = page.getByRole('dialog', { name: 'Alignment and spacing' })
  await expect(spacing.getByRole('slider', { name: 'Letter spacing' })).toBeVisible()
  await expect(spacing.getByRole('slider', { name: 'Line height' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  await selectTool(page, 'Checkmark', 'C')
  await clickPagePoint(page, 1, SAMPLE_SPOTS.allergiesYes, sizes[1])
  await page.keyboard.press('Escape')
  await expect(bar.getByRole('radiogroup', { name: 'Mark shape' })).toBeVisible()
  expect(errors).toEqual([])
})

test('letter shortcuts go by the letter a layout types: punctuation never stands for one, Hebrew letter keys still do', async ({ page }) => {
  const errors = trackPageErrors(page)
  const sizes = await readViewSizes(SAMPLE_PDF)
  await openSample(page)
  const cdp = await page.context().newCDPSession(page)
  /** A trusted key press as the layout reports it: `key` is what it types, `code` the physical key. */
  const press = async (key: string, code: string, keyCode: number, ctrl = false) => {
    const modifiers = ctrl ? 2 : 0
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode, modifiers })
    if (!ctrl) await cdp.send('Input.dispatchKeyEvent', { type: 'char', key, code, text: key, windowsVirtualKeyCode: keyCode })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers })
  }
  const tool = (name: string) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first()
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

  // Dvorak "," and "." (the W and E keys), AZERTY "," (the M key), Colemak ";" (the P key).
  for (const [key, code, keyCode] of [[',', 'KeyW', 188], ['.', 'KeyE', 190], [',', 'KeyM', 188], [';', 'KeyP', 186]] as const) {
    await press(key, code, keyCode)
  }
  await expect(tool('Select')).toHaveAttribute('aria-pressed', 'true')
  // Hebrew: letters, and the apostrophe it types on the W key.
  await press('א', 'KeyT', 84)
  await expect(tool('Text')).toHaveAttribute('aria-pressed', 'true')
  await press("'", 'KeyW', 87)
  await expect(tool('Whiteout')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')

  // Dvorak Ctrl+";" (the Z key) isn't undo; Ctrl+Z is.
  await selectTool(page, 'Checkmark', 'C')
  await clickPagePoint(page, 1, SAMPLE_SPOTS.allergiesYes, sizes[1])
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  const marks = page.locator('[data-element-id][data-kind="mark"]')
  await expect(marks).toHaveCount(1)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await press(';', 'KeyZ', 186, true)
  await expect(marks).toHaveCount(1)
  await press('z', 'KeyZ', 90, true)
  await expect(marks).toHaveCount(0)
  expect(errors).toEqual([])
})

/** A page of a Hebrew form (Arimo has Hebrew): its own text reads right to left. */
async function hebrewForm(path: string): Promise<string> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(await readFile(fileURLToPath(new URL('../src/assets/fonts/Arimo-Regular.ttf', import.meta.url))))
  const page = doc.addPage([595.28, 841.89])
  const lines = ['טופס בקשה', 'פרטי המבקש', 'שם משפחה', 'שם פרטי', 'מספר זהות', 'האם אתה תושב ישראל?']
  lines.forEach((line, i) => page.drawText(line, { x: 380, y: 780 - i * 40, size: 16, font }))
  await writeFile(path, await doc.save())
  return path
}

test('on a Hebrew form, the Items panel lists a row right to left, even with only ticks on it', async ({ page }, testInfo) => {
  const errors = trackPageErrors(page)
  const file = await hebrewForm(testInfo.outputPath('hebrew-form.pdf'))
  await gotoHome(page)
  await openPdf(page, file)
  await showPage(page, 0)
  const size = (await readViewSizes(file))[0]
  await selectTool(page, 'Checkmark', 'C')
  for (const x of [300, 500, 100]) await clickPagePoint(page, 0, { x, y: 300 }, size)
  await page.keyboard.press('Escape')
  const list = await itemsList(page)
  const rows = list.locator('[data-item-id]')
  await expect(rows).toHaveCount(3)
  const order = async () =>
    rows.evaluateAll((els) => els.map((el) => Math.round(document.querySelector(`[data-element-id="${el.getAttribute('data-item-id')}"]`)!.getBoundingClientRect().x)))
  await expect.poll(async () => {
    const xs = await order()
    return xs.every((x, i) => i === 0 || x < xs[i - 1])
  }).toBe(true)
  expect(errors).toEqual([])
})
