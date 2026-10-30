import { expect, test } from '@playwright/test'
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
  typeAndCommit,
} from './support/app'
import { readViewSizes } from './support/pdf'

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
