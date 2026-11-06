import { expect, test, type Locator, type Page } from '@playwright/test'
import { SAMPLE_PDF, SAMPLE_SPOTS, clickPagePoint, gotoHome, openPdf, selectTool, showPage, trackPageErrors } from './support/app'
import { readViewSizes } from './support/pdf'

/** 5 November 2026, midday in Israel: day first and month first write it differently. */
const NOV_5 = new Date('2026-11-05T10:00:00Z')
const DAY_FIRST = '05/11/2026 (DD/MM/YYYY)'
const MONTH_FIRST = '11/05/2026 (MM/DD/YYYY)'

async function openSample(page: Page): Promise<void> {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 0)
}

/** Opens the Date tool's list of formats from its dock button. */
async function dateFormats(page: Page): Promise<Locator> {
  await selectTool(page, 'Date', 'D')
  const list = page.getByRole('dialog', { name: 'Date format' })
  await expect(list).toBeVisible()
  return list
}

/** The format the list marks as the one in use. */
const marked = (list: Locator) => list.getByRole('button', { pressed: true })

/** A date on page 2 of the sample, as shown. */
const placedDate = (page: Page, text: string) => page.locator('[data-page-index="1"] [data-element-id]').getByText(text, { exact: true })

test.describe('a browser in US English, in Israel', () => {
  test.use({ locale: 'en-US', timezoneId: 'Asia/Jerusalem' })

  test('writes dates day first until another format is picked, and keeps a pick', async ({ page }) => {
    const errors = trackPageErrors(page)
    const sizes = await readViewSizes(SAMPLE_PDF)
    await page.clock.setFixedTime(NOV_5)
    await openSample(page)

    // The D key inserts today's date without showing the formats: day first.
    await page.keyboard.press('d')
    await clickPagePoint(page, 1, SAMPLE_SPOTS.emergencyName, sizes[1])
    await expect(placedDate(page, '05/11/2026')).toBeVisible()

    // A fresh profile's list marks it too.
    const list = await dateFormats(page)
    await expect(marked(list)).toHaveAccessibleName(DAY_FIRST)
    await list.getByRole('button', { name: '2026-11-05 (YYYY-MM-DD)' }).click()
    await expect(list).toHaveCount(0)

    // A pick is kept after a reload.
    await page.reload()
    await openSample(page)
    await expect(marked(await dateFormats(page))).toHaveAccessibleName('2026-11-05 (YYYY-MM-DD)')
    await page.keyboard.press('Escape')
    await clickPagePoint(page, 1, { x: SAMPLE_SPOTS.emergencyName.x, y: SAMPLE_SPOTS.emergencyName.y + 60 }, sizes[1])
    await expect(placedDate(page, '2026-11-05')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('ignores the date format an older version saved with the other styles: it was never picked', async ({ page }) => {
    // Any style change saved the default of the day with it: month first, for a browser in US English.
    await page.addInitScript(() => {
      const styles = { text: { fontId: 'serif', fontSize: 14, color: '#111827', bold: false }, dateFormat: 'MM/dd/yyyy' }
      if (!localStorage.getItem('fillflow:styles')) localStorage.setItem('fillflow:styles', JSON.stringify(styles))
    })
    await page.clock.setFixedTime(NOV_5)
    await openSample(page)
    await expect(marked(await dateFormats(page))).toHaveAccessibleName(DAY_FIRST)
  })
})

test.describe('a browser in US English, in New York', () => {
  test.use({ locale: 'en-US', timezoneId: 'America/New_York' })

  test('writes dates month first', async ({ page }) => {
    await page.clock.setFixedTime(NOV_5)
    await openSample(page)
    await expect(marked(await dateFormats(page))).toHaveAccessibleName(MONTH_FIRST)
  })
})

/** The browser's own Undo or Redo as its menus run it (Playwright can't open those): an edit command on a key nothing handles. */
async function editCommand(page: Page, command: 'undo' | 'redo'): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  const key = { key: 'F20', code: 'F20', windowsVirtualKeyCode: 131 }
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key, commands: [command] })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
  await cdp.detach()
}

test.describe('Ctrl+Z while typing in a text item (a date is one too)', () => {
  test('takes back a burst of typing, not a character, keeps the caret in the box, and stops where the edit began', async ({ page }) => {
    const errors = trackPageErrors(page)
    const sizes = await readViewSizes(SAMPLE_PDF)
    await openSample(page)
    const editor = page.getByRole('textbox', { name: 'Edit text' })
    const items = page.locator('[data-page-index="0"] [data-element-id]')

    // A new item: a pause ends a burst of typing.
    await selectTool(page, 'Text', 'T')
    await clickPagePoint(page, 0, { x: 300, y: 128 }, sizes[0])
    await expect(editor).toBeFocused()
    await page.keyboard.type('Hello')
    await page.waitForTimeout(1500)
    await page.keyboard.type(' world')
    await page.keyboard.press('ControlOrMeta+z')
    await expect(editor).toHaveValue('Hello')
    await page.keyboard.press('ControlOrMeta+z')
    await expect(editor).toHaveValue('')
    // Nothing from before it was started: it stays, being typed into.
    await page.keyboard.press('ControlOrMeta+z')
    await expect(editor).toBeFocused()
    await expect(editor).toHaveValue('')
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect(editor).toHaveValue('Hello')
    // The caret is after what came back.
    await page.keyboard.type('!')
    await expect(editor).toHaveValue('Hello!')
    await page.keyboard.press('Escape')
    await expect(items).toHaveText(['Hello!'])

    // Typed into again: back to where this edit began, no further. The browser's own Undo (its
    // menu) does the same as the keys.
    await page.keyboard.press('Enter')
    await expect(editor).toBeFocused()
    await page.keyboard.type(' Bye')
    await page.keyboard.press('ControlOrMeta+z')
    await expect(editor).toHaveValue('Hello!')
    await page.keyboard.press('ControlOrMeta+z')
    await expect(editor).toHaveValue('Hello!')
    await page.keyboard.type(' Bye')
    await editCommand(page, 'undo')
    await expect(editor).toHaveValue('Hello!')
    await expect(editor).toBeFocused()
    // Done typing, the editor's redo still has what was undone.
    await page.keyboard.press('Escape')
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect(items).toHaveText(['Hello! Bye'])

    // A new item undone back to nothing goes once left, but redo brings its text back.
    await selectTool(page, 'Text', 'T')
    await clickPagePoint(page, 0, { x: 300, y: 300 }, sizes[0])
    await expect(editor).toBeFocused()
    await page.keyboard.type('Draft')
    await page.keyboard.press('ControlOrMeta+z')
    await expect(editor).toHaveValue('')
    await page.keyboard.press('Escape')
    await expect(items).toHaveCount(1)
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect(items).toHaveText(['Hello! Bye', 'Draft'])

    // A placed date, corrected by hand and taken back.
    await page.keyboard.press('Escape')
    await page.keyboard.press('d')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect(editor).toBeFocused()
    const date = await editor.inputValue()
    for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace')
    await page.keyboard.type('1999')
    await expect(editor).toHaveValue(`${date.slice(0, -4)}1999`)
    await page.keyboard.press('ControlOrMeta+z')
    await expect(editor).toHaveValue(date)
    await page.keyboard.press('ControlOrMeta+z')
    await expect(editor).toHaveValue(date)
    await page.keyboard.press('Escape')
    // (Added in the middle of the view, which may be on either page.)
    await expect(page.locator('[data-page-index] [data-element-id]').getByText(date, { exact: true })).toBeVisible()
    expect(errors).toEqual([])
  })
})
