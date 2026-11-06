import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  SAMPLE_PDF,
  SAMPLE_SPOTS,
  clickPagePoint,
  gotoHome,
  openPdf,
  pdfPage,
  selectTool,
  showPage,
  trackPageErrors,
  typeAndCommit,
} from './support/app'
import { readViewSizes } from './support/pdf'

/**
 * Words that stay in Latin letters in the Hebrew interface: names (the logo writes "Fill" and "Flow"
 * apart), keys (the toasts' "alt+T" too), units, and the sample's file name.
 */
const KEEP_LATIN = /\b(FillFlow|Fill|Flow|GitHub|PDF\.js|pdf-lib|PDFs?|English|Ctrl|Shift|Alt|Esc|Enter|Tab|Space|Del|Backspace|sample-form(\.pdf)?|DD|MM|YYYY|pt)\b/gi

/**
 * Interface text in the frame written in `script`: visible text, accessible names and tooltips.
 * What the document holds is not interface: its pages, and its names and values shown in the frame
 * (field labels and options, the document's name), which keep their own direction (<bdi>,
 * dir="auto"). Nor are key caps.
 */
async function textIn(page: Page, script: 'latin' | 'hebrew'): Promise<string[]> {
  return page.evaluate(
    ({ keep, script }) => {
      const KEEP = new RegExp(keep, 'gi')
      // Text the interface quotes from the document or from people sits between isolates (FSI…PDI).
      const own = (text: string) => text.replace(/⁨[^⁩]*⁩/g, '').replace(KEEP, '')
      const found = script === 'latin' ? /[A-Za-z]{2,}/ : /[֐-׿]/
      const outside = (el: Element) => !el.closest('[data-page-index], kbd, [dir="ltr"], bdi, [dir="auto"], script, style')
      const visible = (el: Element) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
      }
      const out = new Set<string>()
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement
        const text = n.textContent ?? ''
        if (el && outside(el) && visible(el) && !el.closest('.sr-only') && found.test(own(text))) out.add(text.trim())
      }
      for (const el of document.body.querySelectorAll('[aria-label], [title], [placeholder]')) {
        if (!outside(el) || (!visible(el) && !el.closest('[role="dialog"], header, aside, [role="toolbar"]'))) continue
        for (const name of ['aria-label', 'title', 'placeholder']) {
          const value = el.getAttribute(name)
          if (value && found.test(own(value))) out.add(`${name}=${value}`)
        }
      }
      return [...out]
    },
    { keep: KEEP_LATIN.source, script },
  )
}

const box = async (locator: Locator) => (await locator.boundingBox())!

test.describe('in a Hebrew browser', () => {
  test.use({ locale: 'he-IL' })

  test('the home page is in Hebrew, right to left, and switches to English and back', async ({ page }) => {
    const errors = trackPageErrors(page)
    await gotoHome(page)
    const root = page.locator('html')
    await expect(root).toHaveAttribute('lang', 'he')
    await expect(root).toHaveAttribute('dir', 'rtl')
    await expect(page).toHaveTitle(/מילוי וחתימה/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('מלאו וחתמו')

    // Mirrored: the logo at the right, the site links at the left.
    const logo = await box(page.locator('header a').first())
    const nav = await box(page.locator('header nav'))
    expect(logo.x).toBeGreaterThan(nav.x + nav.width)
    expect(await textIn(page, 'latin')).toEqual([])

    // The choice is remembered.
    await page.getByRole('button', { name: 'English', exact: true }).click()
    await expect(root).toHaveAttribute('dir', 'ltr')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Fill & sign any PDF')
    await page.reload()
    await expect(root).toHaveAttribute('lang', 'en')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Fill & sign any PDF')
    expect(await textIn(page, 'hebrew')).toEqual([])

    await page.getByRole('button', { name: 'עברית', exact: true }).click()
    await expect(root).toHaveAttribute('dir', 'rtl')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('מלאו וחתמו')
    expect(errors).toEqual([])
  })

  test('the editor mirrors its frame, while the pages stay left to right', async ({ page }) => {
    const errors = trackPageErrors(page)
    await gotoHome(page)
    await openPdf(page, SAMPLE_PDF)
    await showPage(page, 0)

    // The pages area keeps the document's own left-to-right layout.
    const viewer = page.locator('[dir="ltr"]').filter({ has: page.locator('[data-page-index]') }).first()
    await expect(viewer).toBeVisible()
    const pages = await box(viewer)

    // Pages panel at the right, form and items at the left (both open on a wide screen).
    const [pagesPanel, inspector] = await Promise.all([box(page.locator('aside').first()), box(page.locator('aside').nth(1))])
    expect(pagesPanel.x).toBeGreaterThanOrEqual(pages.x + pages.width - 1)
    expect(inspector.x + inspector.width).toBeLessThanOrEqual(pages.x + 1)

    // The tool dock reads right to left: Select first, at the right.
    const tools = page.getByRole('toolbar').filter({ has: page.getByRole('button', { name: 'בחירה', exact: true }) }).first()
    const buttons = tools.getByRole('button')
    expect((await box(buttons.first())).x).toBeGreaterThan((await box(buttons.last())).x)

    // The download button is the top bar's, in Hebrew; the frame has no English left in it.
    await expect(page.getByRole('button', { name: 'הורדה', exact: true }).first()).toBeVisible()
    expect(await textIn(page, 'latin')).toEqual([])
    expect(errors).toEqual([])
  })
})

test('switching the language in the editor changes the whole frame at once', async ({ page }) => {
  const errors = trackPageErrors(page)
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 0)

  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'עברית' }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.getByRole('button', { name: 'הורדה', exact: true }).first()).toBeVisible()
  expect(await textIn(page, 'latin')).toEqual([])

  await page.getByRole('button', { name: 'עוד', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'English' }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await expect(page.getByRole('button', { name: 'Download', exact: true }).first()).toBeVisible()
  expect(await textIn(page, 'hebrew')).toEqual([])
  expect(errors).toEqual([])
})

test('what is placed on a page lands in the same place in both languages', async ({ browser }, info) => {
  const sizes = await readViewSizes(SAMPLE_PDF)
  const spots: { x: number; y: number; width: number; height: number }[] = []
  for (const [locale, textTool] of [
    ['en-US', 'Text'],
    ['he-IL', 'טקסט'],
  ]) {
    const { baseURL, viewport } = info.project.use
    const context = await browser.newContext({ baseURL, viewport, locale })
    const page = await context.newPage()
    await gotoHome(page)
    await openPdf(page, SAMPLE_PDF)
    await showPage(page, 1)
    await selectTool(page, textTool, 'T')
    await clickPagePoint(page, 1, SAMPLE_SPOTS.emergencyName, sizes[1])
    await typeAndCommit(page, 'ישראל Israel')
    const item = page.locator('[data-element-id][data-kind="text"]', { hasText: 'Israel' }).first()
    await expect(item).toBeVisible()
    const [frame, placed] = await Promise.all([box(await pdfPage(page, 1)), box(item)])
    // Relative to the page, in page widths: the zoom may differ by a hair.
    const k = 1 / frame.width
    spots.push({ x: (placed.x - frame.x) * k, y: (placed.y - frame.y) * k, width: placed.width * k, height: placed.height * k })
    await context.close()
  }
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(spots[1][key]).toBeCloseTo(spots[0][key], 3)
})
