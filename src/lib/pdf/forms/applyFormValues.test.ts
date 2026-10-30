import { describe, expect, it } from 'vitest'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, PDFHexString, PDFName, degrees, type PDFFont } from 'pdf-lib'
import type { FormValues } from '../../../model/types'
import { applyFormValues } from '../../export/forms'
import { defaultFormValues, extractFormFields, getWidgetRotation, visualTextRotation } from '../formFields'
import { appearanceContent, arimoBytes, buildSampleForm, openWithPdfjs, pageText, shownHexStrings, widgetAnnotations } from './testing'

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
    await applyFormValues(flat, fields, values, { flatten: true, getUnicodeFont: () => Promise.reject(new Error('unused')) })
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
    await applyFormValues(live, fields, values, { flatten: false, getUnicodeFont: () => Promise.reject(new Error('unused')) })
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
    await applyFormValues(doc, fields, { spine: 'Volume 1' }, { flatten: true, getUnicodeFont: () => Promise.reject(new Error('unused')) })
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
    await applyFormValues(doc, fields, defaultFormValues(fields), { flatten: false, getUnicodeFont: () => Promise.reject(new Error('unused')) })
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
      }),
    ).resolves.toBeUndefined()
    const saved = await PDFDocument.load(await doc.save())
    expect(saved.getForm().getOptionList('langs').getSelected()).toEqual(['fr'])
    expect(saved.getForm().getRadioGroup('color').getSelected()).toBeUndefined()

    const plain = await PDFDocument.create()
    plain.addPage()
    await applyFormValues(plain, [], {}, { flatten: true, getUnicodeFont: () => Promise.reject(new Error('unused')) })
    expect(plain.catalog.has(PDFName.of('AcroForm'))).toBe(false)
  })
})
