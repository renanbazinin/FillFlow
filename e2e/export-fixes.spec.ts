import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { SAMPLE_PDF, fixture, gotoHome, openPdf, showPage, trackPageErrors } from './support/app'

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

/** Letter keys as Chrome reports them on a Hebrew keyboard layout: the layout's own letter, on the Latin key. */
const HEBREW_KEYS = {
  s: { key: 'ד', code: 'KeyS', windowsVirtualKeyCode: 83 },
  o: { key: 'ם', code: 'KeyO', windowsVirtualKeyCode: 79 },
}

/** Presses Ctrl/⌘ + a letter key on a Hebrew keyboard layout (Playwright's keyboard types US keys only). */
async function hebrewKeyboard(page: Page): Promise<(letter: keyof typeof HEBREW_KEYS) => Promise<void>> {
  const cdp = await page.context().newCDPSession(page)
  const modifiers = process.platform === 'darwin' ? 4 : 2 // ⌘ / Ctrl
  return async (letter) => {
    for (const type of ['rawKeyDown', 'keyUp'] as const) await cdp.send('Input.dispatchKeyEvent', { type, modifiers, ...HEBREW_KEYS[letter] })
  }
}

test('the export dialog keeps the browser’s “Open file” and “Save page” dialogs away, on any keyboard layout', async ({ page }) => {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 0)
  const dialog = await openExportDialog(page)
  const pressHebrew = await hebrewKeyboard(page)
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
    // On a US keyboard layout, then on a Hebrew one.
    await page.keyboard.press('ControlOrMeta+o')
    await pressHebrew('o')
    if (save) {
      await page.keyboard.press('ControlOrMeta+s')
      await pressHebrew('s')
    }
    await expect
      .poll(browserKeys)
      .toEqual(['o: blocked', 'ם: blocked', ...(save ? ['s: blocked', 'ד: blocked'] : [])])
  }
  await expect(dialog).toBeVisible()
  expect(downloads).toBe(0)
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
