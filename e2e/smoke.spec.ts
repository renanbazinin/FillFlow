import { expect, test } from '@playwright/test'
import { PDFDocument, PDFTextField } from 'pdf-lib'
import {
  SAMPLE_PDF,
  SAMPLE_SPOTS,
  clickPagePoint,
  downloadPdf,
  fillFormField,
  gotoHome,
  openPdf,
  selectTool,
  showPage,
  trackPageErrors,
  typeAndCommit,
} from './support/app'
import { pageText, pathCount, readViewSizes } from './support/pdf'

test('the home screen renders without errors', async ({ page }) => {
  const errors = trackPageErrors(page)
  await gotoHome(page)
  await expect(page).toHaveTitle(/FillFlow/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(errors).toEqual([])
})

test('fill a form field, type and tick on a flat page, download the result', async ({ page }) => {
  const errors = trackPageErrors(page)
  const sizes = await readViewSizes(SAMPLE_PDF)
  const name = 'Ada Lovelace'
  const typed = 'Charles Babbage'

  await gotoHome(page)
  await openPdf(page, SAMPLE_PDF)
  await showPage(page, 0)

  // An AcroForm field on page 1.
  await fillFormField(page, 'Full name', name)

  // Free-form text on the flat page 2.
  await selectTool(page, 'Text', 'T')
  await clickPagePoint(page, 1, SAMPLE_SPOTS.emergencyName, sizes[1])
  await typeAndCommit(page, typed)

  // A checkmark in one of the printed boxes.
  await selectTool(page, 'Checkmark', 'C')
  await clickPagePoint(page, 1, SAMPLE_SPOTS.allergiesYes, sizes[1])

  const { bytes, name: fileName } = await downloadPdf(page)
  expect(fileName).toMatch(/\.pdf$/i)

  // The value is in the real form field (or baked into page 1 when the form was flattened).
  const doc = await PDFDocument.load(bytes)
  const field = doc.getForm().getFieldMaybe('Full name')
  if (field instanceof PDFTextField) expect(field.getText()).toBe(name)
  else expect(await pageText(bytes, 0)).toContain(name)

  // The typed text is real, selectable text on page 2, and the checkmark added vector paths.
  expect(await pageText(bytes, 1)).toContain(typed)
  expect(await pathCount(bytes, 1)).toBeGreaterThan(await pathCount(SAMPLE_PDF, 1))
  expect(doc.getPageCount()).toBe(sizes.length)
  expect(errors).toEqual([])
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

  test('open the sample, fill a field and download it', async ({ page }) => {
    const errors = trackPageErrors(page)
    await gotoHome(page)
    await openPdf(page, SAMPLE_PDF)
    await showPage(page, 0)
    await fillFormField(page, 'Email', 'ada@example.com')

    const { bytes } = await downloadPdf(page)
    const field = (await PDFDocument.load(bytes)).getForm().getFieldMaybe('Email')
    if (field instanceof PDFTextField) expect(field.getText()).toBe('ada@example.com')
    else expect(await pageText(bytes, 0)).toContain('ada@example.com')
    expect(errors).toEqual([])
  })
})
