import { describe, expect, it } from 'vitest'
import fontkit from '@pdf-lib/fontkit'
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNull, PDFRef, PDFStream, PDFString, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { OPS as pdfjsOps } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { FormValues } from '../../../model/types'
import { applyFormValues, type ApplyFormOptions } from '../../export/forms'
import { defaultFormValues, extractFormFields, getWidgetRotation, visualTextRotation } from '../formFields'
import { hasStaleAppearance } from './extract'
import { radioOptions } from './labels'
import {
  appearanceContent,
  arimoBytes,
  buildSampleForm,
  openWithPdfjs,
  pageContent,
  pageText,
  renderAsViewers,
  shownHexStrings,
  widgetAnnotations,
} from './testing'
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

/**
 * Extracts with pdf.js and fills the original bytes like exportPdf; `items` then draws on the
 * pages, as the exporter draws the user's items after the form.
 */
async function exportWith(bytes: Uint8Array, values: FormValues, opts: Pick<ApplyFormOptions, 'flatten' | 'flattenAlso'>, items?: (doc: PDFDocument) => void) {
  const { pdf, raw, pages } = await openWithPdfjs(bytes)
  const fields = await extractFormFields(pdf, pages)
  await raw.loadingTask.destroy()
  const doc = await PDFDocument.load(bytes)
  doc.registerFontkit(fontkit)
  let unicode: Promise<PDFFont> | undefined
  await applyFormValues(doc, fields, { ...defaultFormValues(fields), ...values }, {
    ...opts,
    pages,
    rewritten: false,
    getUnicodeFont: () => (unicode ??= doc.embedFont(arimoBytes, { subset: false })),
  })
  items?.(doc)
  return { out: await doc.save(), fields }
}

const formXObject = (doc: PDFDocument, content: string, width: number, height: number) =>
  doc.context.register(doc.context.stream(content, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, width, height] }))

describe('applyFormValues: what other viewers show', () => {
  it('flattens the fields under placed items even when the rest stays fillable', async () => {
    const { doc, pages, form } = await newForm()
    const name = form.createTextField('name')
    name.setText('Dana Levi')
    name.addToPage(pages[0], { x: 50, y: 600, width: 200, height: 30 }) // pdf-lib's look: opaque white
    form.createTextField('other').addToPage(pages[0], box(500))
    // An unsigned signature field with an opaque look, as authoring tools make them.
    const look = formXObject(doc, '0.88 0.93 1 rg 0 0 200 40 re f', 200, 40)
    const sig = doc.context.register(
      doc.context.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFString.of('sig'), Rect: [50, 700, 250, 740], F: 4, P: pages[0].ref, AP: { N: look } }),
    )
    pages[0].node.addAnnot(sig)
    form.acroForm.addField(sig)
    const bytes = await doc.save()
    // The user's items: a signature in the signature field, a mark over the end of the text field.
    const items = (out: PDFDocument) => {
      out.getPage(0).drawRectangle({ x: 130, y: 710, width: 40, height: 20, color: rgb(0, 0, 0) })
      out.getPage(0).drawRectangle({ x: 225, y: 603, width: 20, height: 20, color: rgb(0, 0, 0) })
    }
    const shown = async (flattenAlso?: string[]) => {
      const { out } = await exportWith(bytes, {}, { flatten: false, flattenAlso }, items)
      const view = await renderAsViewers(out)
      return { out, ink: [view.inkIn(132, 792 - 728, 36, 16), view.inkIn(227, 792 - 621, 16, 16)] }
    }

    // Left as fields, viewers paint them over the items.
    expect((await shown()).ink).toEqual([0, 0])
    const { out, ink } = await shown(['sig', 'name'])
    expect(Math.min(...ink)).toBeGreaterThan(0.95)
    // Opened again: no empty signature field over the signature, and the flattened value stays.
    const { pdf, raw, pages: views } = await openWithPdfjs(out)
    expect((await extractFormFields(pdf, views)).map((f) => f.name)).toEqual(['other'])
    expect(await pageText(raw, 1)).toContain('Dana Levi')
    await raw.loadingTask.destroy()
    expect((await PDFDocument.load(out)).getForm().acroForm.dict.has(PDFName.of('NeedAppearances'))).toBe(false)
  })

  it('keeps flattened fields in their layers: one in a layer that is off stays hidden', async () => {
    const { doc, pages, form } = await newForm()
    const layer = (name: string) => doc.context.register(doc.context.obj({ Type: 'OCG', Name: PDFHexString.fromText(name) }))
    const off = layer('Answer key')
    const on = layer('Notes')
    doc.catalog.set(PDFName.of('OCProperties'), doc.context.obj({ OCGs: [off, on], D: { OFF: [off], Order: [off, on] } }))
    for (const [name, value, y, oc] of [
      ['answer', 'SECRET 42', 700, off],
      ['note', 'In a layer that is on', 650, on],
    ] as const) {
      const field = form.createTextField(name)
      field.setText(value)
      field.addToPage(pages[0], box(y))
      field.acroField.getWidgets()[0].dict.set(PDFName.of('OC'), oc)
    }
    form.createTextField('name').addToPage(pages[0], box(600))
    const bytes = await doc.save()

    const live = await exportWith(bytes, { name: 'Typed' }, { flatten: false })
    expect(live.fields.map((f) => f.name)).toEqual(['note', 'name'])
    const { out } = await exportWith(bytes, { name: 'Typed' }, { flatten: true })
    expect((await PDFDocument.load(out)).getForm().getFields()).toHaveLength(0)
    const view = await renderAsViewers(out)
    expect(view.inkIn(48, 792 - 722, 204, 24)).toBe(0)
    expect(view.inkIn(48, 792 - 672, 204, 24)).toBeGreaterThan(0)
    expect(view.inkIn(48, 792 - 622, 204, 24)).toBeGreaterThan(0)
    // Baked into its layer, which a viewer can still turn on.
    const { raw } = await openWithPdfjs(out)
    const config = await raw.getOptionalContentConfig()
    const ops = await (await raw.getPage(1)).getOperatorList()
    const marked = ops.argsArray.filter((args, i) => ops.fnArray[i] === pdfjsOps.beginMarkedContentProps && (args as unknown[])[0] === 'OC')
    expect(marked.map((args) => config.getGroup((args as [string, { id: string }])[1].id)?.name)).toEqual(['Answer key', 'Notes'])
    await raw.loadingTask.destroy()
  })

  it('turns the marks of check boxes upright on rotated pages, as the editor shows them', async () => {
    const doc = await PDFDocument.create()
    const form = doc.getForm()
    const blank = formXObject(doc, '', 36, 36)
    const page = (rotation: number) => {
      const added = doc.addPage([612, 792])
      added.setRotation(degrees(rotation))
      return added
    }
    const states = (on: PDFRef) => doc.context.obj({ N: { Yes: on, Off: blank } })
    const add = (name: string, pages: PDFPage[], ap: PDFDict | PDFRef, rotate = 0) => {
      const check = form.createCheckBox(name)
      pages.forEach((p, i) => check.addToPage(p, { x: 100, y: 100 + i * 100, width: 36, height: 36, borderWidth: 0, rotate: degrees(rotate) }))
      for (const widget of check.acroField.getWidgets()) widget.dict.set(PDFName.of('AP'), ap)
    }
    // A mark in the top-left corner of its box, drawn without regard for the page's rotation…
    const corner = formXObject(doc, '0 g 2 20 14 14 re f', 36, 36)
    for (const rotation of [0, 90, 180, 270]) add(`r${rotation}`, [page(rotation)], states(corner))
    // …drawn for its page, as Acrobat does: /MK /R is the page's rotation…
    add('acrobat', [page(90)], states(formXObject(doc, '0 g 2 2 14 14 re f', 36, 36)), 90)
    // …or turned for it by its own /Matrix, with no /MK /R to say so.
    const turned = doc.context.stream('0 g 2 20 14 14 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 36, 36], Matrix: [0, 1, -1, 0, 36, 0] })
    add('matrix', [page(90)], states(doc.context.register(turned)))
    // Widgets that share their appearances, on pages rotated alike and not.
    const sharing = page(90)
    add('shared', [sharing, sharing, page(0)], doc.context.register(states(corner)))
    const bytes = await doc.save({ updateFieldAppearances: false })
    const ticked = { r0: true, r90: true, r180: true, r270: true, acrobat: true, matrix: true, shared: true }

    const live = await exportWith(bytes, ticked, { flatten: false })
    const again = await exportWith(live.out, {}, { flatten: false })
    const flat = await exportWith(bytes, ticked, { flatten: true })
    for (const [what, { out }] of Object.entries({ live, again, flat })) {
      for (const field of live.fields) {
        for (const { page: index, rect } of field.widgets) {
          const view = await renderAsViewers(out, index + 1)
          const ink = (dx: number, dy: number) => view.inkIn(rect.x + dx, rect.y + dy, 10, 10)
          // In the top-left corner as the page is seen, and nowhere else.
          expect([ink(4, 4) > 0.9, ink(22, 4), ink(4, 22), ink(22, 22)], `${field.name} on page ${index + 1} (${what})`).toEqual([true, 0, 0, 0])
        }
      }
    }
    const turns = (await PDFDocument.load(live.out))
      .getForm()
      .getFields()
      .flatMap((f) => f.acroField.getWidgets().map((w) => w.getAppearanceCharacteristics()?.getRotation()))
    expect(turns).toEqual([0, 90, 180, 270, 90, 90, 90, 90, 0])
  })

  it('keeps the marks it turns upright in proportion in boxes that are not square', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([612, 792])
    page.setRotation(degrees(90))
    const check = doc.getForm().createCheckBox('tall')
    // 36 wide and 18 high on the page as drawn: 18 wide and 36 high as the page is seen.
    check.addToPage(page, { x: 100, y: 100, width: 36, height: 18, borderWidth: 0 })
    // A square mark in the top-left corner of the art, drawn without regard for the page's rotation.
    const on = formXObject(doc, '0 g 1 9 8 8 re f', 36, 18)
    check.acroField.getWidgets()[0].dict.set(PDFName.of('AP'), doc.context.obj({ N: { Yes: on, Off: formXObject(doc, '', 36, 18) } }))
    const bytes = await doc.save({ updateFieldAppearances: false })
    for (const flatten of [false, true]) {
      const { out, fields } = await exportWith(bytes, { tall: true }, { flatten })
      const { rect } = fields[0].widgets[0]
      const view = await renderAsViewers(out, 1, 4)
      const ink = (x: number, y: number, w: number, h: number) => view.inkIn(rect.x + x, rect.y + y, w, h)
      // The art turned and fitted whole (18 × 9) in the middle of the box: the mark is a 4 × 4
      // square in its top-left corner, not one stretched to 4 × 16.
      expect([ink(1, 14.5, 3, 3) > 0.9, ink(0, 0, 18, 13), ink(6, 13, 12, 23), ink(0, 19, 18, 17)], flatten ? 'flattened' : 'fillable').toEqual([true, 0, 0, 0])
    }
  })

  it('draws upright, and in proportion, the marks of check boxes on rotated pages that have none', async () => {
    const doc = await PDFDocument.create()
    const form = doc.getForm()
    for (const rotation of [0, 90, 180, 270]) {
      const page = doc.addPage([612, 792])
      page.setRotation(degrees(rotation))
      const check = form.createCheckBox(`r${rotation}`)
      // 18 wide and 36 high as the page is seen.
      const [width, height] = rotation % 180 ? [36, 18] : [18, 36]
      check.addToPage(page, { x: 100, y: 100, width, height, borderWidth: 0 })
      check.acroField.getWidgets()[0].dict.delete(PDFName.of('AP'))
    }
    const bytes = await doc.save({ updateFieldAppearances: false })
    const ticked = { r0: true, r90: true, r180: true, r270: true }
    for (const flatten of [false, true]) {
      const { out, fields } = await exportWith(bytes, ticked, { flatten })
      // The ink in a 4 × 8 grid over the box as the page is seen, as on the page that isn't rotated.
      const grids: number[][] = []
      for (const [i, field] of fields.entries()) {
        const { rect } = field.widgets[0]
        const view = await renderAsViewers(out, i + 1, 4)
        grids.push([0, 1, 2, 3, 4, 5, 6, 7].flatMap((row) => [0, 1, 2, 3].map((col) => view.inkIn(rect.x + col * 4.5, rect.y + row * 4.5, 4.5, 4.5))))
      }
      const [upright, ...turned] = grids
      // pdf-lib's mark is a square in the middle: none in the top and bottom quarters.
      expect([...upright.slice(0, 8), ...upright.slice(24)].every((ink) => ink === 0)).toBe(true)
      expect(upright.slice(8, 24).reduce((a, b) => a + b)).toBeGreaterThan(1)
      for (const [i, grid] of turned.entries()) {
        grid.forEach((ink, cell) => expect(ink, `${fields[i + 1].name}, cell ${cell}${flatten ? ', flattened' : ''}`).toBeCloseTo(upright[cell], 1))
      }
    }
  })

  it('marks the fields it flattens as artifacts in a tagged PDF, and only there', async () => {
    for (const tagged of [false, true]) {
      const { doc, pages, form } = await newForm()
      const name = form.createTextField('name')
      name.setText('Dana Levi')
      name.addToPage(pages[0], box(700))
      form.createTextField('other').addToPage(pages[0], box(650))
      if (tagged) {
        doc.catalog.set(PDFName.of('MarkInfo'), doc.context.obj({ Marked: true }))
        doc.catalog.set(PDFName.of('StructTreeRoot'), doc.context.register(doc.context.obj({ Type: 'StructTreeRoot' })))
      }
      const { out } = await roundTrip(await doc.save(), { other: 'Typed' }, true)
      const content = pageContent(await PDFDocument.load(out))
      const drawn = String.raw`q\s+[-\d. ]+ cm\s+/FlatWidget-\d+ Do\s+Q`
      // One marked-content sequence per field drawn, with no MCID: it can't clash with the tags
      // the exporter gives the items it draws next.
      if (tagged) expect(content.match(new RegExp(String.raw`/Artifact BMC\s+${drawn}\s+EMC`, 'g'))).toHaveLength(2)
      else expect(content.match(new RegExp(drawn, 'g'))).toHaveLength(2)
      expect(content.includes('/Artifact'), tagged ? 'tagged' : 'untagged').toBe(tagged)
      const { raw } = await reopen(out)
      expect(await pageText(raw, 1)).toMatch(/Dana Levi.*Typed/)
      await raw.loadingTask.destroy()
    }
  })

  it('turns a check box upright without turning the widgets that share its /MK', async () => {
    const doc = await PDFDocument.create()
    const form = doc.getForm()
    const turned = doc.addPage([612, 792])
    turned.setRotation(degrees(90))
    const upright = doc.addPage([612, 792])
    const look = () => doc.context.obj({ BC: [0, 0, 0], BG: [1, 1, 1] })
    // One /MK object that widgets on both pages point to.
    const shared = doc.context.register(look())
    const box = form.createCheckBox('box')
    box.addToPage(turned, { x: 100, y: 100, width: 36, height: 36, borderWidth: 0 })
    // Its own art: a mark in the top-left corner of its box, drawn without regard for the page's rotation.
    const corner = formXObject(doc, '0 g 2 20 14 14 re f', 36, 36)
    box.acroField.getWidgets()[0].dict.set(PDFName.of('AP'), doc.context.obj({ N: { Yes: corner, Off: formXObject(doc, '', 36, 36) } }))
    const name = form.createTextField('name')
    name.addToPage(upright, { x: 50, y: 600, width: 200, height: 30 })
    // Check boxes pdf-lib draws (they have no look of their own): one sharing the /MK, one with a copy.
    for (const [check, x] of [
      ['plain', 50],
      ['control', 150],
    ] as const) {
      form.createCheckBox(check).addToPage(upright, { x, y: 500, width: 24, height: 24 })
      form.getCheckBox(check).acroField.getWidgets()[0].dict.delete(PDFName.of('AP'))
    }
    for (const field of [box, name, form.getCheckBox('plain')]) field.acroField.getWidgets()[0].dict.set(PDFName.of('MK'), shared)
    form.getCheckBox('control').acroField.getWidgets()[0].dict.set(PDFName.of('MK'), look())
    const bytes = await doc.save({ updateFieldAppearances: false })

    for (const flatten of [false, true]) {
      const what = flatten ? 'flattened' : 'fillable'
      const { out, fields } = await exportWith(bytes, { box: true, name: 'Dana Levi', plain: true, control: true }, { flatten })
      const rect = (field: string) => fields.find((f) => f.name === field)!.widgets[0].rect
      // The mark on the turned page is upright: in the top-left corner as the page is seen.
      const first = await renderAsViewers(out, 1)
      const r = rect('box')
      const mark = (dx: number, dy: number) => first.inkIn(r.x + dx, r.y + dy, 10, 10)
      expect([mark(4, 4) > 0.9, mark(22, 4), mark(4, 22), mark(22, 22)], what).toEqual([true, 0, 0, 0])
      // The text on the other page reads upright, along its field.
      const second = await renderAsViewers(out, 2, 4)
      const n = rect('name')
      const along = [0, 1, 2, 3].map((i) => second.inkIn(n.x + 4 + i * 18, n.y + 5, 18, n.height - 10))
      expect(Math.min(...along), what).toBeGreaterThan(0.02)
      // pdf-lib's mark in the box that shares the /MK is drawn like the one in the box that doesn't.
      const grid = (field: string) => {
        const b = rect(field)
        return [0, 1, 2, 3].flatMap((row) => [0, 1, 2, 3].map((col) => second.inkIn(b.x + 2 + col * 5, b.y + 2 + row * 5, 5, 5)))
      }
      const control = grid('control')
      expect(control.reduce((a, b) => a + b)).toBeGreaterThan(1)
      grid('plain').forEach((ink, cell) => expect(ink, `${what}, cell ${cell}`).toBeCloseTo(control[cell], 1))
      if (flatten) continue
      const saved = await PDFDocument.load(out)
      const turn = (field: string) => saved.getForm().getField(field).acroField.getWidgets()[0].getAppearanceCharacteristics()?.getRotation() ?? 0
      expect(['box', 'name', 'plain'].map(turn)).toEqual([90, 0, 0])
      // The text field's appearance isn't turned (rotateInPlace writes identity matrices for 0°).
      const cms = appearanceContent(saved, 'name')
        .split('\n')
        .filter((line) => line.endsWith(' cm'))
      expect(cms.length).toBeGreaterThan(0)
      expect(cms.filter((line) => line !== '1 0 0 1 0 0 cm')).toEqual([])
    }
  })

  it("redraws untouched text fields whose own appearance doesn't show their value", async () => {
    const { doc, pages, form } = await newForm()
    doc.registerFontkit(fontkit)
    const fields: [string, string][] = [
      ['amount', '$100.00'],
      ['customer', ''],
      ['consistent', 'Consistent value'],
      ['price', '$950.00'],
      // pdf-lib (fontkit) draws a right-to-left run reversed whole, digits included: "21".
      ['address', 'רחוב הרצל 12, תל אביב'],
      ['id_note', 'ת.ז. 123456789'],
      ['date', '04/03/2025'],
      ['name', 'Levi Dana'],
    ]
    for (const [i, [name, text]] of fields.entries()) {
      const field = form.createTextField(name)
      field.addToPage(pages[0], box(700 - i * 50))
      field.setText(text)
    }
    form.updateFieldAppearances(await doc.embedFont(arimoBytes))
    // Values stored by a tool that didn't redraw the appearances (and set no NeedAppearances).
    const setValue = (name: string, value: string) => form.getTextField(name).acroField.dict.set(PDFName.of('V'), PDFHexString.fromText(value))
    setValue('amount', '$950.00')
    setValue('customer', 'John Smith')
    // The same characters, in another order.
    setValue('date', '03/04/2025')
    setValue('name', 'Dana Levi')
    // A formatted field shows its value formatted: "$950.00" for 950. That look is right.
    setValue('price', '950')
    const format = doc.context.obj({ S: 'JavaScript', JS: PDFString.of('AFNumber_Format(2, 0, 0, 0, "$", true);') })
    form.getTextField('price').acroField.dict.set(PDFName.of('AA'), doc.context.obj({ F: format }))
    const bytes = await doc.save({ updateFieldAppearances: false })
    const original = await PDFDocument.load(bytes)

    const live = await exportWith(bytes, {}, { flatten: false })
    expect(live.fields.filter(hasStaleAppearance).map((f) => f.name)).toEqual(['amount', 'customer', 'address', 'id_note', 'date', 'name'])
    const { byName, raw } = await reopen(live.out)
    expect(Object.fromEntries(fields.map(([name]) => [name, byName(name)[0].textContent]))).toEqual({
      amount: ['$950.00'],
      customer: ['John Smith'],
      consistent: ['Consistent value'],
      price: ['$950.00'],
      address: ['רחוב הרצל 12, תל אביב'],
      // (pdf.js reads a line that mixes directions back in an order of its own.)
      id_note: ['123456789 .ת.ז'],
      date: ['03/04/2025'],
      name: ['Dana Levi'],
    })
    await raw.loadingTask.destroy()
    const saved = await PDFDocument.load(live.out)
    for (const name of ['consistent', 'price']) expect(appearanceContent(saved, name)).toBe(appearanceContent(original, name))
    // The appearances drawn show their values: the next export keeps them.
    expect((await exportWith(live.out, {}, { flatten: false })).fields.filter(hasStaleAppearance)).toEqual([])

    const flat = await reopen((await exportWith(bytes, {}, { flatten: true })).out)
    const text = await pageText(flat.raw, 1)
    await flat.raw.loadingTask.destroy()
    for (const shown of ['$950.00', 'John Smith', 'Consistent value', 'רחוב הרצל 12, תל אביב', '123456789', '03/04/2025', 'Dana Levi']) expect(text).toContain(shown)
    for (const stale of ['$100.00', '987654321', '04/03/2025', 'Levi Dana']) expect(text).not.toContain(stale)
  })
})
