import { readFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  SAMPLE_PDF,
  SAMPLE_SPOTS,
  clickPagePoint,
  expectFormFieldValue,
  fillFormField,
  fixture,
  formField,
  gotoHome,
  openPdf,
  selectTool,
  showPage,
  trackPageErrors,
  typeAndCommit,
} from './support/app'
import { readViewSizes } from './support/pdf'

/** What has keyboard focus: its accessible label (or text), its role, or "body". */
function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return 'body'
    return el.getAttribute('aria-label') ?? el.getAttribute('role') ?? el.textContent?.trim() ?? el.tagName
  })
}

/** A point just inside the start of a (left-to-right) text field's text. */
function textStart(input: Locator): Promise<{ x: number; y: number }> {
  return input.evaluate((el) => {
    const box = el.getBoundingClientRect()
    return { x: box.left + el.clientLeft + parseFloat(getComputedStyle(el).paddingLeft) + 1, y: box.top + box.height / 2 }
  })
}

/** A text field's selection, as [start, end]. */
function selection(input: Locator): Promise<(number | null)[]> {
  return input.evaluate((el) => [(el as HTMLInputElement).selectionStart, (el as HTMLInputElement).selectionEnd])
}

async function openSample(page: Page): Promise<void> {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 0)
}

/** Picks an item from the top bar's "More" menu with the keyboard. */
async function chooseFromMore(page: Page, item: string | RegExp): Promise<void> {
  await page.getByRole('button', { name: 'More' }).focus()
  await page.keyboard.press('Enter')
  const entry = page.getByRole('menuitem', { name: item })
  await expect(entry).toBeVisible()
  await entry.focus()
  await page.keyboard.press('Enter')
}

/**
 * How much of the focused field on a page (0 to 1) the floating tool dock covers, and how much is
 * out of sight (outside the visible part of the pages); null when focus isn't on a field on a page.
 */
function focusedFieldHidden(page: Page): Promise<{ underDock: number; outOfSight: number } | null> {
  return page.evaluate(() => {
    const box = document.activeElement?.closest('[data-page-index] [data-form-widget]')?.getBoundingClientRect()
    if (!box) return null
    const pages = document.querySelector('[role="region"][aria-label="Document pages"]')!
    const { left, top } = pages.getBoundingClientRect()
    const view = { left, top, right: left + pages.clientWidth, bottom: top + pages.clientHeight }
    const dock = document.querySelector('[role="toolbar"][aria-label="Tools"]')!.getBoundingClientRect()
    const share = (r: { left: number; top: number; right: number; bottom: number }) =>
      (Math.max(0, Math.min(box.right, r.right) - Math.max(box.left, r.left)) *
        Math.max(0, Math.min(box.bottom, r.bottom) - Math.max(box.top, r.top))) /
      (box.width * box.height)
    return { underDock: share(dock), outOfSight: 1 - share(view) }
  })
}

/** Waits until an element is done animating in (a sheet sliding, a menu scaling). */
function settled(target: Locator): Promise<void> {
  return target.evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((a) => a.finished))
  })
}

/** How far the pages are scrolled down. */
function pagesScrollTop(page: Page): Promise<number> {
  return page.getByRole('region', { name: 'Document pages' }).evaluate((el) => el.scrollTop)
}

/** Replaces a component's render function with one that throws (served by the dev server). */
async function crashComponent(page: Page, file: string, component: string): Promise<void> {
  await page.route(`**/src/${file}*`, async (route) => {
    const response = await route.fetch()
    const body = (await response.text()).replace(
      `export function ${component}(`,
      `export function ${component}() { throw new Error('Simulated crash') }\nfunction ${component}Original(`,
    )
    // Not cached: a reload must get the real module back.
    const { etag: _etag, ...headers } = response.headers()
    await route.fulfill({ response, body, headers: { ...headers, 'cache-control': 'no-store' } })
  })
}

test.describe('focus comes back to what opened a dialog', () => {
  test('dialogs and confirms', async ({ page }) => {
    await openSample(page)

    await page.getByRole('button', { name: 'Download', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect.poll(() => focused(page)).toBe('Download')

    await chooseFromMore(page, 'Keyboard shortcuts')
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect.poll(() => focused(page)).toBe('More')

    await page.getByRole('button', { name: 'Signature', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect.poll(() => focused(page)).toBe('Signature')

    await fillFormField(page, 'Full name', 'Ada Lovelace')
    await chooseFromMore(page, /Clear everything/)
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect.poll(() => focused(page)).toBe('More')
  })

  test('a confirm opened straight from a menu item gives focus to the menu button', async ({ page }) => {
    await openSample(page)
    await page.getByRole('button', { name: 'Back to home' }).click()
    await page.getByRole('button', { name: /^More options for/ }).first().focus()
    await page.keyboard.press('Enter')
    const remove = page.getByRole('menuitem', { name: /Remove from this device/ })
    await expect(remove).toBeVisible()
    await remove.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect.poll(() => focused(page)).toMatch(/^More options for/)
  })

  test('the sign-here field gets focus back after signing it', async ({ page }) => {
    await openSample(page)
    const field = page.getByRole('button', { name: /sign here/i }).first()
    await field.scrollIntoViewIfNeeded()
    await field.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('tab', { name: /type/i }).click()
    await dialog.getByRole('textbox').first().fill('Ada Lovelace')
    await page.keyboard.press('Enter')
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => focused(page)).toMatch(/signed/i)
  })

  test('a docked panel closed from inside hands focus to its toggle', async ({ page }) => {
    await openSample(page)
    await page.getByRole('button', { name: 'Hide panel' }).focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => focused(page)).toBe('Form & items')

    await page.getByRole('button', { name: 'Hide pages' }).focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => focused(page)).toBe('Pages')
  })

  test.describe('sheets', () => {
    test.use({ viewport: { width: 800, height: 900 } })

    test('take focus themselves and give it back on close', async ({ page }) => {
      await openSample(page)
      await page.getByRole('button', { name: 'Pages', exact: true }).focus()
      await page.keyboard.press('Enter')
      const sheet = page.getByRole('dialog', { name: 'Pages' })
      await expect(sheet).toBeVisible()
      // The sheet itself has focus, and its header has no invisible Tab stop.
      await expect.poll(() => focused(page)).toBe('dialog')
      await page.keyboard.press('Tab')
      await expect.poll(() => focused(page)).toBe('Close pages')
      const strayStops = await sheet.evaluate(
        (root) =>
          [...root.querySelectorAll('[tabindex="0"]')].filter(
            (el) => !el.getAttribute('role') && !['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName),
          ).length,
      )
      expect(strayStops).toBe(0)
      await page.keyboard.press('Escape')
      await expect.poll(() => focused(page)).toBe('Pages')

      await page.getByRole('button', { name: 'Form & items' }).focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect.poll(() => focused(page)).toBe('Form & items')
    })
  })

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 360, height: 760 } })

    test('a sheet opened from the menu gives focus back to the menu button', async ({ page }) => {
      await openSample(page)
      await chooseFromMore(page, 'Pages')
      await expect(page.getByRole('dialog', { name: 'Pages' })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect.poll(() => focused(page)).toBe('More')
    })
  })
})

test('side panel tab panels show keyboard focus; without a form there are no tabs', async ({ page }) => {
  await openSample(page)
  await page.getByRole('tab', { name: /^Form/ }).focus()
  for (let i = 0; i < 4 && (await focused(page)) !== 'tabpanel'; i++) await page.keyboard.press('Tab')
  expect(await focused(page)).toBe('tabpanel')
  const ring = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement!)
    return { style: style.outlineStyle, width: style.outlineWidth, offset: style.outlineOffset }
  })
  expect(ring).toEqual({ style: 'solid', width: '2px', offset: '-2px' })

  await openPdf(page, fixture('long.pdf'))
  await showPage(page, 0)
  await page.getByRole('button', { name: 'Items', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Items' })).toBeVisible()
  await expect(page.getByRole('tablist')).toHaveCount(0)
  await expect(page.getByRole('tabpanel')).toHaveCount(0)
})

test.describe('moving around the Form & items sheet', () => {
  test.use({ viewport: { width: 800, height: 900 } })

  /** Whether focus is on the sheet's last Tab stop. */
  function onLastTabStop(page: Page): Promise<boolean> {
    return page.getByRole('dialog').evaluate((sheet) => {
      const stops = [...sheet.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')].filter(
        (el) => el.tabIndex >= 0 && !el.matches(':disabled') && el.checkVisibility(),
      )
      return stops.length > 1 && stops.at(-1) === document.activeElement
    })
  }

  test('Shift+Tab goes from the tabs to the close button, then around to the end', async ({ page }) => {
    await openSample(page)
    await page.getByRole('button', { name: 'Form & items' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toBeVisible()
    const close = page.getByRole('button', { name: 'Close panel' })
    const formTab = page.getByRole('tab', { name: /^Form/ })
    await page.keyboard.press('Tab')
    await expect(close).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(formTab).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(close).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect.poll(() => onLastTabStop(page)).toBe(true)
    // First in Tab order, the close button still shows at the right end of the header.
    const [closeBox, tabsBox] = await Promise.all([close.boundingBox(), page.getByRole('tablist').boundingBox()])
    expect(closeBox!.x).toBeGreaterThan(tabsBox!.x + tabsBox!.width)
  })

  test('a click or Tab from one field to another lands on it', async ({ page }) => {
    await openSample(page)
    await page.getByRole('button', { name: 'Form & items' }).click()
    const field = (name: RegExp) => page.getByRole('dialog').getByRole('textbox', { name })
    const fullName = field(/^Full name/)
    await fullName.click()
    await page.keyboard.type('Ada Lovelace')
    // Leaving a field takes its "current field" marker away: focus must not drop to the sheet.
    await field(/^Email/).click()
    await expect(field(/^Email/)).toBeFocused()
    await page.keyboard.type('ada@example.com')
    await expect(field(/^Email/)).toHaveValue('ada@example.com')
    await page.keyboard.press('Shift+Tab')
    await expect(field(/^Date of birth/)).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(field(/^Email/)).toBeFocused()
    await expect(fullName).toHaveValue('Ada Lovelace')

    // The browser makes the move itself: the caret goes where the click is, ...
    const start = await textStart(fullName)
    await page.mouse.click(start.x, start.y)
    await page.keyboard.type('X')
    await expect(fullName).toHaveValue('XAda Lovelace')
    // ... Tab selects the whole value, ...
    await field(/^Date of birth/).click()
    await page.keyboard.press('Shift+Tab')
    await expect(fullName).toBeFocused()
    expect(await selection(fullName)).toEqual([0, 'XAda Lovelace'.length])
    // ... and a drag selects text.
    await field(/^Email/).click()
    const box = (await fullName.boundingBox())!
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 4, start.y, { steps: 5 })
    await page.mouse.up()
    expect(await selection(fullName)).toEqual([0, 'XAda Lovelace'.length])
  })

  test('after a press on a tab, Tab into the tab list goes to that tab', async ({ page }) => {
    await openSample(page)
    await page.getByRole('button', { name: 'Form & items' }).click()
    const itemsTab = page.getByRole('tab', { name: /^Items/ })
    await itemsTab.click()
    await expect(itemsTab).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Shift+Tab')
    await expect(page.getByRole('button', { name: 'Close panel' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(itemsTab).toBeFocused()
  })
})

test.describe('between the phone and tablet layouts', () => {
  test.use({ viewport: { width: 700, height: 900 } })

  test('zoom stays reachable from the menu, and the dock fits', async ({ page }) => {
    await openSample(page)
    await expect(page.getByRole('button', { name: 'Zoom in' })).toBeHidden()
    const pageWidth = () => page.evaluate(() => document.querySelector('[data-page-index="0"]')!.getBoundingClientRect().width)
    const before = await pageWidth()
    await page.getByRole('button', { name: 'More' }).click()
    await expect(page.getByRole('menuitem', { name: 'Zoom out' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Fit to width' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Zoom in' }).click()
    await expect.poll(pageWidth).toBeGreaterThan(before)
    // Zoom steps can be repeated: the menu stays open.
    await expect(page.getByRole('menu')).toBeVisible()
    await page.keyboard.press('Escape')

    await page.setViewportSize({ width: 640, height: 900 })
    await expect
      .poll(async () => {
        const box = await page.getByRole('toolbar', { name: 'Tools' }).boundingBox()
        return box !== null && box.x >= 16 && box.x + box.width <= 640 - 16
      })
      .toBe(true)
  })
})

test.describe('on a short touch screen', () => {
  test.use({ viewport: { width: 667, height: 375 }, isMobile: true, hasTouch: true })

  test('the More menu stays on screen and scrolls to its last items', async ({ page }) => {
    await openSample(page)
    const more = page.getByRole('button', { name: 'More' })
    const menu = page.getByRole('menu')
    const close = menu.getByRole('menuitem', { name: 'Close document' })

    await more.focus()
    await page.keyboard.press('Enter')
    await expect(menu).toBeVisible()
    await menu.evaluate(async (el) => {
      await Promise.all(el.getAnimations().map((a) => a.finished))
    })
    const box = (await menu.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(375)
    // Keys scroll the item they move to into view.
    await page.keyboard.press('End')
    await expect(close).toBeFocused()
    await expect(close).toBeInViewport({ ratio: 1 })
    await page.keyboard.press('Escape')

    await more.tap()
    await expect(menu).toBeVisible()
    await close.scrollIntoViewIfNeeded()
    await expect(close).toBeInViewport({ ratio: 1 })
    await close.tap()
    await expect(page.getByRole('button', { name: /try a sample form/i })).toBeVisible()
  })
})

test.describe('toasts and modals on a phone', () => {
  test.use({ viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true })

  test('passing toasts are cleared when a sheet opens; errors stay and can be pressed', async ({ page }) => {
    await openSample(page)
    const hint = page.locator('[data-sonner-toast]').filter({ hasText: /fillable fields/ })
    await expect(hint).toBeVisible()
    await page.getByRole('button', { name: 'More' }).tap()
    await page.getByRole('menuitem', { name: /Form & items/ }).tap()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(hint).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // A dropped non-PDF reports an error; it stays up over a sheet, where a tap on it hits the toast.
    await page.evaluate(() => {
      const dt = new DataTransfer()
      dt.items.add(new File(['x'], 'notes.txt', { type: 'text/plain' }))
      for (const type of ['dragenter', 'dragover', 'drop'])
        document.body.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }))
    })
    const error = page.locator('[data-sonner-toast][data-type="error"]')
    await expect(error).toBeVisible()
    await page.getByRole('button', { name: 'More' }).tap()
    await page.getByRole('menuitem', { name: 'Pages' }).tap()
    await expect(page.getByRole('dialog', { name: 'Pages' })).toBeVisible()
    await expect(error).toBeVisible()
    const box = (await error.boundingBox())!
    const hitsToast = await page.evaluate(
      ([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-sonner-toast]'),
      [box.x + box.width / 2, box.y + box.height / 2],
    )
    expect(hitsToast).toBe(true)
  })

  test('a tap from one field to another in a sheet puts the caret where it is', async ({ page }) => {
    await openSample(page)
    await page.getByRole('button', { name: 'More' }).tap()
    await page.getByRole('menuitem', { name: /Form & items/ }).tap()
    const field = (name: RegExp) => page.getByRole('dialog').getByRole('textbox', { name })
    const fullName = field(/^Full name/)
    await fullName.tap()
    await page.keyboard.type('Ada Lovelace')
    await field(/^Email/).tap()
    await expect(field(/^Email/)).toBeFocused()
    const start = await textStart(fullName)
    await page.touchscreen.tap(start.x, start.y)
    await page.keyboard.type('X')
    await expect(fullName).toHaveValue('XAda Lovelace')
  })
})

/** WCAG contrast ratio of two `#rrggbb` colors. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** `fg` at `alpha` over `bg`, as `#rrggbb`. */
function over(fg: string, bg: string, alpha: number): string {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const top = rgb(fg)
  return `#${rgb(bg)
    .map((c, i) => Math.round(top[i] * alpha + c * (1 - alpha)).toString(16).padStart(2, '0'))
    .join('')}`
}

/**
 * An element's text color and the color painted behind it, as `#rrggbb`: its computed
 * backgrounds, from the root down (translucent, in any color space), composited on a canvas.
 */
function paintedColors(locator: Locator): Promise<{ fg: string; bg: string }> {
  return locator.evaluate((el) => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
    const paint = (colors: string[]) => {
      for (const color of ['#fff', ...colors]) {
        ctx.fillStyle = color
        ctx.fillRect(0, 0, 1, 1)
      }
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
      return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
    }
    const layers: string[] = []
    for (let n: Element | null = el; n; n = n.parentElement) layers.unshift(getComputedStyle(n).backgroundColor)
    return { fg: paint([...layers, getComputedStyle(el).color]), bg: paint(layers) }
  })
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`small secondary and status text meets WCAG AA in the ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme })
    await gotoHome(page)
    const t = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      const names = ['canvas', 'surface', 'surface-2', 'surface-3', 'fg-muted', 'fg-subtle', 'success', 'warning']
      return Object.fromEntries(names.map((n) => [n, style.getPropertyValue(`--ff-${n}`).trim()]))
    })
    // The top bar is 85% surface over the canvas.
    const backgrounds = [t.surface, t['surface-2'], t['surface-3'], t.canvas, over(t.surface, t.canvas, 0.85)]
    for (const bg of backgrounds) {
      expect(contrast(t['fg-muted'], bg), `fg-muted on ${bg}`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(t['fg-subtle'], bg), `fg-subtle on ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
    // "Not saved" in the top bar; "N filled" badges and "Signed" / "Ready" lines on surfaces.
    expect(contrast(t.warning, backgrounds[4])).toBeGreaterThanOrEqual(4.5)
    for (const bg of [t.surface, t['surface-2']]) expect(contrast(t.success, bg)).toBeGreaterThanOrEqual(4.5)
  })

  test(`the side panel's tab counts meet WCAG AA in the ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme })
    await openSample(page)
    const tab = (name: string) => page.getByRole('tab', { name: new RegExp(`^${name}`) })
    for (const selected of ['Form', 'Items']) {
      await tab(selected).click()
      await expect(tab(selected)).toHaveAttribute('aria-selected', 'true')
      for (const name of ['Form', 'Items']) {
        const { fg, bg } = await paintedColors(tab(name).locator('span'))
        expect(contrast(fg, bg), `${name} count with ${selected} selected: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  test(`the home heading's colored words meet WCAG AA in the ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme })
    await gotoHome(page)
    const { ends, canvas } = await page
      .getByRole('heading', { level: 1 })
      .locator('em')
      .evaluate((em) => {
        const style = getComputedStyle(em)
        return {
          ends: ['--color-brand-blue', '--color-brand-teal'].map((name) => style.getPropertyValue(name).trim()),
          canvas: getComputedStyle(document.documentElement).getPropertyValue('--ff-canvas').trim(),
        }
      })
    // Large text (44px and up): 3:1 at both ends of the gradient.
    for (const end of ends) expect(contrast(end, canvas), `${end} on ${canvas}`).toBeGreaterThanOrEqual(3)
  })
}

test('the drop zone is named by the words it shows', async ({ page }) => {
  await gotoHome(page)
  await expect(page.getByRole('button', { name: /^Drop a PDF here Choose PDF$/ })).toBeVisible()
})

test('the home logo scrolls to the top without animating when motion is reduced', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await gotoHome(page)
  const scroller = page.locator('[data-home-scroll]')
  await scroller.evaluate((el) => el.scrollTo({ top: 600 }))
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  await page.getByRole('link', { name: 'FillFlow home' }).dispatchEvent('click')
  // One frame later a smooth scroll would still be on its way.
  const top = await scroller.evaluate((el) => new Promise<number>((r) => requestAnimationFrame(() => r(el.scrollTop))))
  expect(top).toBe(0)
})

test('a "Clear everything" from the menu says locked items stay', async ({ page }) => {
  const sizes = await readViewSizes(SAMPLE_PDF)
  await openSample(page)
  await selectTool(page, 'Text', 'T')
  await clickPagePoint(page, 1, SAMPLE_SPOTS.emergencyName, sizes[1])
  await typeAndCommit(page, 'Keep me')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+L' : 'Control+Shift+L')
  await fillFormField(page, 'Full name', 'Ada Lovelace')
  await chooseFromMore(page, /Clear everything/)
  const confirmDialog = page.getByRole('alertdialog')
  await expect(confirmDialog).toContainText('One locked item stays')
  await confirmDialog.getByRole('button', { name: 'Clear all' }).click()
  await expect(page.locator('[data-page-index="1"]').getByText('Keep me')).toBeVisible()
  // Everything, as it says: the form is back to how it was too (the Items panel's "Clear all items"
  // leaves the form alone).
  await expectFormFieldValue(page, 'Full name', '')
})

test('Ctrl/⌘+O opens another PDF on a Hebrew keyboard layout too', async ({ page }) => {
  // Listening from the start, so the file picker is caught by the time the key goes in (it goes
  // through a CDP session of its own, which doesn't wait for Playwright's).
  let pickers = 0
  page.on('filechooser', () => pickers++)
  await openSample(page)
  const before = pickers
  // A real key press on the O key, which types ם on that layout.
  const cdp = await page.context().newCDPSession(page)
  const key = { key: 'ם', code: 'KeyO', windowsVirtualKeyCode: 79, modifiers: process.platform === 'darwin' ? 4 : 2 }
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
  await expect.poll(() => pickers).toBe(before + 1)
})

test('a Hebrew file name keeps its own order inside the password prompt', async ({ page }) => {
  await gotoHome(page)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /Choose PDF/ }).click()
  await (await chooser).setFiles({
    name: '2024 טופס בקשה.pdf',
    mimeType: 'application/pdf',
    buffer: await readFile(fixture('password.pdf')),
  })
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Enter the password to open')
  // Isolated and right-to-left: the number sits at the right end of the name, as in the top bar.
  const order = await dialog.evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent ?? ''
      const digits = text.indexOf('2024')
      if (digits < 0 || !text.includes('ט')) continue
      const x = (start: number, end: number) => {
        const range = document.createRange()
        range.setStart(n!, start)
        range.setEnd(n!, end)
        return range.getBoundingClientRect().x
      }
      return { digits: x(digits, digits + 4), hebrew: x(text.indexOf('ט'), text.indexOf('ט') + 1) }
    }
    return null
  })
  expect(order).not.toBeNull()
  expect(order!.digits).toBeGreaterThan(order!.hebrew)
})

test.describe('crashes never leave a blank page', () => {
  test('a broken recent document record leaves the home screen working', async ({ page }) => {
    await gotoHome(page)
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const req = indexedDB.open('fillflow-recents')
          req.onupgradeneeded = () => req.result.createObjectStore('recents')
          req.onerror = () => reject(req.error)
          req.onsuccess = () => {
            const tx = req.result.transaction('recents', 'readwrite')
            // No name: written by another build or by hand.
            tx.objectStore('recents').put({ id: 'x', size: 1, pageCount: 1, addedAt: 1, openedAt: 1 }, 'x')
            tx.oncomplete = () => {
              req.result.close()
              resolve()
            }
            tx.onerror = () => reject(tx.error)
          }
        }),
    )
    await page.reload()
    await expect(page.getByRole('button', { name: /try a sample form/i })).toBeVisible()
  })

  test('a crash in the recent documents list only hides the list', async ({ page }) => {
    await crashComponent(page, 'features/home/RecentDocuments.tsx', 'RecentDocuments')
    await gotoHome(page)
    await expect(page.getByRole('button', { name: /try a sample form/i })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('a crash anywhere else shows a recovery screen that reloads', async ({ page }) => {
    await crashComponent(page, 'features/home/HomeHeader.tsx', 'HomeHeader')
    await page.goto('./')
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('Something went wrong')
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await alert.getByRole('button', { name: 'Reload' }).click()
    await expect(page.getByRole('button', { name: /try a sample form/i })).toBeVisible()
  })
})

for (const viewport of [
  { width: 1366, height: 657 },
  { width: 1536, height: 730 },
]) {
  test.describe(`Tab through the fields on the pages at ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport })

    test('shows each field whole, clear of the tool dock', async ({ page }) => {
      await openSample(page)
      const hint = page.locator('[data-sonner-toast]').filter({ hasText: /fillable fields/ })
      await expect(hint).toBeVisible()
      await page.getByRole('region', { name: 'Document pages' }).focus()
      let fields = 0
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press('Tab')
        const hidden = await focusedFieldHidden(page)
        if (hidden === null) break
        fields++
        expect(hidden, await focused(page)).toEqual({ underDock: 0, outOfSight: 0 })
        // Once a field is in use, the hint about the fields makes way for them.
        if (fields === 1) await expect(hint).toHaveCount(0)
      }
      // Text boxes, a text area, radio buttons, checkboxes, a list.
      expect(fields).toBeGreaterThanOrEqual(12)
    })
  })
}

test.describe('at 1920×947', () => {
  test.use({ viewport: { width: 1920, height: 947 } })

  test('a press on a drop-down or a list low beside the tool dock leaves the pages where they are', async ({ page }) => {
    await openSample(page)
    for (const [name, side] of [
      ['Country', 'left'],
      ['Referral', 'right'],
    ] as const) {
      const select = (await formField(page, name)).locator('select')
      // Its bottom just above the pages' bottom edge, in the strip the dock floats over; pressed
      // beside the dock, where all of it shows.
      const at = await select.evaluate((el, side) => {
        const pages = document.querySelector('[role="region"][aria-label="Document pages"]')!
        pages.scrollTop += el.getBoundingClientRect().bottom - (pages.getBoundingClientRect().top + pages.clientHeight - 20)
        const box = el.getBoundingClientRect()
        const point = { x: side === 'left' ? box.left + 20 : box.right - 20, y: box.bottom - 12 }
        return { ...point, onIt: el.contains(document.elementFromPoint(point.x, point.y)) }
      }, side)
      expect(at.onIt).toBe(true)
      const before = await pagesScrollTop(page)
      // The drop-down opens, the list takes focus: neither moves the pages under the pointer.
      await page.mouse.click(at.x, at.y)
      await expect(select).toBeFocused()
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
      expect(await pagesScrollTop(page), name).toBe(before)
      await page.keyboard.press('Escape')
    }
  })
})

test('Tab into a field wider than the view brings in the end its text sits at', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 657 })
  await gotoHome(page)
  await openPdf(page, fixture('form-basic.pdf'))
  await showPage(page, 0)
  const name = (await formField(page, 'Name')).locator('input')
  const hebrewName = (await formField(page, 'Hebrew name')).locator('input')
  await page.getByRole('button', { name: /^Zoom level/ }).click()
  await page.getByRole('menuitemradio', { name: '300%' }).click()
  // The field is right-aligned: Hebrew starts at its right edge, and Latin text sits there too.
  for (const value of ['ישראל כהן', 'Israel Cohen']) {
    await hebrewName.fill(value)
    await name.focus()
    await page.keyboard.press('Tab')
    await expect(hebrewName).toBeFocused()
    const { field, text, view } = await hebrewName.evaluate((el) => {
      const pages = document.querySelector('[role="region"][aria-label="Document pages"]')!
      const left = pages.getBoundingClientRect().left
      const box = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      return {
        field: box.width,
        text: box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
        view: { left, right: left + pages.clientWidth },
      }
    })
    expect(field).toBeGreaterThan(view.right - view.left)
    expect(text, value).toBeLessThanOrEqual(view.right)
  }
})

test('a field that gets focus back with the window stays where the user left it', async ({ page }) => {
  await openSample(page)
  await page.getByRole('region', { name: 'Document pages' }).focus()
  await page.keyboard.press('Tab')
  // The field right at the top edge of the pages, where moving to it would bring it down a little.
  await page.evaluate(() => {
    const pages = document.querySelector('[role="region"][aria-label="Document pages"]')!
    const field = document.activeElement!.closest('[data-form-widget]')!
    pages.scrollTop += field.getBoundingClientRect().top - pages.getBoundingClientRect().top - 4
  })
  const before = await pagesScrollTop(page)
  // The window loses focus (the field stays the document's focused element), then gets it back: the
  // browser hands it back to the same field.
  await page.evaluate(() => {
    const field = document.activeElement as HTMLElement
    window.dispatchEvent(new FocusEvent('blur'))
    field.blur()
    field.focus()
  })
  expect(await pagesScrollTop(page)).toBe(before)
  // Moved to with the keyboard, it comes clear of the edge.
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect.poll(() => pagesScrollTop(page)).toBeLessThan(before)
})

test.describe('on a phone held sideways', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true })

  test('Tab to a field under the tool dock brings it clear', async ({ page }) => {
    await openSample(page)
    await (await formField(page, 'Phone')).locator('input').tap()
    await page.keyboard.press('Tab')
    await expect.poll(() => focused(page)).toBe('Home address')
    expect(await focusedFieldHidden(page)).toEqual({ underDock: 0, outOfSight: 0 })
  })

  test('a field being typed into stays clear of the tool dock when the keyboard shrinks the page', async ({ page }) => {
    await openSample(page)
    const dock = page.getByRole('toolbar', { name: 'Tools' })
    const email = (await formField(page, 'Email')).locator('input')
    await email.tap()
    await page.keyboard.type('dana@example.com')
    // Held sideways, a phone is this short in a browser anyway, its bars taking the rest, keyboard open
    // or not (most browsers lay it over the page): the tools stay.
    await page.setViewportSize({ width: 915, height: 332 })
    await expect(email).toBeFocused()
    await expect(dock).toBeVisible()
    // A keyboard that shrinks the page (in-app browsers do), then the browser's own scroll to what has
    // focus. With half the screen gone, the dock makes way while typing.
    await page.setViewportSize({ width: 844, height: 190 })
    await email.evaluate((el) => el.scrollIntoView({ block: 'nearest' }))
    await expect(dock).toBeHidden()
    expect(await focusedFieldHidden(page)).toEqual({ underDock: 0, outOfSight: 0 })

    // On to the next field with Tab, or with the keyboard's Next key (Enter): all of it shows.
    const phone = (await formField(page, 'Phone')).locator('input')
    for (const key of ['Tab', 'Enter']) {
      await phone.focus()
      await page.keyboard.press(key)
      await expect.poll(() => focused(page)).toBe('Home address')
      await expect.poll(() => focusedFieldHidden(page), key).toEqual({ underDock: 0, outOfSight: 0 })
    }

    // Done typing, the dock is back: the keyboard closed (the field keeps focus), or focus moved on.
    await page.setViewportSize({ width: 844, height: 390 })
    await expect(dock).toBeVisible()
    await page.setViewportSize({ width: 844, height: 190 })
    await expect(dock).toBeHidden()
    await page.evaluate(() => (document.activeElement as HTMLElement).blur())
    await expect(dock).toBeVisible()

    // A read-only box opens no keyboard: the dock stays.
    await email.evaluate((el) => el.setAttribute('readonly', ''))
    await email.focus()
    await expect(email).toBeFocused()
    await expect(dock).toBeVisible()
  })

  test('controls keep clear of the notch and the rounded corners', async ({ page }) => {
    const inset = 47
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { left: inset, right: inset, top: 0, bottom: 21 } })
    /** The controls in `scope` that reach into the left or right safe area. */
    const inSafeAreas = (scope: Locator, controls = 'a, button, input, textarea, [role="menuitem"], [role="menuitemradio"]') =>
      scope.evaluate(
        (root, { controls, inset }) =>
          [...root.querySelectorAll(controls)].flatMap((el) => {
            const box = el.getBoundingClientRect()
            if (!box.width || (box.left >= inset && box.right <= innerWidth - inset)) return []
            return [`${el.getAttribute('aria-label') ?? el.textContent?.trim()} at ${Math.round(box.left)}–${Math.round(box.right)}`]
          }),
        { controls, inset },
      )

    await gotoHome(page)
    // The logo link's padding may reach past its logo: the logo is what counts.
    expect(await inSafeAreas(page.getByRole('banner'), 'svg, nav a, nav [role="radio"]')).toEqual([])

    await openPdf(page, SAMPLE_PDF)
    await showPage(page, 0)
    expect(await inSafeAreas(page.getByRole('banner'))).toEqual([])
    await page.getByRole('button', { name: 'More' }).tap()
    const menu = page.getByRole('menu')
    await settled(menu)
    expect(await inSafeAreas(menu)).toEqual([])
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Pages', exact: true }).tap()
    const pagesSheet = page.getByRole('dialog', { name: 'Pages' })
    await settled(pagesSheet)
    await expect(pagesSheet.getByRole('button', { name: /^Page 1/ })).toBeVisible()
    expect(await inSafeAreas(pagesSheet)).toEqual([])
    await page.keyboard.press('Escape')
    await expect(pagesSheet).toHaveCount(0)

    await page.getByRole('button', { name: 'Form & items' }).tap()
    const formSheet = page.getByRole('dialog', { name: 'Form and items' })
    await settled(formSheet)
    await expect(formSheet.getByRole('button', { name: 'Next empty field' })).toBeVisible()
    expect(await inSafeAreas(formSheet)).toEqual([])
  })
})

test.describe('on a touch phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('menus and tool choices show no keyboard shortcuts', async ({ page }) => {
    await openSample(page)
    await page.getByRole('button', { name: 'More' }).tap()
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: /Zoom in/ })).toBeVisible()
    expect(await menu.innerText()).not.toMatch(/Ctrl|⌘/)
    await page.keyboard.press('Escape')

    const shapes = page.getByRole('button', { name: 'Shapes' })
    await shapes.scrollIntoViewIfNeeded()
    await shapes.tap()
    const choices = page.getByRole('dialog')
    await expect(choices.getByRole('button', { name: /Rectangle/ })).toBeVisible()
    await expect(choices.locator('kbd').filter({ visible: true })).toHaveCount(0)
  })

  test('the tabs of the Form & items sheet are 40px targets', async ({ page }) => {
    await openSample(page)
    await page.getByRole('button', { name: 'More' }).tap()
    await page.getByRole('menuitem', { name: 'Form & items' }).tap()
    const sheet = page.getByRole('dialog', { name: 'Form and items' })
    await settled(sheet)
    const tabs = sheet.getByRole('tab')
    await expect(tabs).toHaveCount(2)
    for (const tab of await tabs.all()) expect((await tab.boundingBox())!.height, (await tab.textContent()) ?? '').toBeGreaterThanOrEqual(40)
  })
})

test('shortcuts that open something wait while the More menu is open', async ({ page }) => {
  let pickers = 0
  page.on('filechooser', () => pickers++)
  await openSample(page)
  const before = pickers
  // Whether the last key's default action (the browser's own Save page / Open file) was stopped.
  await page.evaluate(() => {
    window.addEventListener('keydown', (e) => document.documentElement.setAttribute('data-key-stopped', String(e.defaultPrevented)))
  })
  const more = page.getByRole('button', { name: 'More' })
  const menu = page.getByRole('menu')
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  for (const key of [`${mod}+o`, `${mod}+s`, '?']) {
    await more.focus()
    await page.keyboard.press('Enter')
    await expect(menu).toBeVisible()
    await page.keyboard.press(key)
    if (key !== '?') await expect(page.locator('html')).toHaveAttribute('data-key-stopped', 'true')
    // Nothing opened under the menu (where the menu would stay stuck open over it): one Escape
    // closes the menu, and focus is back on its button.
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(more).toBeFocused()
  }
  expect(pickers).toBe(before)
})

test('Tab and Shift+Tab move between the shortcut list and the close button, both shown focused', async ({ page }) => {
  await openSample(page)
  await page.keyboard.press('?')
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  const list = dialog.getByRole('region', { name: 'Shortcut list' })
  const close = dialog.getByRole('button', { name: 'Close' })
  const ringed = (target: Locator) => target.evaluate((el) => el.matches(':focus-visible') && getComputedStyle(el).outlineStyle !== 'none')
  await expect(list).toBeFocused()
  expect(await ringed(list)).toBe(true)
  for (const [key, target] of [
    ['Tab', close],
    ['Tab', list],
    ['Shift+Tab', close],
    ['Shift+Tab', list],
  ] as const) {
    await page.keyboard.press(key)
    await expect(target).toBeFocused()
    expect(await ringed(target), key).toBe(true)
  }
})

test('the home headings nest: the feature tiles have a section heading of their own', async ({ page }) => {
  /** The headings in reading order, as screen readers list them: "level name". */
  const outline = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => `${h.tagName[1]} ${h.textContent?.replace(/\s+/g, ' ').trim()}`),
    )
  const hero = '1 Fill & sign any PDF, right in your browser.'
  const tiles = ['3 Fill any form', '3 Sign in seconds', '3 Private by design', '3 Pick up where you left off']
  await gotoHome(page)
  await expect(page.getByRole('region', { name: 'Why FillFlow' })).toBeVisible()
  expect(await outline()).toEqual([hero, '2 Why FillFlow', ...tiles])

  // With a recent document, its list comes first, as a section of its own.
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 0)
  await page.getByRole('button', { name: 'Back to home' }).click()
  await expect(page.getByRole('heading', { name: 'Recent documents' })).toBeVisible()
  expect(await outline()).toEqual([hero, '2 Recent documents', '2 Why FillFlow', ...tiles])
})

test.describe('the Date tool', () => {
  test.use({ locale: 'en-US' })

  test('offers its formats written as today, and inserts and remembers the one picked', async ({ page }) => {
    // 5 November: day-first and month-first give two different dates.
    await page.clock.setFixedTime(new Date(2026, 10, 5, 12))
    const sizes = await readViewSizes(SAMPLE_PDF)
    await openSample(page)
    const tool = page.getByRole('button', { name: 'Date', exact: true })
    await tool.click()
    // The tool is on at once (the next click on a page inserts the date), its formats on show.
    await expect(tool).toHaveAttribute('aria-pressed', 'true')
    const formats = page.getByRole('dialog', { name: 'Date format' })
    const options = formats.getByRole('button')
    const names = ['05/11/2026 (DD/MM/YYYY)', '11/05/2026 (MM/DD/YYYY)', '2026-11-05 (YYYY-MM-DD)', '05.11.2026 (DD.MM.YYYY)', '5 Nov 2026', 'November 5, 2026']
    await expect(options).toHaveCount(names.length)
    for (const [i, name] of names.entries()) await expect(options.nth(i)).toHaveAccessibleName(name)
    // The tool's hint makes way for the list.
    const hint = page.getByRole('status').filter({ hasText: /today/ })
    await expect(hint).toHaveCSS('opacity', '0')

    await formats.getByRole('button', { name: '05.11.2026 (DD.MM.YYYY)' }).click()
    await expect(formats).toHaveCount(0)
    await expect(hint).toHaveCSS('opacity', '1')
    await clickPagePoint(page, 1, SAMPLE_SPOTS.emergencyName, sizes[1])
    await expect(page.locator('[data-page-index="1"]').getByText('05.11.2026', { exact: true })).toBeVisible()

    // Remembered for next time.
    await openSample(page)
    await tool.click()
    await expect(formats.getByRole('button', { name: '05.11.2026 (DD.MM.YYYY)' })).toHaveAttribute('aria-pressed', 'true')
  })
})

test('a tool picked from the dock with the keyboard adds its item with the next Enter', async ({ page }) => {
  await openSample(page)
  const pages = page.getByRole('region', { name: 'Document pages' })
  const dock = page.getByRole('toolbar', { name: 'Tools' })
  const hint = page.getByRole('status').filter({ has: page.locator('kbd') })
  const items = (kind: string) => page.locator(`[data-element-id][data-kind="${kind}"]`)
  /** Presses a dock button with Enter, as once Tab has reached it. */
  const press = async (name: string) => {
    await dock.getByRole('button', { name, exact: true }).focus()
    await page.keyboard.press('Enter')
  }

  // The shortcut list has it.
  await page.keyboard.press('?')
  const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(shortcuts.getByText('Add the active tool’s item in the middle of the view')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(shortcuts).toHaveCount(0)

  // A tool of its own: focus goes on to the pages, where Enter adds its item (on the button, Enter
  // would only press it again). The hint says so.
  await press('Checkmark')
  await expect(pages).toBeFocused()
  await expect(hint.locator('kbd')).toHaveText(['Enter', 'Esc'])
  await expect(hint).toContainText('to add')
  await page.keyboard.press('Enter')
  await expect(items('mark')).toHaveCount(1)
  await page.keyboard.press('Escape')

  // A shape picked from the Shapes list.
  await press('Shapes')
  const shapes = page.getByRole('dialog', { name: 'Shapes' })
  await expect(shapes.getByRole('button', { name: /^Rectangle/ })).toBeFocused()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(shapes).toHaveCount(0)
  await expect(pages).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(items('shape')).toHaveCount(1)
  await page.keyboard.press('Escape')

  // A date format.
  await press('Date')
  const formats = page.getByRole('dialog', { name: 'Date format' })
  await expect(formats.getByRole('button', { pressed: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(formats).toHaveCount(0)
  await expect(pages).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(items('text')).toHaveCount(1)
  await page.keyboard.press('Escape')

  // A signature made in its dialog, used with Enter. The message and the hint say Enter places it.
  await press('Signature')
  const dialog = page.getByRole('dialog', { name: 'Add your signature' })
  await dialog.getByRole('tab', { name: 'Type' }).focus()
  await dialog.getByLabel('Your full name').focus()
  await page.keyboard.type('Ada Lovelace')
  await dialog.getByRole('button', { name: 'Use signature' }).focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(pages).toBeFocused()
  await expect(page.locator('[data-sonner-toast]', { hasText: 'Click where you want to place it, or press Enter' })).toBeVisible()
  await expect(hint).toContainText('Click to place your signature')
  await expect(hint).toContainText('to place')
  await page.keyboard.press('Enter')
  await expect(items('image')).toHaveCount(1)

  // A saved one, picked from the dock's list.
  await press('Signature')
  const saved = page.getByRole('dialog', { name: 'Saved signatures' })
  await expect(saved.getByRole('button', { name: /^Place signature saved/ })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(saved).toHaveCount(0)
  await expect(pages).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(items('image')).toHaveCount(2)

  // A picture, once chosen.
  const chooser = page.waitForEvent('filechooser')
  await press('Image')
  await (await chooser).setFiles({
    name: 'stamp.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#b91c1c"/></svg>'),
  })
  await expect(pages).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(items('image')).toHaveCount(3)
})

/** Shows a message with the app's own `toast` (the module the app loaded, so its toasters show it). */
async function showToast(page: Page, message: string, options: Record<string, unknown> = {}): Promise<void> {
  const url = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => /\/deps\/sonner\.js(\?|$)/.test(name))
      .pop(),
  )
  if (!url) throw new Error('The app has not loaded sonner')
  await page.evaluate(
    async ({ url, message, options }) => {
      const { toast } = await import(/* @vite-ignore */ url)
      toast(message, options)
    },
    { url, message, options },
  )
}

test('the dock’s lists clear passing messages out of their way, and leave up those that stay until acted on', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openSample(page)
  // One signature saved, so the Signature button opens its list.
  await page.getByRole('button', { name: 'Signature', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add your signature' })
  await dialog.getByRole('tab', { name: 'Type' }).click()
  await dialog.getByLabel('Your full name').fill('Ada Lovelace')
  await dialog.getByRole('button', { name: 'Use signature' }).click()
  await expect(dialog).toHaveCount(0)
  await page.keyboard.press('Escape') // don't place it

  const shown = page.locator('[data-sonner-toast]:not([data-removed="true"])')
  for (const [tool, list] of [
    ['Shapes', 'Shapes'],
    ['Date', 'Date format'],
    ['Signature', 'Saved signatures'],
  ]) {
    await showToast(page, 'A passing message')
    // Not an error: whatever its kind, a message in the stack of those that stay until acted on stays.
    await showToast(page, 'A message that stays', { id: 'stays', toasterId: 'staying', duration: Infinity })
    await expect(shown.filter({ hasText: 'A passing message' })).toBeVisible()
    await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: tool, exact: true }).click()
    await expect(page.getByRole('dialog', { name: list })).toBeVisible()
    await expect(shown.filter({ hasText: 'A passing message' }), tool).toHaveCount(0)
    await expect(shown.filter({ hasText: 'A message that stays' }), tool).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: list })).toHaveCount(0)
  }
  expect(errors).toEqual([])
})

/** The names Chrome gives the dialogs on screen (popovers are dialogs too), as screen readers get them. */
async function dialogNames(page: Page): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page)
  const { nodes } = await cdp.send('Accessibility.getFullAXTree')
  await cdp.detach()
  return nodes.filter((node) => !node.ignored && node.role?.value === 'dialog').map((node) => String(node.name?.value ?? ''))
}

test('the Shapes list and a color list are named as written', async ({ page }) => {
  const sizes = await readViewSizes(SAMPLE_PDF)
  await openSample(page)
  await page.getByRole('button', { name: 'Shapes', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Rectangle/ })).toBeVisible()
  expect(await dialogNames(page)).toEqual(['Shapes'])
  await page.keyboard.press('Escape')

  await selectTool(page, 'Text', 'T')
  await clickPagePoint(page, 1, SAMPLE_SPOTS.emergencyName, sizes[1])
  await typeAndCommit(page, 'Ada')
  await page.getByRole('button', { name: 'Text color' }).click()
  await expect(page.getByRole('radiogroup', { name: 'Text color' })).toBeVisible()
  // Not "TEXT COLOR", as its caption shows it.
  expect(await dialogNames(page)).toEqual(['Text color'])
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`in forced colors (${colorScheme}), the corner caret of a tool with choices is drawn in its button’s colors`, async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active', colorScheme })
    await openSample(page)
    const color = (el: Locator) => el.evaluate((node) => getComputedStyle(node).color)
    const shapes = page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Shapes', exact: true })
    // Next to the button, not in it: it doesn't follow the button's colors by itself.
    const caret = shapes.locator('xpath=following-sibling::*[local-name()="svg"]')
    expect(await color(caret)).toBe(await color(shapes))
    // On: the button is drawn in the highlight colors (once its color has changed over).
    await page.keyboard.press('r')
    await expect(shapes).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => color(shapes)).toBe(await color(caret))
    expect(await color(caret)).not.toBe(await color(page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Pan', exact: true })))
  })
}
