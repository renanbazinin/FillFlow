import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  SAMPLE_PDF,
  clickPagePoint,
  fillFormField,
  gotoHome,
  openPdf,
  pdfPage,
  recentDocument,
  showPage,
  storedSessions,
  trackPageErrors,
} from './support/app'
import { readViewSizes } from './support/pdf'

/**
 * The signature dialog and picture import: text pasted along with a picture of it, Ctrl/⌘+S and
 * Ctrl/⌘+O inside the dialog (on any keyboard layout), keyboard focus inside the dialog and back on
 * the dock, Ctrl/⌘+Z under a confirmation, error messages, and SVG and EXIF-rotated pictures.
 */

/** A 24 × 24 icon, as icon sets ship them. */
const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" fill="none" stroke="#0f172a" stroke-width="2.5"/></svg>'
/** A signature exported from a drawing app at a small nominal size. */
const SIGNATURE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="48" viewBox="0 0 160 48"><path d="M6 38c18-30 38-30 50-6s30 18 46-10 34-8 52 4" fill="none" stroke="#111827" stroke-width="2.5" stroke-linecap="round"/></svg>'

async function openEditor(page: Page): Promise<void> {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 0)
}

function dockButton(page: Page, label: string): Locator {
  return page.getByRole('button', { name: label, exact: true }).filter({ visible: true }).first()
}

/** Opens the signature dialog from the dock (through "New signature" once something is saved). */
async function openSignatureDialog(page: Page): Promise<Locator> {
  await dockButton(page, 'Signature').click()
  const dialog = page.getByRole('dialog', { name: 'Add your signature' })
  const createNew = page.getByRole('button', { name: 'New signature' })
  await expect(dialog.or(createNew)).toBeVisible()
  if (await createNew.isVisible()) await createNew.click()
  await expect(dialog).toBeVisible()
  return dialog
}

/** Waits for the element's own animations (a popover or dialog opening) to finish. */
async function animationsDone(locator: Locator): Promise<void> {
  await locator.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
}

/** One mouse stroke across the drawing pad. */
async function drawStroke(page: Page, pad: Locator, dy = 0): Promise<void> {
  const box = await pad.boundingBox()
  if (!box) throw new Error('The drawing pad is not visible')
  const y = box.y + box.height * (0.4 + dy)
  await page.mouse.move(box.x + box.width * 0.2, y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width * (0.2 + i * 0.07), y + (i % 2) * 8)
  await page.mouse.up()
}

/** Letter keys as Chrome reports them on a Hebrew keyboard layout: the layout's own letter, on the Latin key. */
const HEBREW_KEYS = {
  s: { key: 'ד', code: 'KeyS', windowsVirtualKeyCode: 83 },
  o: { key: 'ם', code: 'KeyO', windowsVirtualKeyCode: 79 },
  z: { key: 'ז', code: 'KeyZ', windowsVirtualKeyCode: 90 },
}

/** Presses Ctrl/⌘ + a letter key on a Hebrew keyboard layout (Playwright's keyboard types US keys only). */
async function hebrewKeyboard(page: Page): Promise<(letter: keyof typeof HEBREW_KEYS) => Promise<void>> {
  const cdp = await page.context().newCDPSession(page)
  const modifiers = process.platform === 'darwin' ? 4 : 2 // ⌘ / Ctrl
  return async (letter) => {
    for (const type of ['rawKeyDown', 'keyUp'] as const) await cdp.send('Input.dispatchKeyEvent', { type, modifiers, ...HEBREW_KEYS[letter] })
  }
}

test('text pasted into the name field stays text when the clipboard also holds a picture of it', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openEditor(page)
  const dialog = await openSignatureDialog(page)
  await dialog.getByRole('tab', { name: 'Type' }).click()
  const name = dialog.getByLabel('Your full name')
  await name.focus()

  // A paste as copying a cell in Excel makes it: the text plus a picture of the cell.
  const paste = (text: string) =>
    name.evaluate(async (input, text) => {
      const canvas = document.createElement('canvas')
      canvas.width = 120
      canvas.height = 24
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, 120, 24)
      ctx.fillStyle = '#000'
      ctx.fillRect(8, 8, 100, 8)
      const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      const data = new DataTransfer()
      if (text) data.setData('text/plain', text)
      data.items.add(new File([png!], 'image.png', { type: 'image/png' }))
      const e = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
      input.dispatchEvent(e)
      return e.defaultPrevented
    }, text)

  // Left to the browser, which pastes the text; the dialog stays on Type.
  expect(await paste('Ada Lovelace')).toBe(false)
  await expect(dialog.getByRole('tab', { name: 'Type' })).toHaveAttribute('aria-selected', 'true')
  // A picture on its own is still uploaded.
  expect(await paste('')).toBe(true)
  await expect(dialog.getByRole('tab', { name: 'Upload' })).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByRole('img', { name: 'Preview of the uploaded signature' })).toBeVisible()
  expect(errors).toEqual([])
})

test('Ctrl/⌘+S and Ctrl/⌘+O in the signature dialog never open the browser’s own dialogs', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openEditor(page)
  const dialog = await openSignatureDialog(page)
  const pressHebrew = await hebrewKeyboard(page)
  // Whether the browser would still act on each key, read once every handler had its turn. Keys are
  // picked out by physical key. Shortcuts go by the letter a Latin layout types, and by physical key
  // only where the layout types no Latin letter: on the two layouts used here, US and Hebrew, that
  // comes to the same keys.
  await page.evaluate(() => {
    const w = window as unknown as { browserKeys: string[] }
    w.browserKeys = []
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code === 'KeyS' || e.code === 'KeyO') setTimeout(() => w.browserKeys.push(`${e.key}: ${e.defaultPrevented ? 'blocked' : 'allowed'}`))
      },
      true,
    )
  })
  const browserKeys = () => page.evaluate(() => (window as unknown as { browserKeys: string[] }).browserKeys)
  /** Ctrl/⌘+S and Ctrl/⌘+O on a US keyboard layout, then on a Hebrew one: the browser acts on none. */
  const expectSaveAndOpenBlocked = async () => {
    await page.evaluate(() => ((window as unknown as { browserKeys: string[] }).browserKeys = []))
    await page.keyboard.press('ControlOrMeta+s')
    await page.keyboard.press('ControlOrMeta+o')
    await pressHebrew('s')
    await pressHebrew('o')
    await expect.poll(browserKeys).toEqual(['s: blocked', 'o: blocked', 'ד: blocked', 'ם: blocked'])
  }

  const draw = dialog.getByRole('tab', { name: 'Draw' })
  const cancel = dialog.getByRole('button', { name: 'Cancel' })
  for (const target of [draw, cancel]) {
    await target.focus()
    await expectSaveAndOpenBlocked()
  }
  await dialog.getByRole('tab', { name: 'Type' }).click()
  await dialog.getByLabel('Your full name').focus()
  await expectSaveAndOpenBlocked()

  await expect(dialog).toBeVisible()
  expect(errors).toEqual([])
})

test('focus stays in the signature dialog, and Ctrl/⌘+Z keeps undoing strokes', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openEditor(page)
  const dialog = await openSignatureDialog(page)
  await dialog.getByRole('tab', { name: 'Draw' }).click()
  const pad = dialog.getByRole('img', { name: /^Drawing area/ })
  const undo = dialog.getByRole('button', { name: 'Undo last stroke' })
  const clear = dialog.getByRole('button', { name: 'Clear drawing' })

  // Undoing the last stroke leaves focus on Undo, so the shortcut keeps working from there.
  await drawStroke(page, pad)
  await undo.click()
  await expect(pad).not.toHaveAccessibleName(/so far/)
  await expect(undo).toBeFocused()
  await expect(undo).toHaveAttribute('aria-disabled', 'true')
  await drawStroke(page, pad)
  await drawStroke(page, pad, 0.15)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(pad).toHaveAccessibleName(/1 stroke so far/)

  // The same for Clear, used from the keyboard.
  await clear.focus()
  await page.keyboard.press('Enter')
  await expect(pad).not.toHaveAccessibleName(/so far/)
  await expect(clear).toBeFocused()

  // Wherever focus is while the dialog is open, even on <body>, Ctrl/⌘+Z undoes a stroke.
  await drawStroke(page, pad)
  await drawStroke(page, pad, 0.15)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('ControlOrMeta+z')
  await expect(pad).toHaveAccessibleName(/1 stroke so far/)

  // On a Hebrew keyboard layout too, where that key types "ז".
  const pressHebrew = await hebrewKeyboard(page)
  await drawStroke(page, pad, 0.3)
  await expect(pad).toHaveAccessibleName(/2 strokes so far/)
  await dialog.getByRole('tab', { name: 'Draw' }).focus()
  await pressHebrew('z')
  await expect(pad).toHaveAccessibleName(/1 stroke so far/)
  expect(errors).toEqual([])
})

test('after a press on a tab of the signature dialog, Tab into the tab list goes to that tab', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openEditor(page)
  const dialog = await openSignatureDialog(page)
  const tab = (name: string) => dialog.getByRole('tab', { name })
  await tab('Type').click()
  await expect(tab('Type')).toHaveAttribute('aria-selected', 'true')
  await expect(tab('Type')).toBeFocused()
  // Out of the tab list and back: focus lands on the pressed tab, not on the list itself (unseen).
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(tab('Type')).toBeFocused()
  // The arrow keys still switch tabs.
  await page.keyboard.press('ArrowRight')
  await expect(tab('Upload')).toBeFocused()
  await expect(tab('Upload')).toHaveAttribute('aria-selected', 'true')
  expect(errors).toEqual([])
})

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true })

  test('a tap on a tab of the signature dialog switches to it', async ({ page }) => {
    const errors = trackPageErrors(page)
    await openEditor(page)
    const dialog = await openSignatureDialog(page)
    for (const name of ['Upload', 'Type', 'Draw']) {
      const tab = dialog.getByRole('tab', { name })
      await tab.tap()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
      await expect(tab).toBeFocused()
    }
    await expect(dialog.getByRole('img', { name: /^Drawing area/ })).toBeVisible()
    expect(errors).toEqual([])
  })
})

test('deleting a saved signature from the dialog keeps focus in the dialog', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openEditor(page)
  // Two typed signatures, saved for next time (the default).
  for (const name of ['Ada Lovelace', 'Grace Hopper']) {
    const dialog = await openSignatureDialog(page)
    await dialog.getByRole('tab', { name: 'Type' }).click()
    await dialog.getByLabel('Your full name').fill(name)
    await dialog.getByRole('button', { name: 'Use signature' }).click()
    await expect(dialog).toBeHidden()
    await page.keyboard.press('Escape') // don't place it
  }

  const dialog = await openSignatureDialog(page)
  const remove = dialog.getByRole('button', { name: /^Delete signature saved/ })
  const confirmation = page.getByRole('alertdialog')
  await expect(remove).toHaveCount(2)

  // Cancelled: focus is back on the × that was pressed.
  await remove.first().focus()
  await page.keyboard.press('Enter')
  await confirmation.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirmation).toBeHidden()
  await expect(remove.first()).toBeFocused()

  // Deleted: focus moves to the remaining saved signature…
  await page.keyboard.press('Enter')
  await confirmation.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(remove).toHaveCount(1)
  await expect(dialog.getByRole('button', { name: /^Place signature saved/ })).toBeFocused()

  // …and once none are left, to the tabs.
  await remove.focus()
  await page.keyboard.press('Enter')
  await confirmation.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(remove).toHaveCount(0)
  await expect(dialog.getByRole('tab', { selected: true })).toBeFocused()
  expect(errors).toEqual([])
})

test('Ctrl/⌘+Z leaves the drawing alone while a confirmation is open over the dialog', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openEditor(page)
  // A saved signature, to have one to delete.
  let dialog = await openSignatureDialog(page)
  await dialog.getByRole('tab', { name: 'Type' }).click()
  await dialog.getByLabel('Your full name').fill('Ada Lovelace')
  await dialog.getByRole('button', { name: 'Use signature' }).click()
  await expect(dialog).toBeHidden()
  await page.keyboard.press('Escape') // don't place it

  dialog = await openSignatureDialog(page)
  await dialog.getByRole('tab', { name: 'Draw' }).click()
  const pad = dialog.getByRole('img', { name: /^Drawing area/ })
  await drawStroke(page, pad)
  await drawStroke(page, pad, 0.15)
  await expect(pad).toHaveAccessibleName(/2 strokes so far/)

  // The delete confirmation, with focus fallen to <body> after a press on its backdrop.
  await dialog.getByRole('button', { name: /^Delete signature saved/ }).click()
  const confirmation = page.getByRole('alertdialog')
  await expect(confirmation).toBeVisible()
  await page.mouse.click(15, 15)
  await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true)
  await expect(confirmation).toBeVisible()
  await page.keyboard.press('ControlOrMeta+z')

  // Closed: the drawing is as it was, and the shortcut undoes strokes again.
  await confirmation.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirmation).toBeHidden()
  await expect(pad).toHaveAccessibleName(/2 strokes so far/)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(pad).toHaveAccessibleName(/1 stroke so far/)
  expect(errors).toEqual([])
})

test('a new signature or initials started from the saved list by keyboard gives focus back to the dock button', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openEditor(page)
  const focused = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
  for (const [role, label, shortcut] of [
    ['signature', 'Signature', 's'],
    ['initials', 'Initials', 'i'],
  ] as const) {
    const dialog = page.getByRole('dialog', { name: `Add your ${role}` })
    const name = dialog.getByRole('textbox', { name: role === 'signature' ? 'Your full name' : 'Your initials' })
    const use = dialog.getByRole('button', { name: `Use ${role}` })
    // One saved, so the dock button opens the saved list.
    await dockButton(page, label).click()
    await dialog.getByRole('tab', { name: 'Type' }).click()
    await name.fill(role === 'signature' ? 'Ada Lovelace' : 'AL')
    await use.click()
    await expect(dialog).toBeHidden()
    await page.keyboard.press('Escape') // don't place it

    const fromDock = async () => {
      await dockButton(page, label).focus()
      await page.keyboard.press('Enter')
    }
    const fromShortcut = async () => {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await page.keyboard.press(shortcut)
    }
    /** Opens the saved list with `open`, starts a new one there by keyboard, then closes the dialog with `close`. */
    const createNew = async (open: () => Promise<void>, close: () => Promise<void>) => {
      await open()
      await page.getByRole('dialog', { name: /^Saved / }).getByRole('button', { name: `New ${role}` }).focus()
      await page.keyboard.press('Enter')
      await expect(dialog).toBeVisible()
      await close()
      await expect(dialog).toBeHidden()
      await expect.poll(focused).toBe(label)
    }
    await createNew(fromDock, () => page.keyboard.press('Escape'))
    await createNew(fromShortcut, () => page.keyboard.press('Escape'))
    await createNew(fromDock, async () => {
      await dialog.getByRole('button', { name: 'Cancel' }).focus()
      await page.keyboard.press('Enter')
    })
    // Used: while it waits to be placed, the dock button's tooltip doesn't cover the placement hint.
    await createNew(fromDock, async () => {
      await dialog.getByRole('tab', { name: 'Type' }).focus()
      await name.fill(role === 'signature' ? 'Grace Hopper' : 'GH')
      await use.focus()
      await page.keyboard.press('Enter')
    })
    await expect(page.getByText(`Click to place your ${role}`)).toBeVisible()
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await page.keyboard.press('Escape') // don't place it
  }
  expect(errors).toEqual([])
})

test('opening the saved signatures clears the messages that would cover them; the signature dialog keeps errors', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openEditor(page)
  const shown = page.locator('[data-sonner-toast]:not([data-removed="true"])')
  // A signature waiting to be placed, with its "Click where…" message.
  const dialog = await openSignatureDialog(page)
  await dialog.getByRole('tab', { name: 'Type' }).click()
  await dialog.getByLabel('Your full name').fill('Ada Lovelace')
  await dialog.getByRole('button', { name: 'Use signature' }).click()
  await expect(dialog).toBeHidden()
  const placeMessage = shown.filter({ hasText: 'Click where you want to place it' })
  await expect(placeMessage).toBeVisible()
  // An error that passes: a picture that can't be opened.
  const pickBrokenPicture = () =>
    page
      .locator('input[type="file"][accept="image/*"]')
      .first()
      .setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not a picture') })
  await pickBrokenPicture()
  const error = shown.filter({ hasText: /This image couldn.t be opened/ })
  await expect(error).toBeVisible()

  // The saved list opens where messages sit, so they all go. One left up would hide the newest tile
  // and, with the pointer resting on it, stay there: a press on the tile would never reach it.
  await dockButton(page, 'Signature').click()
  const saved = page.getByRole('dialog', { name: 'Saved signatures' })
  await expect(saved).toBeVisible()
  await animationsDone(saved)
  const box = (await saved.getByRole('button', { name: /^Place signature saved/ }).first().boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect(placeMessage).toHaveCount(0)
  await expect(error).toHaveCount(0)
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0) // gone, not just leaving
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(saved).toBeHidden()
  await expect(page.getByText('Click to place your signature')).toBeVisible()
  await page.keyboard.press('Escape') // don't place it

  // The dialog keeps errors: one raised while the saved list is open stays up when "New" opens it.
  await dockButton(page, 'Signature').click()
  await expect(saved).toBeVisible()
  await pickBrokenPicture()
  await expect(error).toBeVisible()
  await saved.getByRole('button', { name: 'New signature' }).click()
  await expect(dialog).toBeVisible()
  await animationsDone(dialog)
  await expect(error).toBeVisible()
  expect(errors).toEqual([])
})

test('opening the saved signatures leaves up an error that stays until it is acted on', async ({ page, context }) => {
  const errors = trackPageErrors(page)
  await openEditor(page)
  const shown = page.locator('[data-sonner-toast]:not([data-removed="true"])')
  // One saved, so the dock button opens the saved list.
  const dialog = await openSignatureDialog(page)
  await dialog.getByRole('tab', { name: 'Type' }).click()
  await dialog.getByLabel('Your full name').fill('Ada Lovelace')
  await dialog.getByRole('button', { name: 'Use signature' }).click()
  await expect(dialog).toBeHidden()
  await page.keyboard.press('Escape') // don't place it

  // Newer work on the document is saved in another tab: this one stops saving, and says so until reloaded.
  const savedName = async (p: Page) => (await storedSessions(p)).find((s) => s.fileName === 'sample-form.pdf')?.formValues['Full name']
  await fillFormField(page, 'Full name', 'From tab A')
  await expect.poll(() => savedName(page)).toBe('From tab A')
  const other = await context.newPage()
  await gotoHome(other)
  await (await recentDocument(other, /sample-form/i)).click()
  await fillFormField(other, 'Full name', 'From tab B')
  await expect.poll(() => savedName(other)).toBe('From tab B')
  await other.close()
  const outdated = shown.filter({ hasText: 'This document was changed in another tab' })
  await expect(outdated).toBeVisible()

  await dockButton(page, 'Signature').click()
  const saved = page.getByRole('dialog', { name: 'Saved signatures' })
  await expect(saved).toBeVisible()
  await animationsDone(saved)
  await expect(outdated).toBeVisible()
  await expect(outdated.getByRole('button', { name: 'Reload' })).toBeVisible()
  expect(errors).toEqual([])
})

test('SVG pictures are drawn at full resolution, not at their nominal size', async ({ page }) => {
  const errors = trackPageErrors(page)
  const sizes = await readViewSizes(SAMPLE_PDF)
  await openEditor(page)
  // Placed on page 2, which has no form fields to catch the clicks.
  const placed = (await pdfPage(page, 1)).locator('[data-element-id] img')
  const naturalSizes = () => placed.evaluateAll((imgs) => imgs.map((img) => [(img as HTMLImageElement).naturalWidth, (img as HTMLImageElement).naturalHeight]))

  // Image tool: a 24 × 24 icon becomes a 2000 px picture (it used to stay 24 px, blown up 7.5×).
  await page
    .locator('input[type="file"][accept="image/*"]')
    .first()
    .setInputFiles({ name: 'check.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(ICON_SVG) })
  await expect(dockButton(page, 'Image')).toHaveAttribute('aria-pressed', 'true')
  await clickPagePoint(page, 1, { x: 160, y: 470 }, sizes[1])
  await expect.poll(naturalSizes).toEqual([[2000, 2000]])

  // Signature upload: a 160 × 48 SVG comes out at the full output size (1600 px), not upscaled from 160 px.
  const dialog = await openSignatureDialog(page)
  await dialog.getByRole('tab', { name: 'Upload' }).click()
  await dialog
    .locator('input[type="file"]')
    .setInputFiles({ name: 'signature.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(SIGNATURE_SVG) })
  await expect(dialog.getByRole('img', { name: 'Preview of the uploaded signature' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Use signature' }).click()
  await expect(dockButton(page, 'Signature')).toHaveAttribute('aria-pressed', 'true')
  await clickPagePoint(page, 1, { x: 380, y: 660 }, sizes[1])
  await expect.poll(async () => (await naturalSizes()).length).toBe(2)
  const signature = (await naturalSizes()).find(([w, h]) => w !== h)
  expect(signature && Math.max(...signature)).toBe(1600)
  expect(errors).toEqual([])
})

test('pictures pasted onto the page are prepared like the image tool’s: SVG sharp, photos upright', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openEditor(page)
  const placed = page.locator('[data-element-id] img')
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

  // A 24 × 24 icon becomes a 2000 px picture (it used to stay 24 px).
  await page.evaluate((svg) => {
    const data = new DataTransfer()
    data.items.add(new File([svg], 'check.svg', { type: 'image/svg+xml' }))
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, ICON_SVG)
  await expect
    .poll(() => placed.evaluateAll((imgs) => imgs.map((img) => [(img as HTMLImageElement).naturalWidth, (img as HTMLImageElement).naturalHeight])))
    .toEqual([[2000, 2000]])

  // A 40 × 20 photo whose EXIF says to turn it a quarter clockwise is stored turned: 20 × 40 pixels
  // (a PDF ignores EXIF, so it used to come out sideways and squashed).
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 40
    canvas.height = 20
    canvas.getContext('2d')!.fillRect(0, 0, 40, 20)
    const jpeg = new Uint8Array(await (await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg')))!.arrayBuffer())
    // An APP1 "Exif" segment with one entry, Orientation (0x0112) = 6, after the start-of-image marker.
    const exif = [0xff, 0xe1, 0, 34, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0]
    const data = new DataTransfer()
    data.items.add(new File([jpeg.subarray(0, 2), new Uint8Array(exif), jpeg.subarray(2)], 'photo.jpg', { type: 'image/jpeg' }))
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  const photo = page.locator('[data-element-id] img[src^="data:image/jpeg"]')
  await expect(photo).toHaveCount(1)
  expect(jpegFrameSize((await photo.getAttribute('src'))!)).toEqual([20, 40])
  expect(errors).toEqual([])
})

/** Width and height of a JPEG's pixels as stored (its frame header), whatever its EXIF says. */
function jpegFrameSize(dataUrl: string): [number, number] | null {
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
  for (let i = 2; i + 8 < bytes.length; i += 2 + bytes.readUInt16BE(i + 2)) {
    const marker = bytes[i + 1]
    // Start of frame: C0–CF, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [bytes.readUInt16BE(i + 7), bytes.readUInt16BE(i + 5)]
  }
  return null
}
