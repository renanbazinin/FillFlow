import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  SAMPLE_PDF,
  SAMPLE_SPOTS,
  clickPagePoint,
  expectFormFieldValue,
  fillFormField,
  fixture,
  gotoHome,
  openPdf,
  pdfPage,
  recentDocument,
  selectTool,
  showPage,
  storedRecents,
  storedSessions,
  trackPageErrors,
  typeAndCommit,
} from './support/app'
import { readViewSizes } from './support/pdf'

/** The sample form's stored session (null until one is saved). */
async function sampleSession(page: Page) {
  return (await storedSessions(page)).find((s) => s.fileName === 'sample-form.pdf') ?? null
}

/** Drops a PDF on the window. */
async function dropPdf(page: Page, file: string) {
  const data = (await readFile(file)).toString('base64')
  const dataTransfer = await page.evaluateHandle(
    ({ data, name }) => {
      const dt = new DataTransfer()
      dt.items.add(new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], name, { type: 'application/pdf' }))
      return dt
    },
    { data, name: basename(file) },
  )
  for (const type of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent('body', type, { dataTransfer })
}

/** The card of a recent document on the home screen. */
const recentCard = (page: Page, name: RegExp) => page.locator('li').filter({ has: page.getByRole('button', { name: new RegExp(`^Open ${name.source}`) }) })

test('work is autosaved and restored from the recent documents list', async ({ page }) => {
  const sizes = await readViewSizes(SAMPLE_PDF)
  const name = 'Grace Hopper'
  const note = 'Saved across reloads'

  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 0)
  await fillFormField(page, 'Full name', name)
  await selectTool(page, 'Text', 'T')
  await clickPagePoint(page, 1, SAMPLE_SPOTS.emergencyName, sizes[1])
  await typeAndCommit(page, note)

  // The debounced autosave lands in IndexedDB…
  await expect
    .poll(async () => (await storedSessions(page)).find((s) => s.fileName === 'sample-form.pdf'), { timeout: 15_000 })
    .toMatchObject({
      formValues: { 'Full name': name },
      elements: expect.arrayContaining([expect.objectContaining({ kind: 'text', page: 1, text: note })]),
    })
  // …and the recents entry gets a page-1 thumbnail and a progress count.
  await expect
    .poll(async () => (await storedRecents(page)).find((d) => d.name === 'sample-form.pdf'), { timeout: 15_000 })
    .toMatchObject({ pageCount: 2, filledCount: 2, thumbnail: expect.stringMatching(/^data:image\/jpeg;base64,/) })

  await page.reload()
  const recent = await recentDocument(page, /sample-form/i)
  await recent.click()

  await showPage(page, 0)
  await expectFormFieldValue(page, 'Full name', name)
  await showPage(page, 1)
  await expect((await pdfPage(page, 1)).getByText(note)).toBeVisible()
})

test('a password-protected document opens after the prompt but leaves no page preview', async ({ page }) => {
  await gotoHome(page)
  await openPdf(page, fixture('password.pdf'))
  const password = page.locator('input[type="password"]')
  await expect(password).toBeVisible()
  await password.fill('fillflow')
  await password.press('Enter')
  await showPage(page, 0)

  const entry = async () => (await storedRecents(page)).find((d) => d.name === 'password.pdf')
  await expect.poll(entry, { timeout: 15_000 }).toMatchObject({ pageCount: 1 })
  // Long enough for the idle-time thumbnail of an ordinary document.
  await page.waitForTimeout(2500)
  expect((await entry())?.thumbnail).toBeUndefined()
})

test('an untouched document is listed but no session is stored for it', async ({ page }) => {
  await gotoHome(page)
  await openPdf(page, fixture('form-basic.pdf'))
  await showPage(page, 0)

  await expect
    .poll(async () => (await storedRecents(page)).map((d) => d.name), { timeout: 15_000 })
    .toContain('form-basic.pdf')
  // Well past the autosave debounce.
  await page.waitForTimeout(2000)
  expect((await storedSessions(page)).map((s) => s.fileName)).not.toContain('form-basic.pdf')
})

for (const [how, blockStorage] of [
  // A browser set not to let sites store data (Chrome: "Don't allow sites to save data"): opening
  // the database fails.
  [
    'doesn’t let the site store anything',
    () => {
      IDBFactory.prototype.open = function () {
        const request = { error: new DOMException('The user denied permission to access the database.', 'UnknownError') } as unknown as IDBOpenDBRequest
        setTimeout(() => request.onerror?.call(request, new Event('error')))
        return request
      }
    },
  ],
  ['has no IndexedDB', () => Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true })],
] as const) {
  test(`where the browser ${how}, documents open with one message that work can’t be saved`, async ({ page }) => {
    const errors = trackPageErrors(page)
    await page.addInitScript(blockStorage)
    await gotoHome(page)
    await openPdf(page, SAMPLE_PDF)
    await showPage(page, 0)
    const notice = page.locator('[data-sonner-toast]', { hasText: 'Your progress can’t be saved on this device' })
    await expect(notice).toContainText('This browser is blocking storage for this site. Download your PDF to keep your changes.')
    // Not that saved work didn't load: there is none, and reloading can't help.
    await expect(page.getByText(/didn’t load/)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Reload' })).toHaveCount(0)
    // It stays until acted on: a popover that clears passing messages out of its way leaves it up.
    await page.getByRole('button', { name: 'Shapes', exact: true }).filter({ visible: true }).first().click()
    await expect(page.getByRole('button', { name: /^Rectangle/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(notice).toBeVisible()

    // Work goes in all the same; the indicator says it isn't saved, without a second message.
    await fillFormField(page, 'Full name', 'שלום Ada Lovelace')
    await expect(page.getByRole('button', { name: /not saved/i })).toBeVisible()
    await page.waitForTimeout(1000)
    await expect(page.getByText(/Couldn’t save your progress/)).toHaveCount(0)
    await expectFormFieldValue(page, 'Full name', 'שלום Ada Lovelace')

    // The next document: nothing new to say. (Leaving this one asks first, its work being unsaved.)
    await notice.getByRole('button', { name: 'Got it' }).click()
    await dropPdf(page, fixture('form-basic.pdf'))
    await page.getByRole('button', { name: 'Leave anyway' }).click()
    await expect(page).toHaveTitle(/^form-basic/)
    await showPage(page, 0)
    await page.waitForTimeout(1000)
    await expect(page.locator('[data-sonner-toast]', { hasText: /can’t be saved|didn’t load/ })).toHaveCount(0)
    expect(errors).toEqual([])
  })
}

test('a document whose file there’s no room for is listed all the same, and the same file opened again continues its work', async ({ page }) => {
  await gotoHome(page)
  // No room for the file (a big one, on a device short of space); its work still fits. As in
  // Chrome, which still counts the refused file for a moment, the next write to the recents list
  // fails too, small as it is.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    let refused = false
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'files' || (this.name === 'recents' && refused)) {
        refused = this.name === 'files'
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      }
      return put.apply(this, args)
    }
  })
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 0)
  const notStored = page.locator('[data-sonner-toast]', { hasText: 'This PDF couldn’t be stored on this device' })
  await expect(notStored).toContainText('Storage on this device is full. Keep your copy of the file: you’ll need to open it again to continue your work.')
  await fillFormField(page, 'Full name', 'Ada Lovelace')
  await expect(page.getByText('Saved on this device')).toBeVisible()
  await expect.poll(async () => (await sampleSession(page))?.formValues['Full name']).toBe('Ada Lovelace')

  // Listed, and marked: not passed off as work on "older documents".
  await page.getByRole('button', { name: 'Back to home' }).click()
  await expect(recentCard(page, /sample-form/)).toContainText('2 pages · file not stored')
  await expect(page.getByText(/no longer listed|older documents/)).toHaveCount(0)
  await page.reload()
  await expect(recentCard(page, /sample-form/)).toContainText('file not stored')

  // Opening it says how to go on, and the same file brings the work back.
  await (await recentDocument(page, /sample-form/i)).click()
  const dialog = page.getByRole('dialog', { name: /couldn’t open this file/i })
  await expect(dialog).toContainText('It isn’t stored on this device, but your work on it is. Choose the same file to pick up where you left off.')
  const chooser = page.waitForEvent('filechooser')
  await dialog.getByRole('button', { name: 'Choose file' }).click()
  await (await chooser).setFiles(SAMPLE_PDF)
  await showPage(page, 0)
  await expectFormFieldValue(page, 'Full name', 'Ada Lovelace')
})

test('a document whose stored file is gone stays listed for its work', async ({ page }) => {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await fillFormField(page, 'Full name', 'Ada Lovelace')
  await expect.poll(async () => (await sampleSession(page))?.formValues['Full name']).toBe('Ada Lovelace')
  await page.getByRole('button', { name: 'Back to home' }).click()

  // Its stored file goes (cleared by the browser, say), not its work.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('fillflow-files')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const tx = req.result.transaction('files', 'readwrite')
          tx.objectStore('files').clear()
          tx.oncomplete = () => {
            req.result.close()
            resolve()
          }
        }
      }),
  )
  await (await recentDocument(page, /sample-form/i)).click()
  const dialog = page.getByRole('dialog', { name: /couldn’t open this file/i })
  await expect(dialog).toContainText('It isn’t stored on this device, but your work on it is.')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(recentCard(page, /sample-form/)).toContainText('file not stored')
  await expect(page.getByText(/no longer listed/)).toHaveCount(0)
  expect((await sampleSession(page))?.formValues['Full name']).toBe('Ada Lovelace')
})

test('a document removed from this device in another tab isn’t saved back by a tab that has it open, unless kept', async ({ page, context }) => {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await fillFormField(page, 'Full name', 'Ada before removal')
  await expect.poll(async () => (await sampleSession(page))?.formValues['Full name']).toBe('Ada before removal')
  await expect(page.getByText('Saved on this device')).toBeVisible()

  const other = await context.newPage()
  await gotoHome(other)
  await other.getByRole('button', { name: /^more options for sample-form/i }).click()
  await other.getByRole('menuitem', { name: /remove from this device/i }).click()
  await other.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(other.locator('[data-recent-open]')).toHaveCount(0)
  await other.close()

  // Told at once. What was saved is stored nowhere any more: it isn't said to be, and leaving asks first.
  const removed = page.locator('[data-sonner-toast]', { hasText: 'This document was removed from this device' })
  await expect(removed).toContainText('Changes made here aren’t being saved unless you keep it.')
  await expect(page.getByRole('button', { name: /not saved/i })).toBeVisible()
  await expect(page.getByText('Saved on this device')).toHaveCount(0)
  await page.getByRole('button', { name: 'Back to home' }).click()
  const leave = page.getByRole('alertdialog', { name: 'Leave without your latest changes?' })
  await expect(leave).toBeVisible()
  await leave.getByRole('button', { name: 'Stay' }).click()
  await expect(leave).toHaveCount(0)
  await expect(removed).toBeVisible()

  // What is typed on isn't saved back by itself.
  await fillFormField(page, 'Email', 'after.removal@example.com')
  await expect(page.getByRole('button', { name: /not saved/i })).toBeVisible()
  await page.waitForTimeout(1500)
  expect(await storedSessions(page)).toEqual([])
  expect(await storedRecents(page)).toEqual([])

  // Kept: stored and listed again, with all of its work.
  await removed.getByRole('button', { name: 'Keep it' }).click()
  await expect(removed).toHaveCount(0)
  await expect(page.getByText('Saved on this device')).toBeVisible()
  await expect
    .poll(async () => (await sampleSession(page))?.formValues)
    .toMatchObject({ 'Full name': 'Ada before removal', Email: 'after.removal@example.com' })
  await expect.poll(async () => (await storedRecents(page)).map((d) => d.name)).toEqual(['sample-form.pdf'])
})
