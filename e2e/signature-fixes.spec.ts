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
 * the dock, Ctrl/⌘+Z under a confirmation, error messages, SVG and EXIF-rotated pictures, the dialog
 * on a phone held sideways, tap target sizes, legible hints and names, and Hebrew handwriting.
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

/** Opens the signature (or initials) dialog from the dock (through "New …" once something is saved). */
async function openSignatureDialog(page: Page, role: 'signature' | 'initials' = 'signature'): Promise<Locator> {
  await dockButton(page, role === 'signature' ? 'Signature' : 'Initials').click()
  const dialog = page.getByRole('dialog', { name: `Add your ${role}` })
  const createNew = page.getByRole('button', { name: `New ${role}` })
  await expect(dialog.or(createNew)).toBeVisible()
  if (await createNew.isVisible()) await createNew.click()
  await expect(dialog).toBeVisible()
  return dialog
}

/** Makes a typed signature and saves it for next time (the default), without placing it. */
async function saveTypedSignature(page: Page, name: string): Promise<void> {
  const dialog = await openSignatureDialog(page)
  await dialog.getByRole('tab', { name: 'Type' }).click()
  await dialog.getByLabel('Your full name').fill(name)
  await dialog.getByRole('button', { name: 'Use signature' }).click()
  await expect(dialog).toBeHidden()
  await page.keyboard.press('Escape') // don't place it
}

/** How far the scroll area around `inside` (a dialog's body) can scroll, in px. */
function scrollRoom(inside: Locator): Promise<number> {
  return inside.evaluate((el) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return p.scrollHeight - p.clientHeight
    return 0
  })
}

/** Width and height (px, up to 121) of the area across a control's center where a tap lands on it. */
function tapArea(control: Locator): Promise<{ width: number; height: number }> {
  return control.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const [x, y] = [r.left + r.width / 2, r.top + r.height / 2]
    const lands = (px: number, py: number) => {
      const hit = document.elementFromPoint(px, py)
      return hit !== null && el.contains(hit)
    }
    /** 1px steps out from the center that still land on it. */
    const reach = (dx: number, dy: number) => {
      let d = 0
      while (d < 60 && lands(x + dx * (d + 1), y + dy * (d + 1))) d++
      return d
    }
    return { width: reach(-1, 0) + 1 + reach(1, 0), height: reach(0, -1) + 1 + reach(0, 1) }
  })
}

/** Contrast of an element's text against the white paper it is written on (the pad, the style cards). */
function contrastOnWhite(text: Locator): Promise<number> {
  return text.evaluate((el) => {
    // The color as painted (with its alpha and the opacity it is shown at) over white.
    let opacity = 1
    for (let e: Element | null = el; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity)
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 1, 1)
    ctx.globalAlpha = opacity
    ctx.fillStyle = getComputedStyle(el).color
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    const linear = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4)
    return 1.05 / (0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b) + 0.05)
  })
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

test('a new signature or initials started from the saved list by keyboard gives focus back to the dock button, or to the pages once used', async ({ page }) => {
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
    /**
     * Opens the saved list with `open`, starts a new one there by keyboard, then closes the dialog with
     * `close`: focus is then on `focusAfter`.
     */
    const createNew = async (open: () => Promise<void>, close: () => Promise<void>, focusAfter: string = label) => {
      await open()
      await page.getByRole('dialog', { name: /^Saved / }).getByRole('button', { name: `New ${role}` }).focus()
      await page.keyboard.press('Enter')
      await expect(dialog).toBeVisible()
      await close()
      await expect(dialog).toBeHidden()
      await expect.poll(focused).toBe(focusAfter)
    }
    await createNew(fromDock, () => page.keyboard.press('Escape'))
    await createNew(fromShortcut, () => page.keyboard.press('Escape'))
    await createNew(fromDock, async () => {
      await dialog.getByRole('button', { name: 'Cancel' }).focus()
      await page.keyboard.press('Enter')
    })
    // Used: on to the pages, where Enter places it (back on the dock button, Enter would open the list
    // again). No tooltip covers the placement hint.
    await createNew(
      fromDock,
      async () => {
        await dialog.getByRole('tab', { name: 'Type' }).focus()
        await name.fill(role === 'signature' ? 'Grace Hopper' : 'GH')
        await use.focus()
        await page.keyboard.press('Enter')
      },
      'Document pages',
    )
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
  // The dialog's backdrop fades out, and takes clicks meant for the page until it is gone.
  await expect(page.locator('body > [data-state="closed"]')).toHaveCount(0)
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

// A phone held sideways leaves the dialog little height. A swipe on the drawing pad draws rather than
// scrolls, so the Draw tab has to fit: the pad used to push its own controls under the footer.
// 640 × 360 (a 360dp phone) is the narrowest with the drawing controls beside the tabs: that row is tightest there.
for (const viewport of [
  { width: 844, height: 390 },
  { width: 667, height: 375 },
  { width: 640, height: 360 },
]) {
  test.describe(`on a phone held sideways (${viewport.width} × ${viewport.height})`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true })

    test('the Draw tab fits: the pad and every drawing control show, with nothing to scroll', async ({ page }) => {
      const errors = trackPageErrors(page)
      await openEditor(page)
      for (const role of ['signature', 'initials'] as const) {
        const dialog = await openSignatureDialog(page, role)
        await animationsDone(dialog)
        await expect(dialog.getByRole('tab', { name: 'Draw' })).toHaveAttribute('aria-selected', 'true')
        expect(await scrollRoom(dialog.getByRole('tablist'))).toBeLessThanOrEqual(1)
        const controls = [
          dialog.getByRole('img', { name: /^Drawing area/ }),
          ...(await dialog.getByRole('radiogroup', { name: 'Ink color' }).getByRole('radio').all()),
          ...(await dialog.getByRole('radiogroup', { name: 'Pen width' }).getByRole('radio').all()),
          dialog.getByRole('button', { name: 'Undo last stroke' }),
          dialog.getByRole('button', { name: 'Clear drawing' }),
          dialog.getByRole('button', { name: `Use ${role}` }),
        ]
        expect(controls).toHaveLength(10)
        for (const control of controls) await expect(control).toBeInViewport({ ratio: 1 })
        await dialog.getByRole('button', { name: 'Cancel' }).click()
        await expect(dialog).toBeHidden()
      }
      expect(errors).toEqual([])
    })
  })
}

test.describe('on a phone held sideways', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true })

  test('a stroke that runs on under the dialog’s footer leaves no ink where it can’t be seen', async ({ page }) => {
    const errors = trackPageErrors(page)
    await openEditor(page)
    // A saved signature, listed above the tabs: the pad starts low, under the footer.
    await saveTypedSignature(page, 'Ada Lovelace')
    const dialog = await openSignatureDialog(page)
    await dialog.getByRole('tab', { name: 'Draw' }).click()
    await animationsDone(dialog)
    const pad = dialog.getByRole('img', { name: /^Drawing area/ })
    // Scrolled until the top 50px of the pad show above the footer.
    const shown = 50
    await pad.evaluate((canvas, shown) => {
      let area = canvas.parentElement!
      while (!/auto|scroll/.test(getComputedStyle(area).overflowY)) area = area.parentElement!
      area.scrollTop += canvas.getBoundingClientRect().top - (area.getBoundingClientRect().bottom - shown)
    }, shown)

    // Across the part that shows, then down under the footer and off the dialog.
    const box = (await pad.boundingBox())!
    const y = box.y + shown - 15
    const bottom = page.viewportSize()!.height - 4
    await page.mouse.move(box.x + box.width * 0.3, y)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width * (0.3 + i * 0.05), y)
    for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width * 0.7, y + ((bottom - y) * i) / 8)
    await page.mouse.up()
    await expect(pad).toHaveAccessibleName(/1 stroke so far/)

    // The ink stops where the pad went under the footer (give or take the pen's width).
    const inkBottom = await pad.evaluate((canvas: HTMLCanvasElement) => {
      const { width, height } = canvas
      const alpha = canvas.getContext('2d')!.getImageData(0, 0, width, height).data
      for (let row = height - 1; row >= 0; row--) {
        for (let col = 0; col < width; col++) if (alpha[(row * width + col) * 4 + 3]) return ((row + 1) * canvas.getBoundingClientRect().height) / height
      }
      return 0
    })
    expect(inkBottom).toBeGreaterThan(shown - 15)
    expect(inkBottom).toBeLessThan(shown + 5)
    expect(errors).toEqual([])
  })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('the signature dialog’s controls are 40px targets, and a saved signature’s × leaves the rest of it to place it', async ({ page }) => {
    const errors = trackPageErrors(page)
    await openEditor(page)
    await saveTypedSignature(page, 'Ada Lovelace')
    const expectTapTarget = async (control: Locator) => {
      const { width, height } = await tapArea(control)
      expect(Math.min(width, height), String(control)).toBeGreaterThanOrEqual(40)
    }
    /** The saved signature's ×, and a tap on the middle of the tile still places the signature. */
    const expectSavedTile = async (scope: Locator) => {
      await expectTapTarget(scope.getByRole('button', { name: /^Delete signature saved/ }))
      const place = scope.getByRole('button', { name: /^Place signature saved/ })
      const middle = await place.evaluate((el) => {
        const r = el.getBoundingClientRect()
        return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))
      })
      expect(middle).toBe(true)
    }

    // The saved list. It clears the passing messages (the sample's "fields found"), which can cover its
    // tiles while they leave: measured once they're gone.
    await dockButton(page, 'Signature').click()
    const saved = page.getByRole('dialog', { name: 'Saved signatures' })
    await expect(saved).toBeVisible()
    await animationsDone(saved)
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
    await expectSavedTile(saved)
    await expectTapTarget(saved.getByRole('button', { name: 'New signature' }))
    await saved.getByRole('button', { name: 'New signature' }).click()

    // The dialog, with something drawn (Undo, Clear and Use take taps only then).
    const dialog = page.getByRole('dialog', { name: 'Add your signature' })
    await expect(dialog).toBeVisible()
    await animationsDone(dialog)
    await dialog.getByRole('tab', { name: 'Draw' }).click()
    await drawStroke(page, dialog.getByRole('img', { name: /^Drawing area/ }))
    await expectSavedTile(dialog)
    for (const control of [
      ...(await dialog.getByRole('tab').all()),
      ...(await dialog.getByRole('radiogroup', { name: 'Ink color' }).getByRole('radio').all()),
      ...(await dialog.getByRole('radiogroup', { name: 'Pen width' }).getByRole('radio').all()),
      dialog.getByRole('button', { name: 'Undo last stroke' }),
      dialog.getByRole('button', { name: 'Clear drawing' }),
      dialog.getByRole('checkbox', { name: 'Save for next time' }),
      dialog.getByRole('button', { name: 'Close' }),
      dialog.getByRole('button', { name: 'Cancel' }),
      dialog.getByRole('button', { name: 'Use signature' }),
    ]) {
      await expectTapTarget(control)
    }
    expect(errors).toEqual([])
  })
})

test('the signature dialog reads clearly: hints and style names stand out from the paper, and the pen widths are a named group', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openEditor(page)
  for (const [role, hint] of [
    ['signature', 'Sign above the line'],
    ['initials', 'Initial above the line'],
  ] as const) {
    const dialog = await openSignatureDialog(page, role)
    await animationsDone(dialog)
    const pens = dialog.getByRole('radiogroup', { name: 'Pen width' }).getByRole('radio')
    await expect(pens).toHaveCount(3)
    for (const [i, name] of ['Fine pen', 'Medium pen', 'Bold pen'].entries()) await expect(pens.nth(i)).toHaveAccessibleName(name)
    // Small text on white: at least 4.5:1 (WCAG AA).
    expect(await contrastOnWhite(dialog.getByText(hint, { exact: true }))).toBeGreaterThanOrEqual(4.5)
    await dialog.getByRole('tab', { name: 'Type' }).click()
    for (const name of ['Great Vibes', 'Dancing Script', 'Homemade Apple', 'Mr Dafoe', 'Caveat']) {
      expect(await contrastOnWhite(dialog.getByText(name, { exact: true }))).toBeGreaterThanOrEqual(4.5)
    }
    await dialog.getByRole('tab', { name: 'Draw' }).click()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
  }
  expect(errors).toEqual([])
})

test('a name typed in Hebrew is written in each style’s own Hebrew handwriting, on its card and in the signature placed', async ({ page }) => {
  const errors = trackPageErrors(page)
  const sizes = await readViewSizes(SAMPLE_PDF)
  await openEditor(page)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  /** For each style card, the system fonts (not the app's own) its name is drawn with: none, when every letter has a handwriting face. */
  const systemFontsOnCards = async () => {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector: '[role="radiogroup"][aria-label="Handwriting style"] [role="radio"] [dir="auto"]',
    })
    const cards = await Promise.all(nodeIds.map((nodeId) => cdp.send('CSS.getPlatformFontsForNode', { nodeId })))
    return cards.map(({ fonts }) => fonts.filter((f) => !f.isCustomFont).map((f) => f.familyName))
  }

  for (const [role, name] of [
    ['signature', 'ישראל כהן'],
    ['initials', 'י״כ'],
  ] as const) {
    const dialog = await openSignatureDialog(page, role)
    await dialog.getByRole('tab', { name: 'Type' }).click()
    await dialog.getByRole('textbox', { name: role === 'signature' ? 'Your full name' : 'Your initials' }).fill(name)
    // Each card is named after its Hebrew face, and writes every letter in it.
    const styles = dialog.getByRole('radiogroup', { name: 'Handwriting style' }).getByRole('radio')
    await expect(styles).toHaveCount(5)
    for (const [i, face] of ['Gveret Levin', 'Playpen Sans', 'Amatic Bold', 'Playpen Sans Light', 'Amatic'].entries()) {
      await expect(styles.nth(i)).toHaveAccessibleName(face)
    }
    await expect.poll(systemFontsOnCards).toEqual([[], [], [], [], []])
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
  }

  // The signature made in two of the styles, and placed: each in its own face, so unlike the other
  // in shape (written in the same fallback font, they came out alike).
  const placed = (await pdfPage(page, 1)).locator('[data-element-id] img')
  for (const [i, [face, spot]] of (
    [
      ['Amatic', { x: 380, y: 660 }],
      ['Playpen Sans', { x: 380, y: 560 }],
    ] as const
  ).entries()) {
    const dialog = await openSignatureDialog(page)
    await dialog.getByRole('tab', { name: 'Type' }).click()
    await dialog.getByLabel('Your full name').fill('ישראל כהן')
    await dialog.getByRole('radio', { name: face, exact: true }).click()
    await dialog.getByRole('button', { name: 'Use signature' }).click()
    await expect(dockButton(page, 'Signature')).toHaveAttribute('aria-pressed', 'true')
    // The dialog's backdrop fades out, and takes clicks meant for the page until it is gone.
    await expect(page.locator('body > [data-state="closed"]')).toHaveCount(0)
    await clickPagePoint(page, 1, spot, sizes[1])
    await expect(placed).toHaveCount(i + 1)
  }
  const unlike = async () => {
    const shapes = await placed.evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).naturalHeight / (img as HTMLImageElement).naturalWidth))
    return Math.max(...shapes) / Math.min(...shapes)
  }
  await expect.poll(unlike).toBeGreaterThan(1.15)
  expect(errors).toEqual([])
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`in forced colors (${colorScheme}), the inks, the pen widths, “Save for next time” and a saved signature all show`, async ({ page }) => {
    const errors = trackPageErrors(page)
    await page.emulateMedia({ forcedColors: 'active', colorScheme })
    await openEditor(page)
    await saveTypedSignature(page, 'Ada Lovelace')
    const dialog = await openSignatureDialog(page)
    await animationsDone(dialog)
    await dialog.getByRole('tab', { name: 'Draw' }).click()
    /** The color a CSS color value (a system color) computes to here. */
    const system = (color: string) =>
      page.evaluate((color) => {
        const probe = document.createElement('div')
        probe.style.color = color
        document.body.append(probe)
        const value = getComputedStyle(probe).color
        probe.remove()
        return value
      }, color)
    const css = (el: Locator, property: 'backgroundColor' | 'boxShadow' | 'color') => el.evaluate((node, property) => getComputedStyle(node)[property], property)

    // Each ink keeps its color (forced colors would fill it with the page color), and the chosen one is
    // ringed in the highlight color.
    const inks = dialog.getByRole('radiogroup', { name: 'Ink color' })
    const swatch = (ink: Locator) => ink.locator('span').first()
    for (const [name, color] of [
      ['Black', 'rgb(17, 24, 39)'],
      ['Blue', 'rgb(29, 78, 216)'],
      ['Red', 'rgb(200, 30, 30)'],
    ]) {
      expect(await css(swatch(inks.getByRole('radio', { name })), 'backgroundColor'), name).toBe(color)
    }
    const highlight = await system('Highlight')
    expect(await css(swatch(inks.getByRole('radio', { checked: true })), 'boxShadow')).toContain(highlight)
    expect(await css(swatch(inks.getByRole('radio', { checked: false }).first()), 'boxShadow')).not.toContain(highlight)

    // Every pen width shows its dot, in its option's text color.
    const pens = dialog.getByRole('radiogroup', { name: 'Pen width' }).getByRole('radio')
    await expect(pens).toHaveCount(3)
    for (const pen of await pens.all()) {
      expect(await css(pen.locator('span').first(), 'backgroundColor'), (await pen.getAttribute('aria-label')) ?? '').toBe(await css(pen, 'color'))
    }

    // “Save for next time” is ticked (the default): drawn in the highlight colors, not as an empty box.
    const save = dialog.getByRole('checkbox', { name: 'Save for next time' })
    await expect(save).toBeChecked()
    expect(await css(save, 'backgroundColor')).toBe(highlight)
    expect(await css(save.locator('svg'), 'color')).toBe(await system('HighlightText'))

    // A saved signature stays on white paper (a dark page color would hide dark ink).
    expect(await css(dialog.getByRole('button', { name: /^Place signature saved/ }), 'backgroundColor')).toBe('rgb(255, 255, 255)')
    expect(errors).toEqual([])
  })
}

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
