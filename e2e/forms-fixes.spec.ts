/// <reference lib="dom" />
import { readFile, writeFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString, PDFTextField, type PDFForm, type PDFPage } from 'pdf-lib'
import { encryptPdf } from '../src/lib/export/testing/fixtures'
import { formField, gotoHome, openPdf, showPage, trackPageErrors } from './support/app'
import { readPageText } from './support/pdf'

// Form-filling cases from review: what the user sees on screen is what the exported file holds.

async function formPdf(build: (form: PDFForm, page: PDFPage, doc: PDFDocument) => void): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  build(doc.getForm(), page, doc)
  return doc.save()
}

async function open(page: Page, name: string, bytes: Uint8Array): Promise<void> {
  const path = test.info().outputPath(name)
  await writeFile(path, bytes)
  await gotoHome(page)
  await openPdf(page, path)
  await showPage(page, 0)
}

/** Downloads with "Flatten form fields" set as asked. */
async function downloadWith(page: Page, flattenForms: boolean): Promise<Uint8Array> {
  const download = page.waitForEvent('download', { timeout: 60_000 })
  await page.getByRole('button', { name: /^download$/i }).filter({ visible: true }).first().click()
  const flatten = page.getByRole('switch', { name: /flatten form fields/i })
  await expect(flatten).toBeVisible({ timeout: 20_000 })
  if ((await flatten.getAttribute('aria-checked')) !== String(flattenForms)) await flatten.click()
  await expect(flatten).toHaveAttribute('aria-checked', String(flattenForms))
  await page.getByRole('button', { name: /download pdf/i }).filter({ visible: true }).first().click()
  return new Uint8Array(await readFile(await (await download).path()))
}

/** Downloads with "Flatten form fields" off, so the fields can be read back. */
async function downloadFillable(page: Page): Promise<PDFDocument> {
  return PDFDocument.load(await downloadWith(page, false))
}

const onPage = (page: Page, name: string) => page.locator(`[data-page-index] [data-form-field="${name}"]`)

test('radio buttons that share an export value are separate choices', async ({ page }) => {
  const errors = trackPageErrors(page)
  const bytes = await formPdf((form, p) => {
    const q = form.createRadioGroup('q')
    q.addOptionToPage('Yes', p, { x: 50, y: 700, width: 14, height: 14 })
    q.addOptionToPage('No', p, { x: 100, y: 700, width: 14, height: 14 })
    q.addOptionToPage('Yes', p, { x: 150, y: 700, width: 14, height: 14 })
  })
  await open(page, 'radio-repeat.pdf', bytes)
  const radios = onPage(page, 'q')
  await expect(radios).toHaveCount(3)
  await radios.nth(2).click()
  await expect.poll(() => radios.evaluateAll((els) => els.map((e) => e.getAttribute('aria-checked')))).toEqual(['false', 'false', 'true'])
  await expect(radios.nth(2)).toHaveAttribute('aria-label', /: Yes \(2\)$/)

  const group = (await downloadFillable(page)).getForm().getRadioGroup('q')
  expect(String(group.acroField.dict.get(PDFName.of('V')))).toBe('/2')
  expect(group.acroField.getWidgets().map((w) => String(w.getAppearanceState()))).toEqual(['/Off', '/Off', '/2'])
  expect(errors).toEqual([])
})

test('typing into an editable combo box keeps what was typed', async ({ page }) => {
  const errors = trackPageErrors(page)
  const bytes = await formPdf((form, p, doc) => {
    const country = form.createDropdown('country')
    country.addOptions(['x'])
    country.enableEditing()
    country.addToPage(p, { x: 50, y: 700, width: 200, height: 20 })
    const opt = [
      [PDFHexString.fromText('US'), PDFHexString.fromText('United States')],
      [PDFHexString.fromText('IL'), PDFHexString.fromText('Israel')],
    ]
    country.acroField.dict.set(PDFName.of('Opt'), doc.context.obj(opt))
  })
  await open(page, 'combo.pdf', bytes)
  const input = onPage(page, 'country').locator('input')
  await input.click()
  for (const [key, shown] of [
    ['U', 'U'],
    ['S', 'US'],
    ['A', 'USA'],
  ]) {
    await page.keyboard.type(key)
    await expect(input).toHaveValue(shown)
  }
  await page.keyboard.press('Tab')
  await expect(input).toHaveValue('USA')

  // The form panel's input behaves the same.
  const panelInput = page.getByPlaceholder('Choose or type…')
  await expect(panelInput).toHaveValue('USA')
  await panelInput.fill('')
  await panelInput.pressSequentially('US')
  await expect(panelInput).toHaveValue('US')
  await expect(input).toHaveValue('United States')
  await panelInput.blur()
  await expect(panelInput).toHaveValue('United States')

  // Picking an option by its label still stores the export value (and shows the label).
  await input.fill('Israel')
  await input.blur()
  await expect(input).toHaveValue('Israel')
  const saved = (await downloadFillable(page)).getForm().getDropdown('country')
  expect(saved.getSelected()).toEqual(['IL'])
  expect(errors).toEqual([])
})

test('multi-line fields break lines where the exporter does', async ({ page }) => {
  const samples = [
    'We offer a state-of-the-art, well-known and long-established self-service portal',
    'Contact: support@example-company.com or https://example.com/path/to/a-long-page?x=1',
    'Call 555-0100 on 2026-10-31 — or write to us, any time — e-mail is fine',
    'שלום, זהו טקסט ארוך עם מקף־עברי, תל-אביב-יפו ב-2020, ועוד כמה מילים כדי לגלוש',
  ]
  const widths = { notes: 181, narrow: 137 }
  const bytes = await formPdf((form, p) => {
    for (const [i, [name, width]] of Object.entries(widths).entries()) {
      const field = form.createTextField(name)
      field.enableMultiline()
      field.addToPage(p, { x: 50 + i * 250, y: 400, width, height: 300 })
      field.setFontSize(12)
    }
  })
  await open(page, 'multiline.pdf', bytes)
  for (const [name, text] of Object.keys(widths).flatMap((name) => samples.map((text) => [name, text]))) {
    const textarea = onPage(page, name).locator('textarea')
    await textarea.fill(text)
    const { browser, exporter } = await textarea.evaluate(async (ta: HTMLTextAreaElement) => {
      await document.fonts.ready
      const cs = getComputedStyle(ta)
      const width = ta.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      // The browser's lines, read from a mirror of the textarea.
      const mirror = document.createElement('div')
      const copied = [
        'fontFamily',
        'fontSize',
        'fontWeight',
        'fontStyle',
        'fontStretch',
        'fontKerning',
        'fontVariantLigatures',
        'fontFeatureSettings',
        'letterSpacing',
        'wordSpacing',
        'lineHeight',
        'whiteSpace',
        'overflowWrap',
        'wordBreak',
        'direction',
        'unicodeBidi',
        'textAlign',
      ] as const
      for (const p of copied) mirror.style[p] = cs[p]
      Object.assign(mirror.style, { position: 'absolute', left: '0', top: '0', visibility: 'hidden', width: `${width}px`, padding: '0' })
      mirror.textContent = ta.value
      document.body.append(mirror)
      const node = mirror.firstChild!
      const range = document.createRange()
      const lines: string[] = []
      let top: number | null = null
      for (let i = 0; i < ta.value.length; i++) {
        range.setStart(node, i)
        range.setEnd(node, i + 1)
        const t = Math.round(range.getClientRects()[0]?.top ?? top ?? 0)
        if (top === null || t !== top) lines.push('')
        lines[lines.length - 1] += ta.value[i]
        top = t
      }
      mirror.remove()
      // The exporter's lines, laid out with the same font and width (in px).
      const src = '/FillFlow/src/'
      const { wrapText } = await import(/* @vite-ignore */ `${src}lib/pdf/forms/textLayout.ts`)
      const { measureFieldText } = await import(/* @vite-ignore */ `${src}features/forms/measure.ts`)
      const wrapped = wrapText(ta.value, width, parseFloat(cs.fontSize), measureFieldText) as { start: number; end: number }[]
      return { browser: lines.map((l) => l.trimEnd()), exporter: wrapped.map((l) => ta.value.slice(l.start, l.end).trimEnd()) }
    })
    expect(browser.length, text).toBeGreaterThan(1)
    expect(exporter, text).toEqual(browser)
  }
})

test('a field named "__proto__" keeps its value on screen and in the download', async ({ page }) => {
  const errors = trackPageErrors(page)
  const bytes = await formPdf((form, p) => {
    const proto = form.createTextField('__proto__')
    proto.setText('hello')
    proto.addToPage(p, { x: 50, y: 700, width: 200, height: 20 })
    form.createTextField('normal').addToPage(p, { x: 50, y: 650, width: 200, height: 20 })
  })
  await open(page, 'proto.pdf', bytes)
  await expect(onPage(page, '__proto__').locator('input')).toHaveValue('hello')
  await onPage(page, 'normal').locator('input').fill('world')
  const form = (await downloadFillable(page)).getForm()
  expect(form.getTextField('__proto__').getText()).toBe('hello')
  expect(form.getTextField('normal').getText()).toBe('world')
  expect(errors).toEqual([])
})

test('a secured (owner password) form exports every value into its own field', async ({ page }) => {
  const errors = trackPageErrors(page)
  const plain = await formPdf((form, p) => {
    const names = ['first_name', 'last_name', 'street', 'city', 'phone', 'email']
    names.forEach((name, i) => form.createTextField(name).addToPage(p, { x: 50, y: 700 - i * 40, width: 200, height: 20 }))
    form.createCheckBox('agree').addToPage(p, { x: 300, y: 700, width: 14, height: 14 })
    const size = form.createRadioGroup('size')
    for (const [i, option] of ['S', 'M', 'L'].entries()) size.addOptionToPage(option, p, { x: 300 + i * 30, y: 650, width: 14, height: 14 })
  })
  await open(page, 'secured.pdf', await encryptPdf(plain, { owner: 'owner-only' }))
  const values: Record<string, string> = {
    first_name: 'Ada',
    last_name: 'Lovelace',
    street: '12 Analytical Way',
    city: 'London',
    phone: '555-0100',
    email: 'ada@example.com',
  }
  for (const [name, value] of Object.entries(values)) await (await formField(page, name)).locator('input').fill(value)
  await onPage(page, 'agree').click()
  await onPage(page, 'size').nth(2).click()

  const form = (await downloadFillable(page)).getForm()
  const text = Object.fromEntries(form.getFields().filter((f) => f instanceof PDFTextField).map((f) => [f.getName(), (f as PDFTextField).getText()]))
  expect(text).toEqual(values)
  expect(form.getCheckBox('agree').isChecked()).toBe(true)
  expect(form.getRadioGroup('size').getSelected()).toBe('L')
  expect(errors).toEqual([])
})

test('a secured form keeps the values of fields its field list misses', async ({ page }) => {
  const errors = trackPageErrors(page)
  const plain = await formPdf((form, p) => {
    form.createTextField('listed').addToPage(p, { x: 50, y: 700, width: 200, height: 20 })
    const orphan = form.createTextField('orphan')
    orphan.addToPage(p, { x: 50, y: 650, width: 200, height: 20 })
    const pick = form.createRadioGroup('pick')
    pick.addOptionToPage('a', p, { x: 50, y: 600, width: 14, height: 14 })
    pick.addOptionToPage('b', p, { x: 100, y: 600, width: 14, height: 14 })
    const twice = form.createTextField('twice')
    twice.addToPage(p, { x: 50, y: 550, width: 200, height: 20 })
    twice.addToPage(p, { x: 300, y: 550, width: 200, height: 20 })
    // Viewers show all of them, but the field list misses two fields and a widget.
    const list = form.acroForm.dict.lookup(PDFName.of('Fields'), PDFArray)
    for (const ref of [orphan.ref, pick.ref]) list.remove(list.indexOf(ref)!)
    twice.acroField.Kids()!.remove(1)
  })
  await open(page, 'secured-cut-off.pdf', await encryptPdf(plain, { owner: 'owner-only' }))
  const values = { listed: 'Listed value', orphan: 'Orphan value', twice: 'Twice value' }
  for (const [name, value] of Object.entries(values)) await (await formField(page, name)).locator('input').fill(value)
  await onPage(page, 'pick').nth(1).click()
  await expect(onPage(page, 'twice').nth(1).locator('input')).toHaveValue('Twice value')

  const form = (await downloadFillable(page)).getForm()
  for (const [name, value] of Object.entries(values)) expect(form.getTextField(name).getText()).toBe(value)
  expect(form.getTextField('twice').acroField.getWidgets()).toHaveLength(2)
  expect(form.getRadioGroup('pick').getSelected()).toBe('b')

  const flat = await downloadWith(page, true)
  expect((await PDFDocument.load(flat)).getForm().getFields()).toHaveLength(0)
  const shown = (await readPageText(flat, 0)).map((t) => t.str)
  expect(shown.filter((s) => s === 'Twice value')).toHaveLength(2)
  for (const value of ['Listed value', 'Orphan value']) expect(shown).toContain(value)
  expect(errors).toEqual([])
})

test('a secured form keeps fields apart that share a name under parents its field list misses', async ({ page }) => {
  const errors = trackPageErrors(page)
  const plain = await formPdf((form, p, doc) => {
    form.createTextField('listed').addToPage(p, { x: 50, y: 700, width: 200, height: 20 })
    // Two parents missing from the field list, each with a kid "name" that is its own widget.
    for (const [parent, y] of [
      ['p1', 650],
      ['p2', 600],
    ] as const) {
      const ref = doc.context.register(doc.context.obj({ T: PDFString.of(parent), Kids: [] }))
      const kid = doc.context.register(
        doc.context.obj({
          Type: 'Annot',
          Subtype: 'Widget',
          FT: 'Tx',
          T: PDFString.of('name'),
          Parent: ref,
          DA: PDFString.of('/Helv 0 Tf 0 g'),
          Rect: [50, y, 250, y + 20],
          F: 4,
          P: p.ref,
        }),
      )
      doc.context.lookup(ref, PDFDict).lookup(PDFName.of('Kids'), PDFArray).push(kid)
      p.node.addAnnot(kid)
    }
  })
  await open(page, 'secured-same-names.pdf', await encryptPdf(plain, { owner: 'owner-only' }))
  await onPage(page, 'p1.name').locator('input').fill('First')
  await onPage(page, 'p2.name').locator('input').fill('Second')
  const bytes = await downloadWith(page, false)
  const form = (await PDFDocument.load(bytes)).getForm()
  expect(form.getTextField('p1.name').getText()).toBe('First')
  expect(form.getTextField('p2.name').getText()).toBe('Second')

  // Opened again, they are still two fields, and saving again keeps both values.
  await open(page, 'secured-same-names-filled.pdf', bytes)
  await expect(onPage(page, 'p1.name').locator('input')).toHaveValue('First')
  await expect(onPage(page, 'p2.name').locator('input')).toHaveValue('Second')
  const again = (await downloadFillable(page)).getForm()
  expect(again.getTextField('p1.name').getText()).toBe('First')
  expect(again.getTextField('p2.name').getText()).toBe('Second')
  expect(errors).toEqual([])
})

test('a secured form keeps the names of copies of a field whose parent its field list misses', async ({ page }) => {
  const errors = trackPageErrors(page)
  const plain = await formPdf((form, p, doc) => {
    form.createTextField('listed').addToPage(p, { x: 50, y: 700, width: 200, height: 20 })
    // Acrobat's copies of a field: the parent, missing from the field list, holds the field type;
    // each copy is a field of its own merged with its widget, with only its name, value and label.
    const parent = doc.context.register(doc.context.obj({ FT: 'Tx', T: PDFString.of('Text1'), DA: PDFString.of('/Helv 0 Tf 0 g'), Kids: [] }))
    for (const [i, label] of ['First copy', 'Second copy'].entries()) {
      const copy = doc.context.register(
        doc.context.obj({
          Type: 'Annot',
          Subtype: 'Widget',
          T: PDFString.of(String(i)),
          TU: PDFString.of(label),
          V: PDFString.of(`Old ${i}`),
          Parent: parent,
          Rect: [50, 650 - i * 50, 250, 670 - i * 50],
          F: 4,
          P: p.ref,
        }),
      )
      doc.context.lookup(parent, PDFDict).lookup(PDFName.of('Kids'), PDFArray).push(copy)
      p.node.addAnnot(copy)
    }
  })
  await open(page, 'secured-copies.pdf', await encryptPdf(plain, { owner: 'owner-only' }))
  const values = { 'Text1.0': 'Zero', 'Text1.1': 'אחת' }
  for (const [name, value] of Object.entries(values)) await onPage(page, name).locator('input').fill(value)
  const bytes = await downloadWith(page, false)
  const form = (await PDFDocument.load(bytes)).getForm()
  expect(form.getFields().map((f) => f.getName())).toEqual(['listed', 'Text1.0', 'Text1.1'])
  for (const [name, value] of Object.entries(values)) expect(form.getTextField(name).getText()).toBe(value)

  // Opened again, every copy keeps its name, label and value, and saving again keeps them.
  await open(page, 'secured-copies-filled.pdf', bytes)
  for (const [i, [name, value]] of Object.entries(values).entries()) {
    const input = onPage(page, name).locator('input')
    await expect(input).toHaveValue(value)
    await expect(input).toHaveAttribute('aria-label', ['First copy', 'Second copy'][i])
  }
  const again = (await downloadFillable(page)).getForm()
  expect(again.getFields().map((f) => f.getName())).toEqual(['listed', 'Text1.0', 'Text1.1'])
  for (const [name, value] of Object.entries(values)) expect(again.getTextField(name).getText()).toBe(value)
  expect(errors).toEqual([])
})

test('moving between fields scrolls without animation when the system asks for less motion', async ({ page }) => {
  const errors = trackPageErrors(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const doc = await PDFDocument.create()
  for (let p = 0; p < 3; p++) {
    const pdfPage = doc.addPage([612, 792])
    for (let i = 1; i <= 12; i++) doc.getForm().createTextField(`f${p * 12 + i}`).addToPage(pdfPage, { x: 50, y: 780 - i * 60, width: 200, height: 20 })
  }
  await open(page, 'motion.pdf', await doc.save())
  // Every scripted scroll from here on: what it scrolled (a form panel row, the pages) and how.
  await page.evaluate(() => {
    const log: string[] = ((window as unknown as { scrolls: string[] }).scrolls = [])
    for (const method of ['scrollIntoView', 'scrollBy', 'scrollTo'] as const) {
      const original = Element.prototype[method] as (this: Element, ...args: unknown[]) => void
      ;(Element.prototype as unknown as Record<string, unknown>)[method] = function (this: Element, ...args: unknown[]) {
        const what = this.hasAttribute('data-panel-field') ? 'row' : this.getAttribute('aria-label') === 'Document pages' ? 'pages' : 'other'
        const options = args[0]
        log.push(`${what} ${(typeof options === 'object' && options !== null && (options as ScrollOptions).behavior) || 'auto'}`)
        return original.apply(this, args)
      }
    }
  })
  const scrolls = () => page.evaluate(() => (window as unknown as { scrolls: string[] }).scrolls)
  /** Does `action`, then waits until it has scrolled `what`. */
  const expectScroll = async (what: string, action: () => Promise<void>) => {
    const before = (await scrolls()).length
    await action()
    await expect.poll(async () => (await scrolls()).slice(before).some((s) => s.startsWith(`${what} `))).toBe(true)
  }

  // A field on the page brings its row into view in the panel...
  await showPage(page, 2)
  await expectScroll('row', () => onPage(page, 'f36').locator('input').click())
  // ... and a row of the panel its field into view on the page.
  await expectScroll('pages', () => page.locator('[data-panel-field="f1"] input').click())
  // In the panel's sheet on smaller screens, "Next empty field" scrolls the sheet to the field.
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.getByRole('button', { name: 'Form & items' }).click()
  await expectScroll('row', () => page.getByRole('dialog').getByRole('button', { name: 'Next empty field' }).click())

  // None of them animated.
  expect((await scrolls()).filter((s) => /^(row|pages) /.test(s) && !s.endsWith(' auto'))).toEqual([])
  expect(errors).toEqual([])
})
