import { readFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  SAMPLE_PDF,
  SAMPLE_SPOTS,
  clickPagePoint,
  fillFormField,
  fixture,
  gotoHome,
  openPdf,
  selectTool,
  showPage,
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
    await chooseFromMore(page, /Clear all items/)
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

test('a "Clear all items" from the menu says locked items stay', async ({ page }) => {
  const sizes = await readViewSizes(SAMPLE_PDF)
  await openSample(page)
  await selectTool(page, 'Text', 'T')
  await clickPagePoint(page, 1, SAMPLE_SPOTS.emergencyName, sizes[1])
  await typeAndCommit(page, 'Keep me')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+L' : 'Control+Shift+L')
  await fillFormField(page, 'Full name', 'Ada Lovelace')
  await chooseFromMore(page, /Clear all items/)
  const confirmDialog = page.getByRole('alertdialog')
  await expect(confirmDialog).toContainText('One locked item stays')
  await confirmDialog.getByRole('button', { name: 'Clear all' }).click()
  await expect(page.locator('[data-page-index="1"]').getByText('Keep me')).toBeVisible()
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
