/// <reference lib="dom" />
import { expect, test, type Locator, type Page } from '@playwright/test'
import { OPEN_OVERLAY } from '../src/components/ui/modal'
import { SAMPLE_PDF, formField, gotoHome, openPdf, showPage, trackPageErrors, typeAndCommit } from './support/app'

// The shared building blocks (buttons, menus, dialogs, sheets, segmented controls, swatches,
// switches): touch targets, keyboard hints, forced colors, names, contrast and safe areas.

test.use({ reducedMotion: 'reduce' })

async function openSample(page: Page): Promise<Locator> {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  return showPage(page, 0)
}

/** Places a text item on the first page and leaves it selected, its toolbar showing. */
async function addText(page: Page, sheet: Locator, touch = false): Promise<void> {
  const tool = page.getByRole('button', { name: 'Text', exact: true })
  if (touch) await tool.tap()
  else await tool.click()
  const box = (await sheet.boundingBox())!
  const at = { x: box.x + box.width * 0.3, y: box.y + Math.min(box.height * 0.3, 260) }
  if (touch) await page.touchscreen.tap(at.x, at.y)
  else await page.mouse.click(at.x, at.y)
  await typeAndCommit(page, 'Hello')
  await expect(page.getByRole('toolbar', { name: 'Item options' })).toBeVisible()
}

/** The area around an element's center that a press reaches it in (its box, or more). */
function hitArea(el: Locator): Promise<{ width: number; height: number }> {
  return el.evaluate((node) => {
    const r = node.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const hits = (x: number, y: number) => {
      const t = document.elementFromPoint(x, y)
      return !!t && (t === node || node.contains(t))
    }
    const reach = (dx: number, dy: number) => {
      let n = 0
      while (n < 80 && hits(cx + dx * (n + 1), cy + dy * (n + 1))) n++
      return n
    }
    return { width: reach(-1, 0) + reach(1, 0) + 1, height: reach(0, -1) + reach(0, 1) + 1 }
  })
}

async function expectTarget(el: Locator, min = 40): Promise<void> {
  const box = await el.boundingBox()
  const name = (await el.getAttribute('aria-label')) ?? (await el.innerText())
  expect(box, name).not.toBeNull()
  expect.soft(Math.round(box!.width), `${name}: width`).toBeGreaterThanOrEqual(min)
  expect.soft(Math.round(box!.height), `${name}: height`).toBeGreaterThanOrEqual(min)
}

test.describe('on a touch phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

  test('buttons, menu rows, segmented options and dialog close buttons are 40px targets; menus show no keys', async ({ page }) => {
    const errors = trackPageErrors(page)
    await openSample(page)
    for (const name of ['Back to home', 'Undo', 'Redo', 'Download', 'More']) await expectTarget(page.getByRole('button', { name, exact: true }))

    await page.getByRole('button', { name: 'More', exact: true }).tap()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    const rows = menu.getByRole('menuitem').filter({ visible: true })
    expect(await rows.count()).toBeGreaterThan(4)
    for (const row of await rows.all()) expect.soft((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    // "Open another PDF…" has Ctrl+O, the zoom rows Ctrl++ and so on: none means anything here.
    await expect(menu.getByRole('menuitem', { name: /open another pdf/i })).toBeVisible()
    expect(await menu.innerText()).not.toMatch(/Ctrl|⌘/)
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)

    await page.getByRole('button', { name: 'Signature', exact: true }).tap()
    const dialog = page.getByRole('dialog', { name: /add your signature/i })
    await expect(dialog).toBeVisible()
    await expectTarget(dialog.getByRole('button', { name: 'Close', exact: true }))
    const pens = dialog.getByRole('radiogroup', { name: 'Pen width' }).getByRole('radio')
    await expect(pens).toHaveCount(3)
    for (const pen of await pens.all()) await expectTarget(pen)
    expect(errors).toEqual([])
  })

  test('color swatches are 40px targets that don’t overlap', async ({ page }) => {
    const sheet = await openSample(page)
    await addText(page, sheet, true)
    await page.getByRole('button', { name: 'Text color' }).tap()
    const swatches = page.getByRole('radiogroup', { name: 'Text color' })
    await expect(swatches).toBeVisible()
    const targets = [...(await swatches.getByRole('radio').all()), swatches.getByLabel('Custom color')]
    expect(targets.length).toBeGreaterThan(5)
    for (const target of targets) {
      const area = await hitArea(target)
      expect.soft(area.width, `${await target.getAttribute('aria-label')}: width`).toBeGreaterThanOrEqual(40)
      expect.soft(area.height, `${await target.getAttribute('aria-label')}: height`).toBeGreaterThanOrEqual(40)
    }
    // The popover still fits the screen.
    const popover = (await page.getByRole('dialog', { name: 'Text color' }).boundingBox())!
    expect(popover.x).toBeGreaterThanOrEqual(0)
    expect(popover.x + popover.width).toBeLessThanOrEqual(390)
    // A tap just beside a swatch, in the gap, still picks it.
    const blue = swatches.getByRole('radio', { name: 'Blue' })
    const b = (await blue.boundingBox())!
    await page.touchscreen.tap(b.x + b.width + 6, b.y + b.height / 2)
    await expect(blue).toHaveAttribute('aria-checked', 'true')
  })

  test('on the home screen, the theme switch and a recent document’s menu button are 40px targets', async ({ page }) => {
    const errors = trackPageErrors(page)
    await openSample(page)
    await page.getByRole('button', { name: 'Back to home', exact: true }).tap()
    const more = page.getByRole('button', { name: /^More options for/ })
    await expect(more).toBeVisible()
    for (const theme of await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio').all()) await expectTarget(theme)
    await expectTarget(more)
    // Its menu's rows are 44px tall, as every menu's are.
    await more.tap()
    const rows = page.getByRole('menu').getByRole('menuitem')
    await expect(rows).toHaveCount(2)
    for (const row of await rows.all()) await expect.poll(async () => (await row.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
    expect(errors).toEqual([])
  })
})

test.describe('on a narrow touch phone', () => {
  test.use({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

  test('the popover with the most swatches stays on screen, each one still a 40px target', async ({ page }) => {
    const errors = trackPageErrors(page)
    await openSample(page)
    // A rectangle, selected: its Fill offers No color, the palette and Custom, too many for one row here.
    await page.keyboard.press('r')
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-element-id][data-kind="shape"]')).toBeVisible()
    await page.getByRole('toolbar', { name: 'Item options' }).getByRole('button', { name: 'Fill', exact: true }).tap()
    const swatches = page.getByRole('radiogroup', { name: 'Fill' })
    await expect(swatches).toBeVisible()
    const popover = (await page.getByRole('dialog', { name: 'Fill' }).boundingBox())!
    expect(popover.x).toBeGreaterThanOrEqual(0)
    expect(popover.x + popover.width).toBeLessThanOrEqual(360)
    const targets = [...(await swatches.getByRole('radio').all()), swatches.getByLabel('Custom color')]
    expect(targets).toHaveLength(9)
    for (const target of targets) {
      const area = await hitArea(target)
      expect.soft(area.width, `${await target.getAttribute('aria-label')}: width`).toBeGreaterThanOrEqual(40)
      expect.soft(area.height, `${await target.getAttribute('aria-label')}: height`).toBeGreaterThanOrEqual(40)
    }
    expect(errors).toEqual([])
  })
})

test.describe('on a touch tablet', () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true })

  test('the zoom group’s buttons are 40px targets, and its menu shows no keys', async ({ page }) => {
    await openSample(page)
    const zoom = page.getByRole('group', { name: 'Zoom' })
    for (const name of ['Zoom out', /^Zoom level/, 'Zoom in']) await expectTarget(zoom.getByRole('button', { name }))
    await zoom.getByRole('button', { name: /^Zoom level/ }).tap()
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitemradio', { name: 'Fit width' })).toBeVisible()
    expect(await menu.innerText()).not.toMatch(/Ctrl|⌘/)
  })
})

test('with a mouse, menus show their keyboard shortcuts', async ({ page }) => {
  await openSample(page)
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: /open another pdf/i })).toContainText(/Ctrl\+O|⌘O/)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^Zoom level/ }).click()
  await expect(page.getByRole('menuitemradio', { name: /fit width/i })).toContainText(/Ctrl 0|⌘ 0/)
})

/** The color a CSS color value (a system color, say) computes to here. */
function computed(page: Page, color: string): Promise<string> {
  return page.evaluate((color) => {
    const probe = document.createElement('div')
    probe.style.backgroundColor = color
    document.body.append(probe)
    const value = getComputedStyle(probe).backgroundColor
    probe.remove()
    return value
  }, color)
}

const background = (el: Locator) => el.evaluate((node) => getComputedStyle(node).backgroundColor)

/** Pixels that clearly differ (sum of |ΔRGB| > 48) between two screenshots of the same size. */
function differingPixels(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(
    async ([a, b]) => {
      const decode = async (png: string) => {
        const img = new Image()
        img.src = `data:image/png;base64,${png}`
        await img.decode()
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const g = canvas.getContext('2d')!
        g.drawImage(img, 0, 0)
        return g.getImageData(0, 0, img.width, img.height).data
      }
      const [pa, pb] = await Promise.all([decode(a), decode(b)])
      if (pa.length !== pb.length) throw new Error('The screenshots differ in size')
      let n = 0
      for (let i = 0; i < pa.length; i += 4) if (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) > 48) n++
      return n
    },
    [a.toString('base64'), b.toString('base64')] as const,
  )
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`pressed, chosen and highlighted states stay visible in forced colors, and item thumbnails stay paper (${colorScheme})`, async ({ page }) => {
    const errors = trackPageErrors(page)
    await page.emulateMedia({ forcedColors: 'active', colorScheme })
    const sheet = await openSample(page)
    const highlight = await computed(page, 'Highlight')
    // The page is white paper in any theme: what is on it keeps its colors.
    expect(await sheet.evaluate((node) => getComputedStyle(node).forcedColorAdjust)).toBe('none')

    // Pressed toggles (the open panels), the chosen filter.
    const pages = page.getByRole('button', { name: 'Pages', exact: true })
    await expect(pages).toHaveAttribute('aria-pressed', 'true')
    await page.mouse.move(2, 450)
    expect(await background(pages)).toBe(highlight)
    expect(await background(page.getByRole('radio', { name: 'All', exact: true }))).toBe(highlight)
    expect(await background(page.getByRole('radio', { name: /^Required/ }))).not.toBe(highlight)

    // The menu row under the keyboard.
    await page.getByRole('button', { name: 'More', exact: true }).focus()
    await page.keyboard.press('Enter')
    const first = page.getByRole('menuitem').first()
    await expect(first).toBeFocused()
    expect(await background(first)).toBe(highlight)
    expect(await background(page.getByRole('menuitem').nth(1))).not.toBe(highlight)
    await page.keyboard.press('Escape')

    // Swatches keep their colors; the chosen one is ringed.
    await addText(page, sheet)
    await page.getByRole('button', { name: 'Text color' }).click()
    const swatches = page.getByRole('radiogroup', { name: 'Text color' })
    expect(await background(swatches.getByRole('radio', { name: 'Blue' }))).toBe('rgb(29, 78, 216)')
    const ring = (name: string) => swatches.getByRole('radio', { name }).evaluate((node) => getComputedStyle(node).boxShadow)
    expect(await ring('Black')).toContain(highlight)
    expect(await ring('Blue')).not.toContain(highlight)
    await page.keyboard.press('Escape')

    // The item's thumbnail in the Items panel is white paper, as the page is (dark ink would vanish
    // on a black tile).
    await page.getByRole('tab', { name: /^Items/ }).click()
    const thumb = page.locator('[data-item-row] > span[aria-hidden="true"]').first()
    expect(await thumb.evaluate((node) => [getComputedStyle(node).forcedColorAdjust, getComputedStyle(node).backgroundColor])).toEqual(['none', 'rgb(255, 255, 255)'])

    // The switch is drawn, on and off.
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Download', exact: true }).click()
    const flatten = page.getByRole('switch')
    await expect(flatten).toBeVisible()
    const was = await flatten.getAttribute('aria-checked')
    const before = await flatten.screenshot()
    await flatten.click()
    await expect(flatten).not.toHaveAttribute('aria-checked', was!)
    await page.mouse.move(2, 450)
    const after = await flatten.screenshot()
    expect(await differingPixels(page, before, after)).toBeGreaterThan(40)
    expect(errors).toEqual([])
  })

  // index.css's own rules, for every area: whatever is pressed, selected or current, and paper.
  test(`the active tool, the selected tab and the current page are drawn in forced colors; a signing pad stays paper (${colorScheme})`, async ({ page }) => {
    const errors = trackPageErrors(page)
    await page.emulateMedia({ forcedColors: 'active', colorScheme })
    await gotoHome(page)
    const highlight = await computed(page, 'Highlight')
    const highlightText = await computed(page, 'HighlightText')

    // A toggle group's chosen option (data-state=on).
    const themes = page.getByRole('radiogroup', { name: 'Theme' })
    await page.mouse.move(2, 450)
    expect(await background(themes.getByRole('radio', { checked: true }))).toBe(highlight)
    expect(await background(themes.getByRole('radio', { checked: false }).first())).not.toBe(highlight)

    await openPdf(page, SAMPLE_PDF)
    await showPage(page, 0)
    await page.mouse.move(2, 450)
    const tools = page.getByRole('toolbar', { name: 'Tools' })
    await expect(tools.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(await background(tools.getByRole('button', { name: 'Select', exact: true }))).toBe(highlight)
    expect(await background(tools.getByRole('button', { name: 'Pan', exact: true }))).not.toBe(highlight)

    // The selected tab, and what it holds (its count, colored on its own otherwise).
    const form = page.getByRole('tab', { name: /^Form/ })
    await expect(form).toHaveAttribute('aria-selected', 'true')
    expect(await background(form)).toBe(highlight)
    expect(await form.locator('span').last().evaluate((node) => getComputedStyle(node).color)).toBe(highlightText)
    expect(await background(page.getByRole('tab', { name: /^Items/ }))).not.toBe(highlight)

    const current = page.locator('[aria-current="page"]')
    await expect(current).toHaveCount(1)
    await expect(current).toHaveAccessibleName(/^Page 1 of/)
    expect(await background(current)).toBe(highlight)
    expect(await background(page.getByRole('button', { name: /^Page 2 of/ }))).not.toBe(highlight)

    // Dark ink shows on the pad in every palette (the page color would be black in a dark one).
    await tools.getByRole('button', { name: 'Signature', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: /add your signature/i })
    await expect(dialog).toBeVisible()
    expect(await background(dialog.getByRole('tab', { name: 'Draw' }))).toBe(highlight)
    const pad = dialog.locator('[data-signing-pad]')
    expect(await pad.evaluate((node) => [getComputedStyle(node).forcedColorAdjust, getComputedStyle(node).backgroundColor])).toEqual(['none', 'rgb(255, 255, 255)'])
    expect(errors).toEqual([])
  })
}

test('swatches, sliders and segmented groups have names', async ({ page }) => {
  const sheet = await openSample(page)
  await addText(page, sheet)
  const toolbar = page.getByRole('toolbar', { name: 'Item options' })
  await expect(toolbar.getByRole('radiogroup', { name: 'Font' })).toBeVisible()

  await page.getByRole('button', { name: 'Text color' }).click()
  const colors = page.getByRole('radiogroup', { name: 'Text color' })
  await expect(colors).toBeVisible()
  const names = await colors.getByRole('radio').evaluateAll((radios) => radios.map((r) => r.getAttribute('aria-label')))
  expect(names).toEqual(['Black', 'Blue', 'Red', 'Green', 'Purple', 'White'])
  await expect(colors.getByRole('radio', { name: 'Black' })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Alignment and spacing' }).click()
  await expect(page.getByRole('slider', { name: 'Letter spacing' })).toBeVisible()
  await expect(page.getByRole('slider', { name: 'Line height' })).toBeVisible()
})

/** A color's red, green and blue (0–255), and its alpha (0–1), from `#rrggbb` or `rgb(…)`. */
function channels(c: string): number[] {
  if (c.startsWith('#')) return [...[1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)), 1]
  const [r, g, b, a = 1] = c.match(/[\d.]+/g)!.map(Number)
  return [r, g, b, a]
}

/** A translucent color laid over an opaque one, as the screen shows it. */
function over(color: string, backdrop: string): string {
  const [a, b] = [channels(color), channels(backdrop)]
  return `rgb(${[0, 1, 2].map((i) => Math.round(a[i] * a[3] + b[i] * (1 - a[3]))).join(', ')})`
}

/** WCAG contrast ratio of two opaque colors, as `#rrggbb` or `rgb(…)`. */
function contrast(a: string, b: string): number {
  const luminance = (color: string) => {
    const [r, g, bl] = channels(color).slice(0, 3).map((v) => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`white on the accent reads 4.5:1; the accent and control borders stand out 3:1 on every surface (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme })
    await gotoHome(page)
    const t = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      const names = ['canvas', 'surface', 'surface-2', 'surface-3', 'accent', 'accent-hover', 'accent-fg', 'accent-soft', 'control']
      return Object.fromEntries(names.map((n) => [n, style.getPropertyValue(`--ff-${n}`).trim()]))
    })
    for (const fill of ['accent', 'accent-hover']) expect(contrast(t['accent-fg'], t[fill]), `text on ${fill}`).toBeGreaterThanOrEqual(4.5)
    // The active form field and the selected item: an accent bar, a checked box or a focus ring on
    // the accent-soft tint, inputs on it.
    const backgrounds: Record<string, string> = { ...t, 'accent-soft row': over(t['accent-soft'], t.surface) }
    for (const surface of ['canvas', 'surface', 'surface-2', 'surface-3', 'accent-soft row']) {
      expect(contrast(t.accent, backgrounds[surface]), `accent on ${surface}`).toBeGreaterThanOrEqual(3)
      expect(contrast(t.control, backgrounds[surface]), `control border on ${surface}`).toBeGreaterThanOrEqual(3)
    }
  })
}

test('white text on a primary button meets WCAG AA in the dark theme, also hovered', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await openSample(page)
  const download = page.getByRole('button', { name: 'Download', exact: true })
  const colors = () => download.evaluate((node) => [getComputedStyle(node).color, getComputedStyle(node).backgroundColor])
  await page.mouse.move(2, 450)
  const [fg, bg] = await colors()
  expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5)
  await download.hover()
  await expect.poll(async () => (await colors())[1]).not.toBe(bg)
  const [hoverFg, hoverBg] = await colors()
  expect(contrast(hoverFg, hoverBg)).toBeGreaterThanOrEqual(4.5)
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`a text field's border stands out 3:1 from the panel (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme })
    await openSample(page)
    const field = page.getByRole('tabpanel', { name: /form/i }).getByRole('textbox', { name: 'Full name', exact: true })
    await expect(field).toBeVisible()
    const [border, fill] = await field.evaluate((node) => [getComputedStyle(node).borderTopColor, getComputedStyle(node).backgroundColor])
    expect(contrast(border, fill)).toBeGreaterThanOrEqual(3)
  })
}

test.describe('on a phone held sideways, with a notch', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true })

  test('side sheets and menus keep their controls out of the safe-area insets', async ({ page }) => {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { left: 47, right: 47, top: 0, bottom: 21 } })
    await openSample(page)
    const outside = (sheet: Locator) =>
      sheet.evaluate((node) =>
        [...node.querySelectorAll('button, input, textarea, select, [role=tab], [role=radio], [role=checkbox]')]
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width && r.height && (r.left < 47 || r.right > innerWidth - 47))
          .map(({ el, r }) => `${el.getAttribute('aria-label') ?? el.textContent?.trim()} ${Math.round(r.left)}..${Math.round(r.right)}`),
      )
    for (const [toggle, name] of [
      [/^(form & items|items)$/i, /form and items|items/i],
      [/^pages$/i, /^pages$/i],
    ] as const) {
      await page.getByRole('button', { name: toggle }).tap()
      const sheet = page.getByRole('dialog', { name })
      await expect(sheet).toBeVisible()
      expect(await outside(sheet)).toEqual([])
      await page.keyboard.press('Escape')
      await expect(sheet).toHaveCount(0)
    }
    // A long menu stops at the bottom inset (and scrolls), clear of the side ones (to the pixel).
    await page.getByRole('button', { name: 'More', exact: true }).tap()
    // Radix places it (from above the screen) a frame after it shows.
    await expect.poll(async () => (await page.getByRole('menu').boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(0)
    const menu = (await page.getByRole('menu').boundingBox())!
    expect(menu.x).toBeGreaterThanOrEqual(47 - 1)
    expect(menu.x + menu.width).toBeLessThanOrEqual(844 - 47 + 1)
    expect(menu.y + menu.height).toBeLessThanOrEqual(390 - 21 + 1)
  })
})

test('the open-overlay selector finds an open menu, dialog or popover, and nothing else', async ({ page }) => {
  const sheet = await openSample(page)
  const overlays = page.locator(OPEN_OVERLAY)
  await expect(overlays).toHaveCount(0)
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await expect(overlays).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(overlays).toHaveCount(0)
  await addText(page, sheet)
  await page.getByRole('button', { name: 'Text color' }).click()
  await expect(overlays).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(overlays).toHaveCount(0)
})

/**
 * Clicks the middle of an element with the mouse as is, whatever covers it (as a person would),
 * and tells whether the press reached the element.
 */
async function clickReaches(page: Page, el: Locator): Promise<boolean> {
  const node = (await el.elementHandle())!
  const b = (await el.boundingBox())!
  await page.evaluate(() => {
    const w = window as typeof window & { pressed?: EventTarget | null }
    w.pressed = null
    addEventListener('pointerdown', (e) => (w.pressed = e.target), { capture: true, once: true })
  })
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
  return node.evaluate((n) => {
    const pressed = (window as typeof window & { pressed?: EventTarget | null }).pressed
    return pressed instanceof Node && n.contains(pressed)
  })
}

test.describe('with motion', () => {
  // Below 1024px wide the Pages panel is a sheet.
  test.use({ reducedMotion: 'no-preference', viewport: { width: 900, height: 800 } })

  test('a click right after a dialog or a sheet closes reaches the page, not the backdrop fading out', async ({ page }) => {
    const errors = trackPageErrors(page)
    await openSample(page)
    // A slow fade, so that each click below surely comes while the backdrop is still there.
    await page.addStyleTag({ content: 'body > [data-state="closed"] { animation-duration: 4s !important }' })
    const fading = page.locator('body > [data-state="closed"]')

    await page.getByRole('button', { name: 'Download', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Download PDF' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(fading).toHaveCount(1)
    expect(await clickReaches(page, (await formField(page, 'Full name')).locator('input'))).toBe(true)
    await expect(fading).toHaveCount(1)
    await expect(fading).toHaveCount(0)

    await page.getByRole('button', { name: /^pages$/i }).click()
    await expect(page.getByRole('dialog', { name: /^pages$/i })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: /^pages$/i })).toHaveCount(0)
    await expect(fading).toHaveCount(1)
    expect(await clickReaches(page, (await formField(page, 'Email')).locator('input'))).toBe(true)
    await expect(fading).toHaveCount(1)
    expect(errors).toEqual([])
  })
})

/**
 * Clicks `opener`, which asks for a confirmation, and presses the confirmation's backdrop in the
 * same task, as it appears: before the modal under it has caught up with no longer being on top.
 * A real press lands in that gap on a slow device (or a busy test runner).
 */
async function pressBackdropAsConfirmationOpens(opener: Locator): Promise<void> {
  await opener.evaluate(async (button: HTMLElement) => {
    button.click()
    // React shows the confirmation in a microtask; the modal under it catches up in a later task.
    const shown = () => document.querySelector('[role="alertdialog"]')
    for (let i = 0; i < 100 && !shown(); i++) await Promise.resolve()
    if (!shown()) throw new Error('No confirmation opened')
    const backdrop = document.elementFromPoint(8, 8)
    if (!backdrop) throw new Error('Nothing to press at the top left corner')
    const at = { bubbles: true, cancelable: true, composed: true, button: 0, clientX: 8, clientY: 8 }
    const pointer = { ...at, pointerId: 1, pointerType: 'mouse', isPrimary: true }
    backdrop.dispatchEvent(new PointerEvent('pointerdown', pointer))
    backdrop.dispatchEvent(new MouseEvent('mousedown', at))
    backdrop.dispatchEvent(new PointerEvent('pointerup', pointer))
    backdrop.dispatchEvent(new MouseEvent('mouseup', at))
    backdrop.dispatchEvent(new MouseEvent('click', at))
  })
}

/**
 * Presses a modal's backdrop (the top left corner) once the modal takes such presses. Radix starts
 * listening for them a task after the modal opens (or after a modal over it closes), and on a busy
 * runner a press can come first.
 */
async function pressBackdrop(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0)))))
  await page.mouse.click(8, 8)
}

test.describe('a press on a confirmation that has only just opened', () => {
  test('leaves the dialog under it open', async ({ page }) => {
    const errors = trackPageErrors(page)
    await openSample(page)
    // A saved signature, to have one to delete from the signature dialog.
    const signature = page.getByRole('button', { name: 'Signature', exact: true }).filter({ visible: true }).first()
    const dialog = page.getByRole('dialog', { name: 'Add your signature' })
    await signature.click()
    await dialog.getByRole('tab', { name: 'Type' }).click()
    await dialog.getByLabel('Your full name').fill('Ada Lovelace')
    await dialog.getByRole('button', { name: 'Use signature' }).click()
    await expect(dialog).toBeHidden()
    await page.keyboard.press('Escape') // don't place it
    const openDialog = async () => {
      await signature.click()
      await page.getByRole('button', { name: 'New signature' }).click()
      await expect(dialog).toBeVisible()
    }
    // A press on the dialog's own backdrop still closes it.
    await openDialog()
    await pressBackdrop(page)
    await expect(dialog).toBeHidden()

    await openDialog()
    await pressBackdropAsConfirmationOpens(dialog.getByRole('button', { name: /^Delete signature saved/ }))
    const confirmation = page.getByRole('alertdialog')
    await expect(confirmation).toBeVisible()
    await confirmation.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirmation).toBeHidden()
    await expect(dialog).toBeVisible()
    expect(errors).toEqual([])
  })

  test.describe('on a screen where the side panel is a sheet', () => {
    test.use({ viewport: { width: 800, height: 900 } })

    test('leaves the sheet under it open', async ({ page }) => {
      const errors = trackPageErrors(page)
      await openSample(page)
      const sheet = page.getByRole('dialog', { name: 'Form and items' })
      const openSheet = async () => {
        await page.getByRole('button', { name: 'Form & items' }).click()
        await expect(sheet).toBeVisible()
      }
      // A press on the sheet's own backdrop still closes it.
      await openSheet()
      await pressBackdrop(page)
      await expect(sheet).toBeHidden()

      await openSheet()
      const fullName = sheet.getByRole('textbox', { name: /^Full name/ })
      await fullName.fill('Ada Lovelace')
      const reset = sheet.getByRole('button', { name: 'Reset form' })
      await expect(reset).toBeEnabled()
      // Out of the field first: leaving it updates the panel, which would bring the sheet up to date.
      await reset.focus()

      await pressBackdropAsConfirmationOpens(reset)
      const confirmation = page.getByRole('alertdialog')
      await expect(confirmation).toBeVisible()
      await confirmation.getByRole('button', { name: 'Cancel' }).click()
      await expect(confirmation).toBeHidden()
      await expect(sheet).toBeVisible()
      await expect(fullName).toHaveValue('Ada Lovelace')
      expect(errors).toEqual([])
    })
  })
})

test('a toast on its way out lets presses through to what is under it', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openSample(page)
  await expect(page.locator('[data-sonner-toast]')).toContainText(/fillable fields found/)
  // Once it starts leaving: its pointer events, and whether a press at its middle would reach it.
  await page.evaluate(() => {
    const w = window as typeof window & { leaving?: Promise<[string, boolean]> }
    w.leaving = new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        const toast = document.querySelector<HTMLElement>('[data-sonner-toast][data-removed="true"]')
        if (!toast) return
        observer.disconnect()
        const r = toast.getBoundingClientRect()
        const under = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        resolve([getComputedStyle(toast).pointerEvents, !!under && toast.contains(under)])
      })
      observer.observe(document.body, { subtree: true, attributeFilter: ['data-removed'] })
    })
  })
  // A field in use: the "fillable fields found" hint has done its job, and goes.
  await (await formField(page, 'Full name')).locator('input').click()
  const leaving = await page.evaluate(() => (window as typeof window & { leaving?: Promise<[string, boolean]> }).leaving)
  expect(leaving).toEqual(['none', false])
  expect(errors).toEqual([])
})

test.describe('on a phone held sideways', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true })

  test('a toast sits just above the tool dock, not over the middle of the pages', async ({ page }) => {
    await openSample(page)
    const toast = page.locator('[data-sonner-toast]')
    await expect(toast).toContainText(/fillable fields found/)
    const box = (await toast.boundingBox())!
    const dock = (await page.getByRole('toolbar', { name: 'Tools' }).boundingBox())!
    // Over the dock's hint chip, where a tool shows one: the pages above stay clear.
    const gap = dock.y - (box.y + box.height)
    expect(gap).toBeGreaterThanOrEqual(0)
    expect(gap).toBeLessThanOrEqual(16)
  })
})

test('a dialog with only a message has no empty band above its buttons', async ({ page, context }) => {
  // Offline before pdf.js's worker was downloaded: FillFlow says so, with nothing more to show.
  await page.route(/pdf\.worker/, (route) => (route.request().resourceType() === 'fetch' ? route.abort('internetdisconnected') : route.continue()))
  await gotoHome(page)
  await context.setOffline(true)
  try {
    await openPdf(page, SAMPLE_PDF)
    const dialog = page.getByRole('dialog', { name: 'FillFlow couldn’t finish loading' })
    await expect(dialog).toBeVisible()
    const message = (await page.locator(`[id="${await dialog.getAttribute('aria-describedby')}"]`).boundingBox())!
    const footer = (await dialog.getByRole('button', { name: 'Try again' }).locator('..').boundingBox())!
    // The room a dialog's body leaves under itself, no more.
    const room = footer.y - (message.y + message.height)
    expect(room).toBeGreaterThanOrEqual(16)
    expect(room).toBeLessThanOrEqual(24)
  } finally {
    await context.setOffline(false)
  }
})
