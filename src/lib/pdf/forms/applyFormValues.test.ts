import { describe, expect, it } from 'vitest'
import fontkit from '@pdf-lib/fontkit'
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNull, PDFRef, PDFStream, degrees, type PDFFont } from 'pdf-lib'
import type { FormValues } from '../../../model/types'
import { applyFormValues } from '../../export/forms'
import { defaultFormValues, extractFormFields, getWidgetRotation, visualTextRotation } from '../formFields'
import { radioOptions } from './labels'
import { appearanceContent, arimoBytes, buildSampleForm, openWithPdfjs, pageText, shownHexStrings, widgetAnnotations } from './testing'
import { fieldValue } from './values'

interface ExportOptions {
  flatten?: boolean
  subset?: boolean
  needAppearances?: boolean
}

/** Mirrors what exportPdf does: extract with pdf.js, fill the ORIGINAL bytes with pdf-lib, save. */
async function exportForm(values: FormValues, opts: ExportOptions = {}) {
  const bytes = await buildSampleForm({ needAppearances: opts.needAppearances })
  const { pdf, raw, pages } = await openWithPdfjs(bytes)
  const fields = await extractFormFields(pdf, pages)
  await raw.loadingTask.destroy()

  const doc = await PDFDocument.load(bytes)
  doc.registerFontkit(fontkit)
  let unicode: Promise<PDFFont> | undefined
  let unicodeRequests = 0
  await applyFormValues(doc, fields, { ...defaultFormValues(fields), ...values }, {
    flatten: !!opts.flatten,
    pages,
    rewritten: false,
    getUnicodeFont: () => {
      unicodeRequests++
      return (unicode ??= doc.embedFont(arimoBytes, { subset: opts.subset ?? true }))
    },
  })
  // Default save options on purpose: pdf-lib must not regenerate (and break) our appearances.
  const out = await doc.save()
  return { out, fields, unicodeRequests }
}

async function reopen(out: Uint8Array) {
  const opened = await openWithPdfjs(out)
  const annots = await widgetAnnotations(opened.raw)
  const byName = (name: string) => annots.filter((a) => a.fieldName === name)
  return { ...opened, annots, byName }
}

let glyphToChar: Map<number, string> | undefined

/** Unicode text of glyph ids in a hex string (2-byte CIDs of an unsubsetted Arimo). */
function glyphsToText(hex: string): string {
  if (!glyphToChar) {
    const font = fontkit.create(arimoBytes)
    glyphToChar = new Map()
    for (const cp of font.characterSet) {
      const id = font.glyphForCodePoint(cp).id
      if (!glyphToChar.has(id)) glyphToChar.set(id, String.fromCodePoint(cp))
    }
  }
  let out = ''
  for (let i = 0; i < hex.length; i += 4) out += glyphToChar.get(parseInt(hex.slice(i, i + 4), 16)) ?? '�'
  return out
}

const latin1 = (hex: string) => hex.replace(/../g, (h) => String.fromCharCode(parseInt(h, 16)))

describe('applyFormValues', () => {
  it('writes every field type and keeps the form fillable', async () => {
    const { out, unicodeRequests } = await exportForm({
      'applicant.first_name': 'Jane',
      'applicant.last_name': 'Doe',
      zip: '1234567',
      pin: 'hunter2',
      notes: 'Line one\nLine two',
      agree: false,
      newsletter: true,
      color: 'blue',
      country: 'France',
      city: 'Jerusalem',
      langs: ['fr'],
      readonly_id: 'changed?',
    })
    expect(unicodeRequests).toBe(0)
    const { byName, raw } = await reopen(out)
    expect(byName('applicant.first_name')[0].fieldValue).toBe('Jane')
    expect(byName('applicant.last_name')[0].fieldValue).toBe('Doe')
    expect(byName('zip')[0].fieldValue).toBe('12345') // truncated to /MaxLen
    expect(byName('notes')[0].fieldValue).toBe('Line one\rLine two')
    expect(byName('agree')[0].fieldValue).toBe('Off')
    expect(byName('newsletter')[0].fieldValue).toBe('Yes')
    expect(byName('color').map((a) => a.fieldValue)).toEqual(['blue', 'blue', 'blue'])
    expect(byName('country')[0].fieldValue).toEqual(['France'])
    expect(byName('city')[0].fieldValue).toEqual(['Jerusalem'])
    expect(byName('langs')[0].fieldValue).toEqual(['fr'])
    expect(byName('readonly_id')[0].fieldValue).toBe('A-123') // read-only fields are never rewritten
    expect(byName('rotated')[0].fieldValue).toBe('rot')
    await raw.loadingTask.destroy()

    // pdf-lib reads the same values back, and appearances reflect them.
    const doc = await PDFDocument.load(out)
    const form = doc.getForm()
    expect(form.getTextField('applicant.first_name').getText()).toBe('Jane')
    expect(form.getCheckBox('newsletter').isChecked()).toBe(true)
    expect(form.getRadioGroup('color').getSelected()).toBe('blue')
    expect(form.acroForm.dict.has(PDFName.of('NeedAppearances'))).toBe(false)
    expect(shownHexStrings(appearanceContent(doc, 'applicant.first_name')).map(latin1)).toEqual(['Jane'])
    expect(shownHexStrings(appearanceContent(doc, 'notes')).map(latin1)).toEqual(['Line one', 'Line two'])
    expect(shownHexStrings(appearanceContent(doc, 'zip')).map(latin1)).toEqual(['1', '2', '3', '4', '5'])
    expect(shownHexStrings(appearanceContent(doc, 'pin')).map(latin1)).toEqual(['*******'])
    expect(shownHexStrings(appearanceContent(doc, 'city')).map(latin1)).toEqual(['Jerusalem'])
    expect(shownHexStrings(appearanceContent(doc, 'langs')).map(latin1)).toEqual(['en', 'he', 'fr'])
  })

  it('leaves untouched fields and their appearances alone', async () => {
    const before = await PDFDocument.load(await buildSampleForm())
    const original = appearanceContent(before, 'applicant.first_name')
    const { out } = await exportForm({})
    const after = await PDFDocument.load(out)
    expect(appearanceContent(after, 'applicant.first_name')).toBe(original)
    expect(after.getForm().getRadioGroup('color').getSelected()).toBe('green')
  })

  it('flattens: values become page content and no widgets remain', async () => {
    const { out } = await exportForm(
      { 'applicant.first_name': 'Jane', 'applicant.last_name': 'Doe', zip: '90210', newsletter: true, country: 'France' },
      { flatten: true },
    )
    const { annots, raw } = await reopen(out)
    expect(annots).toEqual([])
    expect(await raw.getFieldObjects()).toBeNull()
    const text = await pageText(raw, 1)
    expect(text).toContain('Jane')
    expect(text).toContain('Doe')
    expect(text).toContain('France')
    expect(text).not.toContain('secret') // hidden widgets are not drawn
    expect(await pageText(raw, 2)).toContain('rot')
    await raw.loadingTask.destroy()
    const doc = await PDFDocument.load(out)
    expect(doc.getForm().getFields()).toHaveLength(0)
    // No dangling widget references left in /Annots.
    for (const page of doc.getPages()) {
      const annots = page.node.Annots()
      for (let i = 0; i < (annots?.size() ?? 0); i++) expect(doc.context.lookup(annots!.get(i))).toBeDefined()
    }
  })

  it('writes Hebrew in visual order (with digits, Latin and mirrored brackets)', async () => {
    const { out, unicodeRequests } = await exportForm(
      {
        'applicant.first_name': 'שלום 123',
        'applicant.last_name': 'Hello שלום',
        notes: '(שלום) עולם\nתאריך: 31/10/2026',
        country: 'Israel',
      },
      { subset: false },
    )
    expect(unicodeRequests).toBeGreaterThan(0)
    const doc = await PDFDocument.load(out)
    const shown = (name: string) => shownHexStrings(appearanceContent(doc, name)).map(glyphsToText)
    expect(shown('applicant.first_name')).toEqual(['123 םולש'])
    expect(shown('applicant.last_name')).toEqual(['Hello םולש'])
    expect(shown('notes')).toEqual(['םלוע (םולש)', '31/10/2026 :ךיראת'])
    // WinAnsi-only fields keep the standard font.
    expect(shownHexStrings(appearanceContent(doc, 'country')).map(latin1)).toEqual(['Israel'])

    const { byName, raw } = await reopen(out)
    expect(byName('applicant.first_name')[0].fieldValue).toBe('שלום 123')
    expect(byName('notes')[0].fieldValue).toBe('(שלום) עולם\rתאריך: 31/10/2026')
    await raw.loadingTask.destroy()
  })

  it('gives every paragraph of a multi-line value its own direction, like <textarea dir="auto">', async () => {
    const { out } = await exportForm({ notes: 'Herzl St 12\nתל אביב 6100001' }, { subset: false })
    const doc = await PDFDocument.load(out)
    // The second line is reordered as an RTL paragraph even though the value starts in Latin.
    const content = appearanceContent(doc, 'notes')
    expect(shownHexStrings(content).map(glyphsToText)).toEqual(['Herzl St 12', '6100001 ביבא לת'])
  })

  it('right-aligns RTL text in a default (left) aligned field', async () => {
    const { out } = await exportForm({ 'applicant.first_name': 'שלום' }, { subset: false })
    const doc = await PDFDocument.load(out)
    const content = appearanceContent(doc, 'applicant.first_name')
    const x = Number(/1 0 0 1 ([\d.]+) [\d.]+ Tm/.exec(content)?.[1])
    expect(x).toBeGreaterThan(150) // widget is 201pt wide
  })

  it('keeps Hebrew readable after flattening (pdf.js recovers the logical text)', async () => {
    const { out } = await exportForm({ 'applicant.first_name': 'שלום 123', 'applicant.last_name': 'Hello שלום' }, { flatten: true })
    const { raw } = await reopen(out)
    const text = await pageText(raw, 1)
    expect(text).toContain('שלום 123')
    expect(text).toContain('Hello')
    await raw.loadingTask.destroy()
  })

  it('runs text along the long side of fields on rotated pages (no /MK /R)', async () => {
    const src = await PDFDocument.create()
    const page = src.addPage([612, 792])
    page.setRotation(degrees(90))
    const form = src.getForm()
    form.createTextField('tall').addToPage(page, { x: 100, y: 100, width: 200, height: 20 }) // tall on screen
    form.createTextField('wide').addToPage(page, { x: 300, y: 100, width: 20, height: 200 }) // wide on screen
    const bytes = await src.save()

    const { pdf, raw, pages } = await openWithPdfjs(bytes)
    const fields = await extractFormFields(pdf, pages)
    await raw.loadingTask.destroy()
    const byName = Object.fromEntries(fields.map((f) => [f.name, f.widgets[0]]))
    expect(visualTextRotation(byName.tall, 90)).toBe(270) // follows the page: reads top-to-bottom
    expect(visualTextRotation(byName.wide, 90)).toBe(0) // upright

    const values = { tall: 'Along the page', wide: 'Upright' }
    const flat = await PDFDocument.load(bytes)
    await applyFormValues(flat, fields, values, { flatten: true, getUnicodeFont: () => Promise.reject(new Error('unused')), pages, rewritten: false })
    const out = await openWithPdfjs(await flat.save())
    const items = (await (await out.raw.getPage(1)).getTextContent()).items as { str: string; transform: number[] }[]
    const t = (s: string) => items.find((i) => i.str === s)!.transform
    // /Rotate 90 shows user-space "up" as "right": upright text runs along +y in user space.
    expect(Math.abs(t('Upright')[0])).toBeLessThan(1e-6)
    expect(t('Upright')[1]).toBeGreaterThan(0)
    expect(t('Along the page')[0]).toBeGreaterThan(0)
    expect(Math.abs(t('Along the page')[1])).toBeLessThan(1e-6)
    await out.raw.loadingTask.destroy()

    const live = await PDFDocument.load(bytes)
    await applyFormValues(live, fields, values, { flatten: false, getUnicodeFont: () => Promise.reject(new Error('unused')), pages, rewritten: false })
    const rotationOf = (name: string) => live.getForm().getTextField(name).acroField.getWidgets()[0].getAppearanceCharacteristics()?.getRotation() ?? 0
    expect(rotationOf('wide')).toBe(90) // synced so other viewers draw it upright too
    expect(rotationOf('tall')).toBe(0)
  })

  it('keeps intentionally rotated fields (/MK /R) turned, on screen and in the export', async () => {
    const src = await PDFDocument.create()
    const page = src.addPage([612, 792])
    const vertical = src.getForm().createTextField('spine')
    vertical.addToPage(page, { x: 500, y: 300, width: 200, height: 24, rotate: degrees(90) })
    const bytes = await src.save()

    const { pdf, raw, pages } = await openWithPdfjs(bytes)
    const fields = await extractFormFields(pdf, pages)
    await raw.loadingTask.destroy()
    const widget = fields[0].widgets[0]
    expect(getWidgetRotation(widget)).toBe(90)
    expect(visualTextRotation(widget, 0)).toBe(90)
    // A tall, narrow box on the page; the text frame inside it is 200 wide once turned.
    expect(widget.rect.height).toBeGreaterThan(widget.rect.width)

    const doc = await PDFDocument.load(bytes)
    await applyFormValues(doc, fields, { spine: 'Volume 1' }, { flatten: true, getUnicodeFont: () => Promise.reject(new Error('unused')), pages, rewritten: false })
    const out = await openWithPdfjs(await doc.save())
    const items = (await (await out.raw.getPage(1)).getTextContent()).items.filter((i) => 'str' in i && i.str === 'Volume 1')
    expect(items).toHaveLength(1)
    const [a, b] = (items[0] as { transform: number[] }).transform
    expect(Math.abs(a)).toBeLessThan(1e-6)
    expect(b).toBeGreaterThan(0) // still runs bottom-to-top, as designed
    await out.raw.loadingTask.destroy()
  })

  it('writes values pdf.js showed from /DV when the file has no /V (nothing silently lost)', async () => {
    const src = await PDFDocument.create()
    const page = src.addPage([612, 792])
    const tf = src.getForm().createTextField('dv_only')
    tf.addToPage(page, { x: 50, y: 700, width: 200, height: 20 })
    tf.acroField.dict.set(PDFName.of('DV'), PDFHexString.fromText('Default text'))
    const bytes = await src.save()

    const { pdf, raw, pages } = await openWithPdfjs(bytes)
    const fields = await extractFormFields(pdf, pages)
    await raw.loadingTask.destroy()
    expect(fields[0].defaultValue).toBe('Default text')

    const doc = await PDFDocument.load(bytes)
    await applyFormValues(doc, fields, defaultFormValues(fields), { flatten: false, getUnicodeFont: () => Promise.reject(new Error('unused')), pages, rewritten: false })
    expect(doc.getForm().getTextField('dv_only').getText()).toBe('Default text')
  })

  it('regenerates stale appearances when the file asks for it (NeedAppearances)', async () => {
    const { out } = await exportForm({ 'applicant.last_name': 'Doe' }, { needAppearances: true })
    const doc = await PDFDocument.load(out)
    expect(doc.getForm().acroForm.dict.has(PDFName.of('NeedAppearances'))).toBe(false)
    expect(shownHexStrings(appearanceContent(doc, 'applicant.first_name')).map(latin1)).toEqual(['John'])
    expect(shownHexStrings(appearanceContent(doc, 'applicant.last_name')).map(latin1)).toEqual(['Doe'])
  })

  it('keeps a field fillable rather than flattening a stale appearance when its font is unavailable', async () => {
    const bytes = await buildSampleForm()
    const { pdf, raw, pages } = await openWithPdfjs(bytes)
    const fields = await extractFormFields(pdf, pages)
    await raw.loadingTask.destroy()
    const doc = await PDFDocument.load(bytes)
    await applyFormValues(doc, fields, { ...defaultFormValues(fields), 'applicant.first_name': 'שלום', 'applicant.last_name': 'Doe' }, {
      flatten: true,
      getUnicodeFont: () => Promise.reject(new Error('font download failed')),
      pages,
      rewritten: false,
    })
    const saved = await PDFDocument.load(await doc.save())
    const form = saved.getForm()
    expect(form.getFields().map((f) => f.getName())).toEqual(['applicant.first_name'])
    expect(form.getTextField('applicant.first_name').getText()).toBe('שלום')
    expect(form.acroForm.dict.lookup(PDFName.of('NeedAppearances'))?.toString()).toBe('true')
  })

  it('survives bad input: unknown fields, wrong value types, no fields', async () => {
    const bytes = await buildSampleForm()
    const { pdf, raw, pages } = await openWithPdfjs(bytes)
    const fields = await extractFormFields(pdf, pages)
    await raw.loadingTask.destroy()
    const doc = await PDFDocument.load(bytes)
    const ghost = { ...fields[0], name: 'does.not.exist', widgets: [{ ...fields[0].widgets[0], id: '9999R' }] }
    await expect(
      applyFormValues(doc, [ghost, ...fields], { agree: 'yes' as unknown as boolean, langs: 'fr' as unknown as string[], color: 'purple' }, {
        flatten: false,
        getUnicodeFont: () => Promise.reject(new Error('no font')),
        pages,
        rewritten: false,
      }),
    ).resolves.toEqual({ unwritten: ['does.not.exist'] })
    const saved = await PDFDocument.load(await doc.save())
    expect(saved.getForm().getOptionList('langs').getSelected()).toEqual(['fr'])
    expect(saved.getForm().getRadioGroup('color').getSelected()).toBeUndefined()

    const plain = await PDFDocument.create()
    plain.addPage()
    await applyFormValues(plain, [], {}, { flatten: true, getUnicodeFont: () => Promise.reject(new Error('unused')), pages: [], rewritten: false })
    expect(plain.catalog.has(PDFName.of('AcroForm'))).toBe(false)
  })
})

/** Extracts with pdf.js, fills the original bytes with pdf-lib and saves, like exportPdf. */
async function roundTrip(bytes: Uint8Array, values: FormValues, flatten: boolean) {
  const { pdf, raw, pages } = await openWithPdfjs(bytes)
  const fields = await extractFormFields(pdf, pages)
  await raw.loadingTask.destroy()
  const doc = await PDFDocument.load(bytes)
  const { unwritten } = await applyFormValues(doc, fields, { ...defaultFormValues(fields), ...values }, {
    flatten,
    getUnicodeFont: () => Promise.reject(new Error('unused')),
    pages,
    rewritten: false,
  })
  return { out: await doc.save(), fields, unwritten }
}

async function newForm(pageCount = 1) {
  const doc = await PDFDocument.create()
  const pages = Array.from({ length: pageCount }, () => doc.addPage([612, 792]))
  return { doc, pages, form: doc.getForm() }
}

const box = (y: number, x = 50) => ({ x, y, width: 200, height: 20 })

describe('applyFormValues: damaged and unusual forms', () => {
  it('ignores invalid entries of the field list instead of dropping every value', async () => {
    const { doc, pages, form } = await newForm()
    form.createTextField('first').addToPage(pages[0], box(700))
    form.createTextField('last').addToPage(pages[0], box(650))
    form.updateFieldAppearances()
    const list = form.acroForm.dict.lookup(PDFName.of('Fields'), PDFArray)
    list.push(PDFRef.of(9999))
    list.push(PDFNull)
    const bytes = await doc.save({ updateFieldAppearances: false })

    const live = await roundTrip(bytes, { first: 'Ada', last: 'Lovelace' }, false)
    expect(live.unwritten).toEqual([])
    const { byName, raw } = await reopen(live.out)
    expect([byName('first')[0].fieldValue, byName('last')[0].fieldValue]).toEqual(['Ada', 'Lovelace'])
    await raw.loadingTask.destroy()

    const flat = await roundTrip(bytes, { first: 'Ada', last: 'Lovelace' }, true)
    const reopened = await reopen(flat.out)
    expect(reopened.annots).toEqual([])
    expect(await pageText(reopened.raw, 1)).toMatch(/Ada.*Lovelace/)
    await reopened.raw.loadingTask.destroy()
  })

  it.each([
    ['missing from the field list', false],
    ['in a file without an AcroForm', true],
  ])('fills and flattens widgets %s', async (_, dropAcroForm) => {
    const { doc, pages, form } = await newForm()
    form.createTextField('listed').addToPage(pages[0], box(700))
    const orphan = form.createTextField('orphan')
    orphan.addToPage(pages[0], box(650))
    form.updateFieldAppearances()
    const list = form.acroForm.dict.lookup(PDFName.of('Fields'), PDFArray)
    list.remove(list.indexOf(orphan.ref)!)
    if (dropAcroForm) doc.catalog.delete(PDFName.of('AcroForm'))
    const bytes = await doc.save({ updateFieldAppearances: false })
    const values = { listed: 'Listed value', orphan: 'Orphan value' }

    const live = await roundTrip(bytes, values, false)
    expect(live.fields.map((f) => f.name)).toEqual(['listed', 'orphan'])
    expect(live.unwritten).toEqual([])
    const { byName, raw } = await reopen(live.out)
    expect(byName('orphan')[0].fieldValue).toBe('Orphan value')
    expect(byName('listed')[0].fieldValue).toBe('Listed value')
    await raw.loadingTask.destroy()

    const flat = await roundTrip(bytes, values, true)
    const reopened = await reopen(flat.out)
    expect(reopened.annots).toEqual([])
    expect(await pageText(reopened.raw, 1)).toMatch(/Listed value.*Orphan value/)
    await reopened.raw.loadingTask.destroy()
  })

  it('gives the value to every field that has the name, as the screen shows it', async () => {
    const { doc, pages, form } = await newForm(2)
    form.createTextField('name').addToPage(pages[0], box(700))
    const copy = form.createTextField('tmp')
    copy.addToPage(pages[1], box(700))
    form.updateFieldAppearances()
    copy.acroField.setPartialName('name')
    const bytes = await doc.save({ updateFieldAppearances: false })

    const live = await roundTrip(bytes, { name: 'Shared name' }, false)
    expect(live.fields).toHaveLength(1)
    const { byName, raw } = await reopen(live.out)
    expect(byName('name').map((a) => a.fieldValue)).toEqual(['Shared name', 'Shared name'])
    await raw.loadingTask.destroy()

    const flat = await reopen((await roundTrip(bytes, { name: 'Shared name' }, true)).out)
    expect(await pageText(flat.raw, 1)).toContain('Shared name')
    expect(await pageText(flat.raw, 2)).toContain('Shared name')
    await flat.raw.loadingTask.destroy()
  })

  it("keeps a check box's own on-appearance when the PDF has no off-appearance", async () => {
    const { doc, pages, form } = await newForm()
    for (const [name, y] of [
      ['cross', 700],
      ['untouched', 650],
    ] as const) {
      const check = form.createCheckBox(name)
      check.addToPage(pages[0], { x: 50, y, width: 14, height: 14 })
      const on = doc.context.formXObject([], { BBox: [0, 0, 14, 14], Marker: 'CustomCross' })
      const widget = check.acroField.getWidgets()[0]
      widget.dict.set(PDFName.of('AP'), doc.context.obj({ N: { On: doc.context.register(on) } }))
      widget.setAppearanceState(PDFName.of('Off'))
      check.acroField.dict.set(PDFName.of('V'), PDFName.of('Off'))
    }
    const bytes = await doc.save({ updateFieldAppearances: false })

    // Default save options, as the exporter: pdf-lib must not redraw the boxes either.
    const saved = await PDFDocument.load((await roundTrip(bytes, { cross: true }, false)).out)
    for (const name of ['cross', 'untouched']) {
      const widget = saved.getForm().getCheckBox(name).acroField.getWidgets()[0]
      const normal = widget.getAppearances()?.normal as PDFDict
      expect(saved.context.lookup(normal.get(PDFName.of('On')), PDFStream).dict.get(PDFName.of('Marker'))).toBe(PDFName.of('CustomCross'))
    }
    expect(saved.getForm().getCheckBox('cross').isChecked()).toBe(true)
    expect(saved.getForm().getCheckBox('untouched').isChecked()).toBe(false)
  })

  it('clears fields that have a default value (/DV) for good', async () => {
    const { doc, pages, form } = await newForm()
    const country = form.createTextField('country')
    country.setText('Israel')
    country.addToPage(pages[0], box(700))
    country.acroField.dict.set(PDFName.of('DV'), PDFHexString.fromText('Israel'))
    const size = form.createDropdown('size')
    size.addOptions(['S', 'M', 'L'])
    size.select('M')
    size.addToPage(pages[0], box(650))
    size.acroField.dict.set(PDFName.of('DV'), PDFHexString.fromText('M'))
    const sizes = form.createOptionList('sizes')
    sizes.addOptions(['S', 'M', 'L'])
    sizes.select('L')
    sizes.addToPage(pages[0], { x: 50, y: 520, width: 200, height: 70 })
    sizes.acroField.dict.set(PDFName.of('DV'), PDFHexString.fromText('L'))
    // Only a default, which the original appearance shows too.
    const dvOnly = form.createTextField('dv_only')
    dvOnly.setText('Default')
    dvOnly.addToPage(pages[0], box(450))
    form.updateFieldAppearances()
    dvOnly.acroField.dict.set(PDFName.of('DV'), PDFHexString.fromText('Default'))
    dvOnly.acroField.dict.delete(PDFName.of('V'))
    const bytes = await doc.save({ updateFieldAppearances: false })
    const cleared = { country: '', size: '', sizes: [], dv_only: '' }

    const live = await roundTrip(bytes, cleared, false)
    expect(live.fields.map((f) => f.defaultValue)).toEqual(['Israel', 'M', ['L'], 'Default'])
    const { pdf, raw, pages: views } = await openWithPdfjs(live.out)
    expect(defaultFormValues(await extractFormFields(pdf, views))).toEqual(cleared)
    await raw.loadingTask.destroy()

    const flat = await reopen((await roundTrip(bytes, cleared, true)).out)
    expect(await pageText(flat.raw, 1)).not.toMatch(/Israel|Default/)
    await flat.raw.loadingTask.destroy()
  })

  it('flattens what both shows and prints: screen-only widgets go, print-only fields stay', async () => {
    const { doc, pages, form } = await newForm()
    const both = form.createTextField('both')
    both.setText('ON SCREEN AND PAPER')
    both.addToPage(pages[0], box(700))
    const screen = form.createTextField('screen')
    screen.setText('ON SCREEN ONLY')
    screen.addToPage(pages[0], box(650))
    const clear = form.createButton('clear')
    clear.addToPage('Clear form', pages[0], box(600))
    const print = form.createTextField('print')
    print.setText('PRINT ONLY')
    print.addToPage(pages[0], box(550))
    const typed = form.createTextField('typed')
    typed.addToPage(pages[0], box(500))
    form.updateFieldAppearances()
    for (const field of [screen, clear, typed]) field.acroField.getWidgets()[0].setFlags(0)
    print.acroField.getWidgets()[0].setFlags(4 | 32)
    const bytes = await doc.save({ updateFieldAppearances: false })

    const { out } = await roundTrip(bytes, { typed: 'Typed by the user' }, true)
    const { raw } = await reopen(out)
    const text = await pageText(raw, 1)
    await raw.loadingTask.destroy()
    expect(text).toContain('ON SCREEN AND PAPER')
    expect(text).not.toMatch(/ON SCREEN ONLY|Clear form/)
    // What the user typed is kept, screen-only or not.
    expect(text).toContain('Typed by the user')
    const saved = (await PDFDocument.load(out)).getForm()
    expect(saved.getFields().map((f) => f.getName())).toEqual(['print'])
    expect(saved.getTextField('print').getText()).toBe('PRINT ONLY')
    expect(saved.acroForm.dict.has(PDFName.of('NeedAppearances'))).toBe(false)
  })

  it('flattens the fields of a file that sets the Print flag on no widget (PDFBox, for one)', async () => {
    const { doc, pages, form } = await newForm()
    const name = form.createTextField('name')
    name.addToPage(pages[0], box(700))
    const prefilled = form.createTextField('prefilled')
    prefilled.setText('From the file')
    prefilled.addToPage(pages[0], box(650))
    form.createCheckBox('agree').addToPage(pages[0], { x: 50, y: 600, width: 14, height: 14 })
    form.createButton('reset').addToPage('Reset', pages[0], box(550))
    form.updateFieldAppearances()
    for (const field of form.getFields()) for (const widget of field.acroField.getWidgets()) widget.dict.delete(PDFName.of('F'))
    const bytes = await doc.save({ updateFieldAppearances: false })

    const { out, unwritten } = await roundTrip(bytes, { name: 'Typed value', agree: true }, true)
    expect(unwritten).toEqual([])
    const { annots, raw } = await reopen(out)
    const text = await pageText(raw, 1)
    await raw.loadingTask.destroy()
    expect(annots).toEqual([])
    expect(text).toContain('Typed value')
    expect(text).toContain('From the file')
    expect(text).not.toContain('Reset') // a button does nothing once flattened
    const saved = await PDFDocument.load(out)
    expect(saved.getForm().getFields()).toHaveLength(0)
    const xobjects = saved.getPage(0).node.Resources()?.lookup(PDFName.of('XObject'), PDFDict)
    expect(xobjects?.keys().filter((k) => k.decodeText().startsWith('FlatWidget'))).toHaveLength(3) // name, prefilled, agree
  })

  it('tells apart radio buttons that share an export value', async () => {
    const { doc, pages, form } = await newForm()
    const q = form.createRadioGroup('q')
    for (const [option, x] of [
      ['Yes', 50],
      ['No', 100],
      ['Yes', 150],
    ] as const) {
      q.addOptionToPage(option, pages[0], { x, y: 700, width: 14, height: 14 })
    }
    // The file has the second "Yes" on.
    q.acroField.dict.set(PDFName.of('V'), PDFName.of('2'))
    q.acroField.getWidgets().forEach((w, i) => w.setAppearanceState(PDFName.of(i === 2 ? '2' : 'Off')))
    const bytes = await doc.save()
    const states = async (out: Uint8Array) => {
      const group = (await PDFDocument.load(out)).getForm().getRadioGroup('q')
      return [String(group.acroField.dict.get(PDFName.of('V'))), ...group.acroField.getWidgets().map((w) => String(w.getAppearanceState()))]
    }

    const untouched = await roundTrip(bytes, {}, false)
    const [field] = untouched.fields
    expect(field.widgets.map((w) => [w.exportValue, w.label])).toEqual([
      ['Yes', undefined],
      ['No', undefined],
      ['Yes#2', 'Yes'],
    ])
    expect(radioOptions(field).map((o) => o.label)).toEqual(['Yes', 'No', 'Yes (2)'])
    // pdf.js can't say which "Yes" is on: an untouched choice stays as the file has it.
    expect(await states(untouched.out)).toEqual(['/2', '/Off', '/Off', '/2'])
    expect(await states((await roundTrip(bytes, { q: 'Yes' }, false)).out)).toEqual(['/2', '/Off', '/Off', '/2'])
    expect(await states((await roundTrip(bytes, { q: 'No' }, false)).out)).toEqual(['/1', '/Off', '/1', '/Off'])
    const picked = await roundTrip((await roundTrip(bytes, { q: 'No' }, false)).out, { q: 'Yes#2' }, false)
    expect(await states(picked.out)).toEqual(['/2', '/Off', '/Off', '/2'])
  })

  it('keeps the value of a field named "__proto__"', async () => {
    const { doc, pages, form } = await newForm()
    const proto = form.createTextField('__proto__')
    proto.setText('hello')
    proto.addToPage(pages[0], box(700))
    form.createTextField('normal').addToPage(pages[0], box(650))
    const bytes = await doc.save()
    const { pdf, raw, pages: views } = await openWithPdfjs(bytes)
    const fields = await extractFormFields(pdf, views)
    await raw.loadingTask.destroy()
    const values = defaultFormValues(fields)
    expect(Object.keys(values)).toEqual(['__proto__', 'normal'])
    expect(fieldValue(fields[0], { ...values })).toBe('hello')
    expect(fieldValue(fields[0], {})).toBe('hello') // nothing stored: the PDF's value, not Object.prototype

    const { out, unwritten } = await roundTrip(bytes, { normal: 'world' }, false)
    expect(unwritten).toEqual([])
    const saved = (await PDFDocument.load(out)).getForm()
    expect(saved.getTextField('__proto__').getText()).toBe('hello')
    expect(saved.getTextField('normal').getText()).toBe('world')
  })
})
