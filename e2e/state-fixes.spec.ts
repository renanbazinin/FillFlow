import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  SAMPLE_PDF,
  SAMPLE_SPOTS,
  clickPagePoint,
  expectEditing,
  fillFormField,
  fixture,
  formField,
  gotoHome,
  openPdf,
  readIndexedDb,
  recentDocument,
  selectTool,
  showPage,
  storedRecents,
  storedSessions,
  trackPageErrors,
} from './support/app'
import { readViewSizes } from './support/pdf'

/** The sample form's stored session (null until one is saved). */
async function sampleSession(page: Page) {
  return (await storedSessions(page)).find((s) => s.fileName === 'sample-form.pdf') ?? null
}

async function textInput(page: Page, field: string) {
  const root = await formField(page, field)
  return root.locator('xpath=self::input | self::textarea | .//input | .//textarea').first()
}

/** Drops a PDF on the window (with whatever has focus keeping it). */
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

/** Writes a record straight into one of the app's IndexedDB stores (as another build might). */
function putRecord(page: Page, dbName: string, storeName: string, key: string, value: unknown) {
  return page.evaluate(
    ([dbName, storeName, key, value]) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const tx = req.result.transaction(storeName, 'readwrite')
          tx.objectStore(storeName).put(value, key)
          tx.oncomplete = () => {
            req.result.close()
            resolve()
          }
        }
      }),
    [dbName, storeName, key, value] as const,
  )
}

test('a change made just before a reload is kept', async ({ page }) => {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  const input = await textInput(page, 'Full name')
  await input.click()
  await input.pressSequentially('221B Baker Street', { delay: 20 })
  // Well inside the autosave delay: only the write on pagehide can keep it.
  await page.waitForTimeout(100)
  await page.reload()
  await expect.poll(async () => (await sampleSession(page))?.formValues['Full name']).toBe('221B Baker Street')
})

test('a text box left empty is never stored or counted', async ({ page }) => {
  const sizes = await readViewSizes(SAMPLE_PDF)
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 0)
  await selectTool(page, 'Text', 'T')
  await clickPagePoint(page, 1, SAMPLE_SPOTS.emergencyName, sizes[1])
  await expectEditing(page)
  await page.waitForTimeout(1200)
  await page.reload()
  await expect.poll(async () => (await sampleSession(page))?.elements).toEqual([])
  expect((await storedRecents(page)).find((d) => d.name === 'sample-form.pdf')?.filledCount ?? 0).toBe(0)
  await (await recentDocument(page, /sample-form/i)).click()
  await showPage(page, 1)
  await expect(page.locator('[data-element-id]')).toHaveCount(0)
})

test('a tab with an out-of-date copy never overwrites newer work, and offers to reload', async ({ page, context }) => {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await fillFormField(page, 'Full name', 'From tab A')
  await expect.poll(async () => (await sampleSession(page))?.formValues['Full name']).toBe('From tab A')

  // The same document in a second tab: newer work is saved there.
  const other = await context.newPage()
  await gotoHome(other)
  await (await recentDocument(other, /sample-form/i)).click()
  await fillFormField(other, 'Full name', 'From tab B')
  await expect.poll(async () => (await sampleSession(other))?.formValues['Full name']).toBe('From tab B')
  await other.close()

  // Back in the first tab, which still shows the old copy.
  await expect(page.getByText('This document was changed in another tab')).toBeVisible()
  await fillFormField(page, 'Email', 'stale@example.com')
  await expect(page.getByRole('button', { name: /not saved/i })).toBeVisible()
  await page.waitForTimeout(1500)
  expect((await sampleSession(page))?.formValues).toMatchObject({ 'Full name': 'From tab B', Email: '' })

  await page.getByRole('button', { name: 'Reload' }).click()
  await expect(await textInput(page, 'Full name')).toHaveValue('From tab B')
})

test('typing on while the open file is opened again is never taken for another tab’s work', async ({ page }) => {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  const input = await textInput(page, 'Full name')
  await input.click()
  await input.pressSequentially('Ada')
  await expect.poll(async () => (await sampleSession(page))?.formValues['Full name']).toBe('Ada')

  // Hold the new copy's load for a second right after it has read the stored work (a slow
  // device): keys typed meanwhile still reach, and are saved from, the copy it replaces.
  await page.evaluate(() => {
    const get = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['get']>) {
      const req = get.apply(this, args)
      if (this.name !== 'sessions' || this.transaction.mode !== 'readonly') return req
      document.documentElement.dataset.sessionRead = ''
      let onsuccess: IDBRequest['onsuccess'] = null
      Object.defineProperty(req, 'onsuccess', { get: () => onsuccess, set: (fn: IDBRequest['onsuccess']) => (onsuccess = fn) })
      req.addEventListener('success', (e) => setTimeout(() => onsuccess?.call(req, e), 1000))
      return req
    }
  })
  await dropPdf(page, SAMPLE_PDF)
  await expect(page.locator('html[data-session-read]')).toBeAttached()
  await page.keyboard.type(' Lovelace')
  await expect(input).toHaveValue('Ada')
  await expect.poll(async () => (await sampleSession(page))?.formValues['Full name']).toBe('Ada Lovelace')

  // The new copy keeps saving over that late write.
  await fillFormField(page, 'Email', 'ada@example.com')
  await expect.poll(async () => (await sampleSession(page))?.formValues).toMatchObject({ 'Full name': 'Ada', Email: 'ada@example.com' })
  await expect(page.getByText('This document was changed in another tab')).toHaveCount(0)
})

test('a stored file that can’t be read keeps its card and its work', async ({ page }) => {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await fillFormField(page, 'Full name', 'Ada Lovelace')
  await expect.poll(async () => (await sampleSession(page))?.formValues['Full name']).toBe('Ada Lovelace')
  await page.getByRole('button', { name: 'Back to home' }).click()

  await page.evaluate(() => {
    const get = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['get']>) {
      if (this.name === 'files') throw new DOMException('Data lost due to missing file.', 'UnknownError')
      return get.apply(this, args)
    }
  })
  await (await recentDocument(page, /sample-form/i)).click()
  await expect(page.getByRole('dialog')).toContainText('Couldn’t open this file')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  expect((await sampleSession(page))?.formValues['Full name']).toBe('Ada Lovelace')
  await expect(page.locator('[data-recent-open]')).toHaveCount(1)
})

test('stored data from another build can’t stop the app from working', async ({ page }) => {
  const errors = trackPageErrors(page)
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 0)
  const id = (await storedRecents(page)).find((d) => d.name === 'sample-form.pdf')?.id ?? ''
  expect(id).not.toBe('')
  await page.getByRole('button', { name: 'Back to home' }).click()

  // A recents entry without a name, and a session using a font this build doesn't have.
  await putRecord(page, 'fillflow-recents', 'recents', 'x', { id: 'x', size: 1, pageCount: 1, addedAt: 1, openedAt: 1 })
  const text = { id: 't', kind: 'text', page: 0, x: 100, y: 140, width: 50, height: 14, text: 'Script text', fontId: 'script', bold: false, fontSize: 12, color: '#111827', align: 'left', lineHeight: 1.2, letterSpacing: 0 }
  await putRecord(page, 'fillflow-sessions', 'sessions', id, {
    version: 1,
    docId: id,
    fileName: 'sample-form.pdf',
    elements: [text],
    formValues: { 'Full name': 'Ada' },
    assets: {},
    updatedAt: 5,
  })
  await page.reload()
  await (await recentDocument(page, /sample-form/i)).click()
  await showPage(page, 0)
  await expect(await textInput(page, 'Full name')).toHaveValue('Ada')
  await expect(page.locator('[data-page-index="0"]').getByText('Script text')).toBeVisible()
  expect(errors).toEqual([])
})

test('after a failed save the app never says the work is saved', async ({ page }) => {
  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 0)
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'sessions') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      return put.apply(this, args)
    }
  })
  await fillFormField(page, 'Full name', 'Ada')
  const notSaved = page.getByRole('button', { name: /not saved/i })
  await expect(notSaved).toBeVisible()
  // Another change doesn't hide the failure.
  await fillFormField(page, 'Full name', 'Ada L')
  await page.waitForTimeout(200)
  await expect(notSaved).toBeVisible()

  // Dropping another PDF: the overlay and the outcome tell the truth.
  const data = (await readFile(fixture('form-basic.pdf'))).toString('base64')
  const dataTransfer = await page.evaluateHandle((data) => {
    const dt = new DataTransfer()
    dt.items.add(new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], 'form-basic.pdf', { type: 'application/pdf' }))
    return dt
  }, data)
  await page.dispatchEvent('body', 'dragenter', { dataTransfer })
  await page.dispatchEvent('body', 'dragover', { dataTransfer })
  await expect(page.getByText(/couldn’t be saved on this device/)).toBeVisible()
  await page.dispatchEvent('body', 'drop', { dataTransfer })
  await page.getByRole('button', { name: 'Leave anyway' }).click()
  await expect(page).toHaveTitle(/form-basic/)
  await page.waitForTimeout(500)
  await expect(page.getByText(/is saved/)).toHaveCount(0)
})

test('removing recent documents keeps keyboard focus in place', async ({ page }) => {
  await gotoHome(page)
  for (const file of [SAMPLE_PDF, fixture('form-basic.pdf'), fixture('long.pdf')]) {
    await openPdf(page, file)
    await showPage(page, 0)
    await page.getByRole('button', { name: 'Back to home' }).click()
  }
  await expect(page.locator('[data-recent-open]')).toHaveCount(3)
  const focused = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName)

  await page.getByRole('button', { name: /^more options for form-basic/i }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('menuitem', { name: /remove from this device/i }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Remove', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-recent-open]')).toHaveCount(2)
  await expect.poll(focused).toMatch(/^Open sample-form/)

  await page.getByRole('button', { name: 'Clear all' }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Clear all' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-recent-open]')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-describedby'))).toBe('ff-dropzone-hint')
  expect(await readIndexedDb(page, 'fillflow-sessions', 'sessions')).toEqual([])
})

test('a slow sample download never replaces a document opened meanwhile', async ({ page }) => {
  await page.route('**/samples/sample-form.pdf', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2500))
    await route.continue()
  })
  await gotoHome(page)
  await page.getByRole('button', { name: /try a sample form/i }).click()
  await openPdf(page, fixture('form-basic.pdf'))
  await expect(page).toHaveTitle(/form-basic/)
  await page.waitForTimeout(3500)
  await expect(page).toHaveTitle(/form-basic/)
})

test('documents open on a plain-http host (no Web Crypto)', async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? 'http://localhost:5299/FillFlow/').origin
  await page.route('http://fillflow.test/**', async (route) => {
    const response = await route.fetch({ url: route.request().url().replace('http://fillflow.test', origin) })
    await route.fulfill({ response })
  })
  await page.goto('http://fillflow.test/FillFlow/')
  expect(await page.evaluate(() => isSecureContext)).toBe(false)
  await page.getByRole('button', { name: /try a sample form/i }).click()
  await showPage(page, 0)
  // Same id as Web Crypto gives the sample on a secure origin.
  await expect
    .poll(async () => (await storedRecents(page)).map((d) => d.id))
    .toEqual(['e4597c37cb83b73944bb89b07ae3e708f3cee7412872593353771eb2fed6d0cc'])
})
