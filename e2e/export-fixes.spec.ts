import { readFile, writeFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString, fill, rectangle, rgb, setFillingRgbColor } from 'pdf-lib'
import {
  SAMPLE_PDF,
  clickPagePoint,
  downloadPdf,
  fixture,
  formField,
  gotoHome,
  openPdf,
  selectTool,
  showPage,
  trackPageErrors,
} from './support/app'
import { withPdf } from './support/pdf'

/** Opens the export dialog from the top bar's Download button. */
async function openExportDialog(page: Page) {
  await page.getByRole('button', { name: /^download$/i }).filter({ visible: true }).first().click()
  const dialog = page.getByRole('dialog', { name: /download pdf/i })
  await expect(dialog).toBeVisible()
  return dialog
}

async function openWithPassword(page: Page, file: string, password: string) {
  await openPdf(page, file)
  const input = page.locator('input[type="password"]')
  await expect(input).toBeVisible()
  await input.fill(password)
  await input.press('Enter')
  await showPage(page, 0)
}

/** Letter keys as Chrome reports them on other keyboard layouts: the letter the layout types, and the key it is on. */
const LAYOUT_KEYS = {
  // Hebrew types its own letters on the Latin keys.
  hebrewS: { key: 'ד', code: 'KeyS', windowsVirtualKeyCode: 83 },
  hebrewO: { key: 'ם', code: 'KeyO', windowsVirtualKeyCode: 79 },
  // Dvorak has O on the S key; Colemak has Y (redo) on the O key.
  dvorakO: { key: 'o', code: 'KeyS', windowsVirtualKeyCode: 79 },
  colemakY: { key: 'y', code: 'KeyO', windowsVirtualKeyCode: 89 },
}

/** Presses Ctrl/⌘ + a letter key on another keyboard layout (Playwright's keyboard types US keys only). */
async function layoutKeyboard(page: Page): Promise<(key: keyof typeof LAYOUT_KEYS) => Promise<void>> {
  const cdp = await page.context().newCDPSession(page)
  const modifiers = process.platform === 'darwin' ? 4 : 2 // ⌘ / Ctrl
  return async (key) => {
    for (const type of ['rawKeyDown', 'keyUp'] as const) await cdp.send('Input.dispatchKeyEvent', { type, modifiers, ...LAYOUT_KEYS[key] })
  }
}

test('the export dialog keeps the browser’s “Open file” and “Save page” dialogs away, on any keyboard layout', async ({ page }) => {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 0)
  const dialog = await openExportDialog(page)
  const press = await layoutKeyboard(page)
  let downloads = 0
  page.on('download', () => downloads++)
  // Whether the browser would act on a key: is it still unprevented once dispatch is over?
  await page.evaluate(() => {
    const w = window as unknown as { browserKeys: string[] }
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code === 'KeyS' || e.code === 'KeyO') setTimeout(() => w.browserKeys.push(`${e.key}: ${e.defaultPrevented ? 'blocked' : 'allowed'}`))
      },
      true,
    )
  })
  const browserKeys = () => page.evaluate(() => (window as unknown as { browserKeys: string[] }).browserKeys)
  const targets = [
    { target: dialog.getByRole('textbox', { name: /file name/i }), save: false },
    { target: dialog.getByRole('button', { name: /^print$/i }), save: false },
    // Outside the form and the footer (⌘S there downloads): the header’s close button and the
    // dialog itself, which is what has focus on touch screens.
    { target: dialog.getByRole('button', { name: 'Close' }), save: true },
    { target: dialog, save: true },
  ]
  for (const { target, save } of targets) {
    await page.evaluate(() => ((window as unknown as { browserKeys: string[] }).browserKeys = []))
    await target.focus()
    // On a US keyboard layout, then on Hebrew and Dvorak ones; Colemak's ⌘Y / Ctrl+Y on the O key isn't "Open file".
    await page.keyboard.press('ControlOrMeta+o')
    await press('hebrewO')
    await press('dvorakO')
    await press('colemakY')
    if (save) {
      await page.keyboard.press('ControlOrMeta+s')
      await press('hebrewS')
    }
    await expect
      .poll(browserKeys)
      .toEqual(['o: blocked', 'ם: blocked', 'o: blocked', 'y: allowed', ...(save ? ['s: blocked', 'ד: blocked'] : [])])
  }
  await expect(dialog).toBeVisible()
  expect(downloads).toBe(0)
})

/** Drops a file on the window, as when one is dragged in from the desktop. */
async function dropFile(page: Page, name: string, type: string) {
  const dataTransfer = await page.evaluateHandle(
    ({ name, type }) => {
      const dt = new DataTransfer()
      dt.items.add(new File(['Not a PDF'], name, { type }))
      return dt
    },
    { name, type },
  )
  for (const event of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent('body', event, { dataTransfer })
}

test('opening the export dialog clears passing toasts but keeps errors up', async ({ page }) => {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 0)
  const toasts = page.locator('[data-sonner-toast]')
  const tip = toasts.filter({ hasText: /fillable fields? found/ })
  await expect(tip).toBeVisible()
  // A dropped file that isn't a PDF gets an error toast.
  await dropFile(page, 'notes.txt', 'text/plain')
  const error = toasts.filter({ hasText: 'isn’t a PDF' })
  await expect(error).toBeVisible()

  await openExportDialog(page)
  await expect(tip).toHaveCount(0)
  await expect(error).toBeVisible()
})

test('does not promise an unchanged copy when the form gets flattened', async ({ page }) => {
  const errors = trackPageErrors(page)
  await gotoHome(page)
  await page.evaluate(() => localStorage.removeItem('fillflow:export:flatten'))
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 0)
  const dialog = await openExportDialog(page)
  const flatten = dialog.getByRole('switch', { name: /flatten form fields/i })
  await expect(flatten).toHaveAttribute('aria-checked', 'true')
  await expect(dialog).toContainText('The form fields will be flattened, so they can no longer be filled in.')
  await expect(dialog).not.toContainText('match the original file')
  await expect(dialog).not.toContainText('password-protected')

  await flatten.click()
  await expect(dialog).toContainText('You haven’t added anything yet, so the download will match the original file.')
  expect(errors).toEqual([])
})

/** Share of dark pixels in a screenshot of `clip`. */
async function inkShare(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<number> {
  const png = (await page.screenshot({ clip })).toString('base64')
  return page.evaluate(async (png) => {
    const img = new Image()
    img.src = `data:image/png;base64,${png}`
    await img.decode()
    const canvas = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height })
    const g = canvas.getContext('2d')!
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, img.width, img.height).data
    let dark = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 384) dark++
    return dark / (d.length / 4)
  }, png)
}

test('a copy that keeps its fields fillable still shows the signature signed in its field, also when reopened', async ({ page }) => {
  const errors = trackPageErrors(page)
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 0)
  const signatureField = page.locator('[data-page-index] [data-form-field="Signature"]')
  const dateField = page.locator('[data-page-index] [data-form-field="Date"]')
  await signatureField.scrollIntoViewIfNeeded()
  await signatureField.click()
  const signDialog = page.getByRole('dialog')
  await signDialog.getByRole('tab', { name: 'Type' }).click()
  await signDialog.getByLabel('Your full name').fill('Dana Levi')
  await signDialog.getByRole('button', { name: 'Use signature' }).click()
  await expect(signDialog).toBeHidden()
  await expect(signatureField).toHaveAttribute('aria-label', 'Signature: signed — sign again')
  // Where the signature is, from the date field next to it (which stays a field).
  await page.keyboard.press('Escape')
  await page.mouse.move(0, 0)
  const [sigBox, dateBox] = [(await signatureField.boundingBox())!, (await dateField.boundingBox())!]
  const signed = await inkShare(page, sigBox)
  expect(signed).toBeGreaterThan(0.01)

  const dialog = await openExportDialog(page)
  const flatten = dialog.getByRole('switch', { name: /flatten form fields/i })
  if ((await flatten.getAttribute('aria-checked')) === 'true') await flatten.click()
  await expect(flatten).toHaveAttribute('aria-checked', 'false')
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /download pdf/i }).click()
  const path = test.info().outputPath('signed-fillable.pdf')
  await (await download).saveAs(path)
  // The signature field under the signature was flattened; the others are still fillable.
  const fields = (await PDFDocument.load(await readFile(path))).getForm().getFields().map((f) => f.getName())
  expect(fields).toContain('Full name')
  expect(fields).not.toContain('Signature')

  // Reopened: the signature shows, with no "Sign here" over it, and nothing asks for it again.
  await page.getByRole('button', { name: 'Back to home' }).click()
  await openPdf(page, path)
  await showPage(page, 0)
  await dateField.scrollIntoViewIfNeeded()
  await expect(page.locator('[data-form-field="Signature"]')).toHaveCount(0)
  await expect(page.getByText('Not signed yet')).toHaveCount(0)
  const date = (await dateField.boundingBox())!
  // (The copy may open at another zoom.)
  const k = date.width / dateBox.width
  const reopened = await inkShare(page, {
    x: date.x + (sigBox.x - dateBox.x) * k,
    y: date.y + (sigBox.y - dateBox.y) * k,
    width: sigBox.width * k,
    height: sigBox.height * k,
  })
  expect(reopened).toBeGreaterThan(signed * 0.5)
  expect(errors).toEqual([])
})

/** A Letter page with a sticky note (a comment, its author and pop-up) at view x 420–444, y 178–202. */
async function writeCommentedPdf(path: string) {
  const doc = await PDFDocument.create()
  const ctx = doc.context
  const page = doc.addPage([612, 792])
  const look = ctx.register(ctx.formXObject([setFillingRgbColor(1, 0.8, 0), rectangle(0, 0, 24, 24), fill()], { BBox: [0, 0, 24, 24] }))
  const note = ctx.register(
    ctx.obj({ Type: 'Annot', Subtype: 'Text', F: 28, Rect: [420, 590, 444, 614], AP: { N: look }, Contents: PDFString.of('Please sign here'), T: PDFString.of('Reviewer') }),
  )
  const popup = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [444, 520, 600, 614], Parent: note }))
  ctx.lookup(note, PDFDict).set(PDFName.of('Popup'), popup)
  page.node.set(PDFName.of('Annots'), ctx.obj([note, popup]))
  await writeFile(path, await doc.save())
}

test('a checkmark placed over a comment keeps the comment, its author and pop-up in the download', async ({ page }) => {
  const errors = trackPageErrors(page)
  const file = test.info().outputPath('commented.pdf')
  await writeCommentedPdf(file)
  await gotoHome(page)
  await openPdf(page, file)
  await showPage(page, 0)
  await selectTool(page, 'Checkmark', 'C')
  await clickPagePoint(page, 0, { x: 440, y: 190 }, { width: 612, height: 792 })
  await expect(page.locator('[data-element-id]')).toHaveCount(1)

  const { bytes } = await downloadPdf(page)
  const doc = await PDFDocument.load(bytes)
  const annots = doc.getPage(0).node.Annots()!
  const dicts = annots.asArray().map((ref) => doc.context.lookup(ref, PDFDict))
  const text = (dict: PDFDict, key: string) => dict.lookupMaybe(PDFName.of(key), PDFString, PDFHexString)?.decodeText()
  expect(dicts.map((d) => [String(d.get(PDFName.of('Subtype'))), text(d, 'Contents'), text(d, 'T')])).toEqual([
    ['/Text', 'Please sign here', 'Reviewer'],
    ['/Popup', undefined, undefined],
  ])
  expect(dicts[0].get(PDFName.of('Popup'))).toBe(annots.get(1))
  expect(errors).toEqual([])
})

test('says when the downloaded copy of a password-protected PDF won’t need the password', async ({ page }) => {
  await gotoHome(page)
  await openWithPassword(page, fixture('password.pdf'), 'fillflow')
  const dialog = await openExportDialog(page)
  await expect(dialog).toContainText('The downloaded copy won’t be password-protected')
  await expect(dialog).not.toContainText('match the original file')

  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /download pdf/i }).click()
  const bytes = new Uint8Array(await readFile(await (await download).path()))
  // As the dialog said: the copy opens without the password.
  expect((await PDFDocument.load(bytes)).isEncrypted).toBe(false)
})

test('the summary line wraps on a narrow phone instead of running out of its card', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 })
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 0)
  const dialog = await openExportDialog(page)
  const summary = dialog.locator('p', { hasText: 'items placed' })
  for (const width of [360, 320]) {
    await page.setViewportSize({ width, height: 780 })
    // Nothing is wider than its box: the line wraps between its parts, so the dialog doesn't scroll
    // sideways. No line starts with a separator (it's clipped off), so none dangles.
    await expect
      .poll(() =>
        summary.evaluate((p) => {
          let body = p.parentElement
          while (body && !/auto|scroll/.test(getComputedStyle(body).overflowY)) body = body.parentElement
          const clip = p.parentElement!.getBoundingClientRect()
          const parts = [...p.children].map((part) => ({ top: part.getBoundingClientRect().top, separator: part.firstElementChild!.getBoundingClientRect() }))
          const lineStarts = parts.filter((part, i) => i === 0 || part.top > parts[i - 1].top)
          return {
            line: p.scrollWidth <= p.clientWidth,
            dialog: !!body && body.scrollWidth <= body.clientWidth,
            lines: lineStarts.length,
            separatorsAtLineStarts: lineStarts.filter((part) => part.separator.right > clip.left + 0.5).length,
          }
        }),
      )
      .toEqual({ line: true, dialog: true, lines: 2, separatorsAtLineStarts: 0 })
  }
})

test('⌘/Ctrl+S waits while the More menu is open, and the browser’s “Save page” stays away', async ({ page }) => {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 0)
  await page.evaluate(() => {
    const w = window as unknown as { saveKeys: string[] }
    w.saveKeys = []
    window.addEventListener('keydown', (e) => e.code === 'KeyS' && setTimeout(() => w.saveKeys.push(e.defaultPrevented ? 'blocked' : 'allowed')), true)
  })
  const more = page.getByRole('button', { name: 'More', exact: true })
  await more.focus()
  await page.keyboard.press('Enter')
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => page.evaluate(() => (window as unknown as { saveKeys: string[] }).saveKeys)).toEqual(['blocked'])
  // Nothing opened under the menu, which keeps the keyboard: Escape closes it, back to "More".
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(more).toBeFocused()
  // With the menu closed, the shortcut opens the dialog.
  await page.keyboard.press('ControlOrMeta+s')
  await expect(page.getByRole('dialog', { name: /download pdf/i })).toBeVisible()
})

test('with flattening off, says which fields are flattened anyway: the ones under items placed on them', async ({ page }) => {
  await gotoHome(page)
  await page.evaluate(() => localStorage.setItem('fillflow:export:flatten', '0'))
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 0)
  // A checkmark over the "Full name" field.
  const field = await formField(page, 'Full name')
  await field.scrollIntoViewIfNeeded()
  const box = (await field.boundingBox())!
  await selectTool(page, 'Checkmark', 'C')
  await page.mouse.click(box.x + box.width - 20, box.y + box.height / 2)
  await expect(page.locator('[data-element-id]')).toHaveCount(1)

  const dialog = await openExportDialog(page)
  const flatten = dialog.getByRole('switch', { name: /flatten form fields/i })
  await expect(flatten).toHaveAttribute('aria-checked', 'false')
  await expect(dialog).toContainText('“Full name” will still be flattened so what you placed on it stays visible.')
  // Flattening them all: none to single out.
  await flatten.click()
  await expect(dialog).not.toContainText('will still be flattened')
})

/** A Letter page with a "Full name" field and an opaque "Attach photo" push button at view x 150–270, y 182–332. */
async function writeButtonPdf(path: string) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  const form = doc.getForm()
  form.createTextField('Full name').addToPage(page, { x: 150, y: 660, width: 300, height: 24 })
  const photo = form.createButton('Photo')
  photo.addToPage('Attach photo', page, { x: 150, y: 460, width: 120, height: 150, backgroundColor: rgb(0.85, 0.9, 1), borderWidth: 0 })
  photo.acroField.getWidgets()[0].dict.set(PDFName.of('A'), doc.context.obj({ Type: 'Action', S: 'Named', N: 'Print' }))
  await writeFile(path, await doc.save())
}

/** Page 1 of a PDF as viewers paint it (annotations over the page): a pixel reader in view space. */
async function paintedPage(bytes: Uint8Array, scale = 2) {
  const { data, width } = await withPdf(bytes, async (pdf) => {
    const p = await pdf.getPage(1)
    const viewport = p.getViewport({ scale })
    const factory = (pdf as unknown as { canvasFactory: { create(w: number, h: number): { canvas: unknown; context: CanvasRenderingContext2D } } }).canvasFactory
    const { canvas, context } = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height))
    await p.render({ canvas: canvas as HTMLCanvasElement, canvasContext: context, viewport, background: 'white' }).promise
    return { data: context.getImageData(0, 0, Math.ceil(viewport.width), Math.ceil(viewport.height)).data, width: Math.ceil(viewport.width) }
  })
  const at = (x: number, y: number) => [...data.subarray((Math.floor(y * scale) * width + Math.floor(x * scale)) * 4).slice(0, 3)]
  return {
    at,
    /** Share of dark pixels in a view-space rect. */
    ink(x: number, y: number, w: number, h: number) {
      let dark = 0
      let total = 0
      for (let yy = y; yy < y + h; yy += 1 / scale) {
        for (let xx = x; xx < x + w; xx += 1 / scale, total++) if (at(xx, yy).reduce((a, b) => a + b) < 384) dark++
      }
      return dark / total
    },
  }
}

test('with flattening off, a checkmark placed on a push button shows over it in the download', async ({ page }) => {
  const errors = trackPageErrors(page)
  const file = test.info().outputPath('photo-button.pdf')
  await writeButtonPdf(file)
  await gotoHome(page)
  await page.evaluate(() => localStorage.setItem('fillflow:export:flatten', '0'))
  await openPdf(page, file)
  await showPage(page, 0)
  // The editor shows the button in the page, under the checkmark.
  await selectTool(page, 'Checkmark', 'C')
  await clickPagePoint(page, 0, { x: 210, y: 300 }, { width: 612, height: 792 })
  await expect(page.locator('[data-element-id]')).toHaveCount(1)

  const { bytes } = await downloadPdf(page)
  // Viewers paint buttons over the page: this one was flattened, under the checkmark, which shows.
  const painted = await paintedPage(bytes)
  expect(painted.ink(206, 296, 8, 8)).toBeGreaterThan(0.1)
  const look = painted.at(155, 325)
  expect([217, 230, 255].every((v, i) => Math.abs(look[i] - v) <= 8), `the button’s look under it: ${look}`).toBe(true)
  // The name, which nothing covers, is still a field to fill.
  expect((await PDFDocument.load(bytes)).getForm().getFields().map((f) => f.getName())).toEqual(['Full name'])
  expect(errors).toEqual([])
})

/** Opens a PDF under another name, as one saved under that name would be. */
async function openNamed(page: Page, file: string, name: string) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /Choose PDF/ }).click()
  await (await chooser).setFiles({ name, mimeType: 'application/pdf', buffer: await readFile(file) })
  await showPage(page, 0)
}

test('Hebrew abbreviations in the file name keep their marks, and the field shows the name the file gets', async ({ page }) => {
  const errors = trackPageErrors(page)
  await gotoHome(page)
  // Named with the ASCII quote a Hebrew keyboard types for the gershayim (fine on macOS and Linux).
  await openNamed(page, SAMPLE_PDF, 'טופס 101 - חברת דוגמה בע"מ.pdf')
  let dialog = await openExportDialog(page)
  const name = dialog.getByRole('textbox', { name: /file name/i })
  await expect(name).toHaveValue('טופס 101 - חברת דוגמה בע״מ-filled')

  // Typed over the selected name the way a Hebrew keyboard types it, then Enter right away.
  await name.selectText()
  await page.keyboard.type(`ז'בוטינסקי ת"א 2026/27`)
  await expect(name).toHaveValue('ז׳בוטינסקי ת״א 2026-27')
  let download = page.waitForEvent('download')
  await page.keyboard.press('Enter')
  expect((await download).suggestedFilename()).toBe('ז׳בוטינסקי ת״א 2026-27.pdf')

  // Typed in the middle of a name: the caret stays where the typing is.
  dialog = await openExportDialog(page)
  await name.fill('חברה (עותק)')
  await name.evaluate((input: HTMLInputElement) => input.setSelectionRange(4, 4))
  await page.keyboard.type(' בע"מ')
  await expect(name).toHaveValue('חברה בע״מ (עותק)')
  expect(await name.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([9, 9])
  download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /download pdf/i }).click()
  expect((await download).suggestedFilename()).toBe('חברה בע״מ (עותק).pdf')
  expect(errors).toEqual([])
})

test('quotes typed in front of a Hebrew name stay quotes: the word after them doesn’t make them marks', async ({ page }) => {
  const errors = trackPageErrors(page)
  await gotoHome(page)
  await openNamed(page, SAMPLE_PDF, 'טופס 101 - ישראל כהן.pdf')
  const dialog = await openExportDialog(page)
  const name = dialog.getByRole('textbox', { name: /file name/i })
  await expect(name).toHaveValue('טופס 101 - ישראל כהן-filled')
  await name.press('Home')
  await page.keyboard.type(`'טיוטה' `)
  await expect(name).toHaveValue(`'טיוטה' טופס 101 - ישראל כהן-filled`)
  let download = page.waitForEvent('download')
  await page.keyboard.press('Enter')
  expect((await download).suggestedFilename()).toBe(`'טיוטה' טופס 101 - ישראל כהן-filled.pdf`)

  // " can't be in a file name: around a word it becomes "-", not the gershayim of an abbreviation.
  await openExportDialog(page)
  await name.fill('טופס 101')
  await name.press('Home')
  await page.keyboard.type(`"סופי" `)
  await expect(name).toHaveValue('-סופי- טופס 101')
  download = page.waitForEvent('download')
  await page.keyboard.press('Enter')
  expect((await download).suggestedFilename()).toBe('סופי- טופס 101.pdf')
  expect(errors).toEqual([])
})

test('“.pdf” follows the end of the file name: on the left of a Hebrew one', async ({ page }) => {
  await gotoHome(page)
  await openNamed(page, SAMPLE_PDF, 'טופס 101 - ישראל כהן.pdf')
  const dialog = await openExportDialog(page)
  const name = dialog.getByRole('textbox', { name: /file name/i })
  const ext = dialog.getByText('.pdf', { exact: true })
  const extSide = async () => {
    const [n, e] = [(await name.boundingBox())!, (await ext.boundingBox())!]
    return e.x + e.width <= n.x ? 'left' : e.x >= n.x + n.width ? 'right' : 'over'
  }
  await expect(name).toHaveValue('טופס 101 - ישראל כהן-filled')
  expect(await extSide()).toBe('left')
  // A click next to it puts the caret at the end of the name, where typing adds to it.
  const box = (await name.boundingBox())!
  await page.mouse.click(box.x + 4, box.y + box.height / 2)
  expect(await name.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe('טופס 101 - ישראל כהן-filled'.length)
  // Emptied, the default name it shows instead is laid out the same way.
  await name.fill('')
  expect(await extSide()).toBe('left')
  // An English name puts it on the right.
  await name.fill('Form 101')
  expect(await extSide()).toBe('right')
})

/** WCAG contrast ratio of two opaque `rgb(…)` colors. */
function contrast(a: string, b: string): number {
  const luminance = (color: string) => {
    const [r, g, bl] = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map((v) => {
        const c = Number(v) / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`the file name field’s border stands out 3:1, also hovered (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme })
    await gotoHome(page)
    await openPdf(page, SAMPLE_PDF)
    await showPage(page, 0)
    const dialog = await openExportDialog(page)
    const name = dialog.getByRole('textbox', { name: /file name/i })
    // The box around the name and ".pdf" draws the border; read once it has finished changing color.
    const box = name.locator('..')
    const colors = () =>
      box.evaluate(async (el) => {
        await Promise.all(el.getAnimations().map((a) => a.finished))
        return [getComputedStyle(el).borderTopColor, getComputedStyle(el).backgroundColor]
      })
    // Focused, it's drawn in the accent color: move on to the next control, and the mouse away.
    await page.keyboard.press('Tab')
    await expect(name).not.toBeFocused()
    await page.mouse.move(0, 0)
    const [border, fill] = await colors()
    expect(contrast(border, fill), `${border} on ${fill}`).toBeGreaterThanOrEqual(3)
    await box.hover()
    const [hovered, hoverFill] = await colors()
    expect(hovered).not.toBe(border)
    expect(contrast(hovered, hoverFill), `${hovered} on ${hoverFill}`).toBeGreaterThanOrEqual(3)
  })
}
