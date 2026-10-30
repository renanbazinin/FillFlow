import { readFileSync, statSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { PDFDocument, PDFTextField, TextAlignment } from 'pdf-lib'
import { SAMPLE_PDF, SAMPLE_SPOTS, fixture } from './support/app'
import { findText, pageText, readAnnotations, readPageGeometry, readPageText, withPdf } from './support/pdf'

// Sanity checks of the generated documents the other specs rely on (no browser needed).
// Regenerate with `npm run sample` and `node scripts/generate-fixtures.mjs`.

test.describe('sample form', () => {
  test('is small and has two A4 pages', async () => {
    expect(statSync(SAMPLE_PDF).size).toBeLessThan(60 * 1024)
    const pages = await readPageGeometry(SAMPLE_PDF)
    expect(pages.map((p) => [Math.round(p.size.width), Math.round(p.size.height), p.rotate])).toEqual([
      [595, 842, 0],
      [595, 842, 0],
    ])
  })

  test('page 1 has every kind of field, labelled and flagged', async () => {
    const widgets = await readAnnotations(SAMPLE_PDF, 0)
    const byName = (name: string) => widgets.filter((w) => w.fieldName === name)
    const one = (name: string) => {
      const list = byName(name)
      expect(list, name).toHaveLength(1)
      return list[0]
    }

    for (const name of ['Full name', 'Email']) expect(one(name)).toMatchObject({ fieldType: 'Tx', required: true })
    for (const name of ['Phone', 'Date of birth', 'Date']) expect(one(name)).toMatchObject({ fieldType: 'Tx', required: false })
    expect(one('Address')).toMatchObject({ fieldType: 'Tx', multiLine: true, alternativeText: 'Home address' })
    expect(one('Comments')).toMatchObject({ fieldType: 'Tx', multiLine: true })
    expect(one('ID number')).toMatchObject({ fieldType: 'Tx', comb: true, maxLen: 9 })
    expect(byName('Membership type').map((w) => [w.radioButton, w.buttonValue])).toEqual([
      [true, 'Individual'],
      [true, 'Family'],
      [true, 'Student'],
    ])
    const interests = widgets.filter((w) => w.fieldName?.startsWith('Interests.'))
    expect(interests.length).toBeGreaterThanOrEqual(3)
    expect(interests.every((w) => w.checkBox)).toBe(true)
    expect(one('Country')).toMatchObject({ fieldType: 'Ch', combo: true })
    expect(one('Country').options?.length).toBeGreaterThanOrEqual(8)
    expect(one('Referral')).toMatchObject({ fieldType: 'Ch', combo: false, multiSelect: true })
    expect(one('Signature')).toMatchObject({ fieldType: 'Sig', alternativeText: 'Signature' })
    // Every widget carries a human-friendly label.
    expect(widgets.filter((w) => !w.alternativeText).map((w) => w.fieldName)).toEqual([])
  })

  test('page 2 is flat, with room to type where the specs click', async () => {
    expect(await readAnnotations(SAMPLE_PDF, 1)).toEqual([])
    expect(await pageText(SAMPLE_PDF, 1)).toContain('Emergency contact')
    const label = await findText(SAMPLE_PDF, 1, 'Full name')
    expect(label).toBeTruthy()
    // The spot used by the specs is on the line right after the "Full name" label.
    expect(SAMPLE_SPOTS.emergencyName.x).toBeGreaterThan((label?.x ?? 0) + 40)
    expect(Math.abs(SAMPLE_SPOTS.emergencyName.y - (label?.y ?? 0))).toBeLessThan(14)
    const yes = (await readPageText(SAMPLE_PDF, 1)).find((t) => t.str === 'Yes')
    expect(yes).toBeTruthy()
    expect(Math.abs(SAMPLE_SPOTS.allergiesYes.x - ((yes?.x ?? 0) - 11.5))).toBeLessThan(6)
  })

  test('opens with pdf-lib, fields empty', async () => {
    const doc = await PDFDocument.load(readFileSync(SAMPLE_PDF))
    const fields = doc.getForm().getFields()
    expect(fields.length).toBeGreaterThanOrEqual(15)
    for (const f of fields) if (f instanceof PDFTextField) expect(f.getText() ?? '').toBe('')
  })
})

test.describe('fixtures', () => {
  test('rotated.pdf: every rotation, offset crop boxes, upright labels', async () => {
    const file = fixture('rotated.pdf')
    const pages = await readPageGeometry(file)
    expect(pages.map((p) => p.rotate)).toEqual([0, 90, 180, 270])
    for (const [i, p] of pages.entries()) {
      expect(p.view[0], `crop offset on page ${i + 1}`).toBeGreaterThan(0)
      expect(p.view[1], `crop offset on page ${i + 1}`).toBeGreaterThan(0)
      const label = await findText(file, i, `Page ${i + 1} of 4`)
      expect(label, `label on page ${i + 1}`).toBeTruthy()
      expect(label?.direction.x).toBeCloseTo(1, 6)
      expect(label?.direction.y).toBeCloseTo(0, 6)
      expect(label?.x).toBeCloseTo(36, 0)
      expect(label?.y).toBeCloseTo(60, 0)
    }
  })

  test('long.pdf: 60 numbered pages', async () => {
    const file = fixture('long.pdf')
    expect((await readPageGeometry(file)).length).toBe(60)
    expect(await pageText(file, 41)).toContain('Page 42 of 60')
  })

  test('mixed-sizes.pdf: A4, Letter and landscape', async () => {
    const sizes = (await readPageGeometry(fixture('mixed-sizes.pdf'))).map((p) => [Math.round(p.size.width), Math.round(p.size.height)])
    expect(sizes).toEqual([
      [595, 842],
      [612, 792],
      [842, 595],
    ])
  })

  test('password.pdf: needs the password "fillflow"', async () => {
    const file = fixture('password.pdf')
    await expect(withPdf(file, async () => 'opened')).rejects.toMatchObject({ name: 'PasswordException' })
    await expect(withPdf(file, async () => 'opened', { password: 'nope' })).rejects.toMatchObject({ name: 'PasswordException' })
    const text = await withPdf(
      file,
      async (pdf) => ((await (await pdf.getPage(1)).getTextContent()).items as { str?: string }[]).map((i) => i.str).join(' '),
      { password: 'fillflow' },
    )
    expect(text).toContain('Confidential')
  })

  test('form-basic.pdf: a few fields, one right-aligned for Hebrew', async () => {
    const widgets = await readAnnotations(fixture('form-basic.pdf'), 0)
    expect(widgets.map((w) => w.fieldName).sort()).toEqual(['Color', 'Hebrew name', 'Name', 'Notes', 'Subscribe'])
    expect(widgets.find((w) => w.fieldName === 'Hebrew name')?.textAlignment).toBe(TextAlignment.Right)
  })
})
