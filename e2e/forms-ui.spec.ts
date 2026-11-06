/// <reference lib="dom" />
import { expect, test, type Locator, type Page } from '@playwright/test'
import { SAMPLE_PDF, clickPagePoint, gotoHome, openPdf, selectTool, showPage, trackPageErrors } from './support/app'
import { readViewSizes } from './support/pdf'

// The form panel and the on-page fields: states that stay visible in forced colors (Windows
// contrast themes), control borders that can be seen, named groups, undo keys that work the same
// in every field on every keyboard layout, and the browser's own undo kept out of the fields.

async function openSample(page: Page): Promise<{ panel: Locator; sheet: Locator }> {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  const sheet = await showPage(page, 0)
  const panel = page.getByRole('tabpanel', { name: /form/i })
  await expect(panel.getByRole('progressbar')).toBeVisible()
  return { panel, sheet }
}

/** Nothing focused or hovered, and the last style change painted. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.mouse.move(2, 450)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

/**
 * A screenshot of a box around the element (a fixed size, when given, so two crops compare), `pad`
 * px wider on every side: a negative one keeps inside its edges.
 */
async function crop(page: Page, el: Locator, size?: { width: number; height: number }, pad = 2): Promise<Buffer> {
  const b = await el.boundingBox()
  if (!b) throw new Error('The element is not visible')
  return page.screenshot({ clip: { x: b.x - pad, y: b.y - pad, width: (size?.width ?? b.width) + 2 * pad, height: (size?.height ?? b.height) + 2 * pad } })
}

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

/** The strongest contrast in a screenshot: its most common color against the pixel farthest from it. */
function strongestContrast(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(async (png) => {
    const img = new Image()
    img.src = `data:image/png;base64,${png}`
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const g = canvas.getContext('2d')!
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, img.width, img.height).data
    const lum = (r: number, gr: number, b: number) =>
      [r, gr, b].map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0)
    const counts = new Map<number, number>()
    for (let i = 0; i < d.length; i += 4) {
      const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    const main = [...counts].sort((x, y) => y[1] - x[1])[0][0]
    const base = lum(main >> 16, (main >> 8) & 255, main & 255)
    let best = 1
    for (let i = 0; i < d.length; i += 4) {
      const l = lum(d[i], d[i + 1], d[i + 2])
      best = Math.max(best, (Math.max(l, base) + 0.05) / (Math.min(l, base) + 0.05))
    }
    return best
  }, png.toString('base64'))
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`checked and chosen states stay visible in forced colors (${colorScheme})`, async ({ page }) => {
    const errors = trackPageErrors(page)
    await page.emulateMedia({ forcedColors: 'active', colorScheme, reducedMotion: 'reduce' })
    const { panel, sheet } = await openSample(page)
    await sheet.getByRole('textbox', { name: 'Full name', exact: true }).fill('Dana')
    await sheet.getByRole('radio', { name: 'Membership type: Family' }).click()
    await sheet.getByRole('checkbox', { name: 'Interested in: Volunteering' }).click()
    await expect(panel.getByRole('checkbox', { name: 'Interested in: Volunteering' })).toHaveAttribute('aria-checked', 'true')
    await settle(page)

    // Form panel: a checked box against an empty one, the chosen chip's circle against another's.
    const checked = panel.getByRole('checkbox', { name: 'Interested in: Volunteering' })
    const empty = panel.getByRole('checkbox', { name: 'Interested in: Community events' })
    await checked.scrollIntoViewIfNeeded()
    expect(await differingPixels(page, await checked.screenshot(), await empty.screenshot())).toBeGreaterThan(50)
    const family = panel.getByRole('radio', { name: 'Family', exact: true })
    const individual = panel.getByRole('radio', { name: 'Individual', exact: true })
    const circle = { width: 14, height: 14 }
    expect(await differingPixels(page, await crop(page, family.locator('span').first(), circle), await crop(page, individual.locator('span').first(), circle))).toBeGreaterThan(50)
    // The chosen chip's label is drawn on the chip, not hidden under a Canvas backplate.
    const label = await family.getByText('Family').boundingBox()
    const band = await page.screenshot({ clip: { x: label!.x + 1, y: label!.y + label!.height / 2 - 3, width: label!.width - 2, height: 6 } })
    expect(await strongestContrast(page, band)).toBeGreaterThan(3)
    // The progress bar's fill and track.
    expect(await strongestContrast(page, await panel.getByRole('progressbar').screenshot())).toBeGreaterThan(3)
    // The count on the chosen filter.
    const required = panel.getByRole('radio', { name: /^Required/ })
    await required.click()
    await settle(page)
    expect(await strongestContrast(page, await required.locator('span').screenshot())).toBeGreaterThan(4.5)
    await panel.getByRole('radio', { name: 'All', exact: true }).click()
    // A focused field is outlined: forced colors mode drops the focus ring.
    const address = panel.getByRole('textbox', { name: 'Home address' })
    await address.focus()
    await expect.poll(() => address.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe('none')
    await settle(page)

    // On the page, a list box: forced colors mode paints it on Canvas whatever its styles, so its
    // options take the system colors too, and stay readable.
    const listbox = sheet.getByRole('listbox', { name: /hear about us/i })
    await listbox.evaluate((node) => node.scrollIntoView({ block: 'center' }))
    await settle(page)
    expect(await strongestContrast(page, await crop(page, listbox, undefined, -4))).toBeGreaterThan(4.5) // inside its edges

    // The rest is on white paper either way, so the fields look exactly as without forced colors.
    const onPage = [
      sheet.getByRole('textbox', { name: 'Full name', exact: true }),
      sheet.getByRole('radio', { name: 'Membership type: Family' }),
      sheet.getByRole('radio', { name: 'Membership type: Individual' }),
      sheet.getByRole('checkbox', { name: 'Interested in: Volunteering' }),
      sheet.getByRole('checkbox', { name: 'Interested in: Community events' }),
    ]
    const shots = async () => {
      const out: Buffer[] = []
      for (const el of onPage) {
        await el.evaluate((node) => node.scrollIntoView({ block: 'center' }))
        await settle(page)
        out.push(await crop(page, el))
      }
      return out
    }
    const forced = await shots()
    await page.emulateMedia({ forcedColors: 'none' })
    const plain = await shots()
    for (const [i, shot] of plain.entries()) expect(await differingPixels(page, forced[i], shot), `on-page control ${i}`).toBe(0)
    // …and those states do show: a chosen radio against another, a checked box against an empty one.
    expect(await differingPixels(page, forced[1], forced[2])).toBeGreaterThan(20)
    expect(await differingPixels(page, forced[3], forced[4])).toBeGreaterThan(20)
    expect(errors).toEqual([])
  })
}

/** Contrast of a control's border against its own fill (when opaque) and against what it sits on. */
function borderContrast(el: Locator): Promise<number> {
  return el.evaluate((node) => {
    const rgba = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number)
    const opaque = (c: string) => {
      const v = rgba(c)
      return v.length === 3 || v[3] === 1
    }
    const lum = ([r, g, b]: number[]) =>
      [r, g, b].map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0)
    const ratio = (a: number[], b: number[]) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)
    let backdrop = [255, 255, 255]
    for (let n = node.parentElement; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor
      if (opaque(bg)) {
        backdrop = rgba(bg)
        break
      }
    }
    const style = getComputedStyle(node)
    const border = rgba(style.borderTopColor)
    const fill = opaque(style.backgroundColor) ? rgba(style.backgroundColor) : backdrop
    return Math.min(ratio(border, fill), ratio(border, backdrop))
  })
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`form panel controls have borders that can be seen (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    const { panel } = await openSample(page)
    await settle(page)
    const referral = panel.getByRole('group', { name: /hear about us/i })
    const controls = {
      input: panel.getByRole('textbox', { name: 'Email address', exact: true }),
      textarea: panel.getByRole('textbox', { name: 'Home address' }),
      select: panel.getByRole('combobox', { name: 'Country' }),
      checkbox: panel.getByRole('checkbox', { name: 'Interested in: Community events' }),
      radio: panel.getByRole('radio', { name: 'Individual', exact: true }).locator('span').first(),
      listOption: referral.getByRole('checkbox').first().locator('span').first(),
    }
    for (const [name, el] of Object.entries(controls)) expect(await borderContrast(el), name).toBeGreaterThanOrEqual(3)

    // An editable <select> matches :read-only, but must not look (or focus) like a locked field.
    const fill = (el: Locator) => el.evaluate((n) => getComputedStyle(n).backgroundColor)
    expect(await fill(controls.select)).toBe(await fill(controls.textarea))
    const border = () => controls.select.evaluate((n) => getComputedStyle(n).borderTopColor)
    const resting = await border()
    await controls.select.focus()
    await expect.poll(border).not.toBe(resting)
  })
}

test('an on-page drop-down’s arrow stands out from its field, hovered or not', async ({ page }) => {
  const { sheet } = await openSample(page)
  const country = sheet.locator('[data-form-field="Country"]')
  await country.evaluate((node) => node.scrollIntoView({ block: 'center' }))
  await settle(page)
  const arrow = country.locator('svg')
  // 3:1 at least, as the parts of a control need (WCAG 1.4.11).
  expect(await strongestContrast(page, await crop(page, arrow, undefined, 0))).toBeGreaterThanOrEqual(3)
  await country.hover()
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  expect(await strongestContrast(page, await crop(page, arrow, undefined, 0))).toBeGreaterThanOrEqual(3)
})

test('pressing an option of an on-page list box partly out of view doesn’t scroll the pages', async ({ page }) => {
  const errors = trackPageErrors(page)
  const { sheet } = await openSample(page)
  const listbox = sheet.getByRole('listbox', { name: /hear about us/i })
  await expect(listbox).toHaveAttribute('multiple', '')
  // Scrolled so that only its last rows show, at the top of the pages' view.
  const pages = page.getByRole('region', { name: 'Document pages' })
  const box = (await listbox.boundingBox())!
  const top = await pages.evaluate((el, bottom) => {
    el.scrollTo({ top: el.scrollTop + bottom - (el.getBoundingClientRect().top + 30), behavior: 'instant' })
    return el.scrollTop
  }, box.y + box.height)
  const option = listbox.getByRole('option').last()
  const row = (await option.boundingBox())!
  expect(row.y).toBeGreaterThan((await pages.boundingBox())!.y)
  await page.mouse.click(row.x + 12, row.y + row.height / 2)
  await expect(listbox).toBeFocused()
  await expect.poll(() => option.evaluate((node) => (node as HTMLOptionElement).selected)).toBe(true)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  expect(await pages.evaluate((el) => el.scrollTop)).toBe(top)
  expect(errors).toEqual([])
})

test('the form panel’s filter is a named group', async ({ page }) => {
  const { panel } = await openSample(page)
  const filter = panel.getByRole('radiogroup', { name: 'Show fields' })
  await expect(filter).toBeVisible()
  await expect(filter.getByRole('radio')).toHaveCount(3)
})

/** Letter keys as Chrome reports them on a Hebrew keyboard layout: the layout's own letter, on the Latin key. */
const HEBREW_KEYS = {
  z: { key: 'ז', code: 'KeyZ', windowsVirtualKeyCode: 90 },
  y: { key: 'ט', code: 'KeyY', windowsVirtualKeyCode: 89 },
}

/** Presses Ctrl/⌘ (+ Shift) + a letter key on a Hebrew keyboard layout (Playwright's keyboard types US keys only). */
async function hebrewKeyboard(page: Page): Promise<(letter: keyof typeof HEBREW_KEYS, shift?: boolean) => Promise<void>> {
  const cdp = await page.context().newCDPSession(page)
  const mod = process.platform === 'darwin' ? 4 : 2 // ⌘ / Ctrl
  return async (letter, shift = false) => {
    const modifiers = mod | (shift ? 8 : 0)
    for (const type of ['rawKeyDown', 'keyUp'] as const) await cdp.send('Input.dispatchKeyEvent', { type, modifiers, ...HEBREW_KEYS[letter] })
  }
}

for (const where of ['page', 'panel'] as const) {
  test(`undo keys in a ${where} field undo the last change, on a Hebrew layout too`, async ({ page }) => {
    const errors = trackPageErrors(page)
    const { panel, sheet } = await openSample(page)
    const scope = where === 'page' ? sheet : panel
    const name = scope.getByRole('textbox', { name: 'Full name', exact: true })
    const email = scope.getByRole('textbox', { name: 'Email address', exact: true })
    await name.click()
    await page.keyboard.type('Dana')
    await email.click()
    await page.keyboard.type('d@x.io')
    await name.click()
    const press = await hebrewKeyboard(page)
    const redo = page.getByRole('button', { name: 'Redo', exact: true })

    // The editor's undo, as with the toolbar button: the whole last entry, in its own field.
    await press('z')
    await expect(email).toHaveValue('')
    await expect(name).toHaveValue('Dana')
    await expect(name).toBeFocused()
    await expect(redo).toBeEnabled()
    await press('z')
    await expect(name).toHaveValue('')
    // Redo: Ctrl+Y (not on Apple platforms) and ⌘/Ctrl+Shift+Z.
    if (process.platform === 'darwin') await press('z', true)
    else await press('y')
    await expect(name).toHaveValue('Dana')
    await press('z', true)
    await expect(email).toHaveValue('d@x.io')
    await expect(name).toBeFocused()
    // And the same on a US layout.
    await page.keyboard.press('ControlOrMeta+z')
    await expect(email).toHaveValue('')
    await expect(name).toHaveValue('Dana')
    expect(errors).toEqual([])
  })
}

/** The browser's own Undo as its menus run it (Playwright can't open those): the edit command, on a key nothing handles. */
async function menuUndo(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  const key = { key: 'F20', code: 'F20', windowsVirtualKeyCode: 131 }
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key, commands: ['undo'] })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
}

for (const where of ['page', 'panel'] as const) {
  test(`the browser’s own undo never changes a ${where} field from outside it`, async ({ page }) => {
    const errors = trackPageErrors(page)
    const sizes = await readViewSizes(SAMPLE_PDF)
    const { panel, sheet } = await openSample(page)
    const scope = where === 'page' ? sheet : panel
    const name = scope.getByRole('textbox', { name: 'Full name', exact: true })
    const email = scope.getByRole('textbox', { name: 'Email address', exact: true })
    await name.click()
    await page.keyboard.type('Dana')
    await email.click()
    await page.keyboard.type('d@x.io')

    // A new text item has nothing of its own to undo: the browser's undo would reach back into Email.
    await selectTool(page, 'Text', 'T')
    await clickPagePoint(page, 0, { x: 300, y: 128 }, sizes[0]) // right of the "Personal details" heading
    const editor = page.getByRole('textbox', { name: 'Edit text' })
    await expect(editor).toBeFocused()
    await page.keyboard.press('ControlOrMeta+z')
    await expect(editor).toBeFocused()
    await expect(email).toHaveValue('d@x.io')
    await page.keyboard.press('Escape')

    // Nor from the Download dialog's file name box.
    await page.getByRole('button', { name: 'Download', exact: true }).click()
    const fileName = page.getByRole('dialog').getByRole('textbox', { name: 'File name' })
    await fileName.click()
    await page.keyboard.press('ControlOrMeta+z')
    await expect(fileName).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(email).toHaveValue('d@x.io')
    await expect(name).toHaveValue('Dana')

    // A menu's Undo inside a field runs the editor's undo, as the keys do: the whole last entry.
    await name.click()
    await menuUndo(page)
    await expect(email).toHaveValue('')
    await expect(name).toHaveValue('Dana')
    await expect(name).toBeFocused()
    expect(errors).toEqual([])
  })
}
