import { describe, expect, it } from 'vitest'
import type { FormField, PageInfo } from '../../../model/types'
import { defaultFormValues, extractFormFields, getFieldExtras, getFormDocumentInfo } from '../formFields'
import { buildFormFields } from './extract'
import { SAMPLE_ORDER, buildSampleForm, openWithPdfjs } from './testing'

const PAGE: PageInfo = { index: 0, width: 612, height: 792, rotation: 0, view: [0, 0, 612, 792], userUnit: 1 }

async function sampleFields() {
  const { pdf, raw, pages } = await openWithPdfjs(await buildSampleForm())
  const fields = await extractFormFields(pdf, pages)
  const info = getFormDocumentInfo(pdf)
  await raw.loadingTask.destroy()
  return { fields, pages, info, byName: Object.fromEntries(fields.map((f) => [f.name, f])) as Record<string, FormField> }
}

describe('extractFormFields (pdf.js)', () => {
  it('finds every visible field in reading order, skipping hidden widgets', async () => {
    const { fields, info } = await sampleFields()
    expect(fields.map((f) => f.name)).toEqual(SAMPLE_ORDER)
    expect(info).toEqual({ pureXfa: false })
  })

  it('maps types and per-type properties', async () => {
    const { byName } = await sampleFields()
    expect(byName['applicant.first_name']).toMatchObject({ type: 'text', required: true, readOnly: false, label: 'Given name' })
    expect(byName['zip']).toMatchObject({ type: 'text', comb: true, maxLength: 5, multiline: false })
    expect(byName['pin']).toMatchObject({ type: 'text', password: true, comb: false })
    expect(byName['notes']).toMatchObject({ type: 'text', multiline: true, textAlign: 'center' })
    expect(byName['agree']).toMatchObject({ type: 'checkbox' })
    expect(byName['agree'].widgets[0].exportValue).toBe('Yes')
    expect(byName['color'].type).toBe('radio')
    expect(byName['color'].widgets.map((w) => w.exportValue)).toEqual(['red', 'green', 'blue'])
    expect(byName['country']).toMatchObject({ type: 'dropdown', editable: false })
    expect(byName['country'].options).toEqual([
      { value: 'Israel', label: 'Israel' },
      { value: 'USA', label: 'USA' },
      { value: 'France', label: 'France' },
    ])
    expect(byName['city']).toMatchObject({ type: 'dropdown', editable: true })
    expect(byName['langs']).toMatchObject({ type: 'listbox', multiSelect: true })
    expect(byName['readonly_id']).toMatchObject({ type: 'text', readOnly: true })
    expect(byName['sig']).toMatchObject({ type: 'signature', defaultValue: '' })
    // pdf-lib writes an explicit /DA size; 0 would mean auto.
    expect(byName['applicant.first_name'].fontSize).toBeGreaterThan(0)
    expect(getFieldExtras(byName['applicant.first_name'])).toEqual({ textColor: undefined, borderWidth: 1 })
  })

  it('reads the values stored in the PDF as defaults', async () => {
    const { fields } = await sampleFields()
    expect(defaultFormValues(fields)).toEqual({
      'applicant.first_name': 'John',
      'applicant.last_name': '',
      zip: '',
      pin: '',
      notes: '',
      agree: true,
      newsletter: false,
      color: 'green',
      country: 'USA',
      city: '',
      langs: ['en', 'he'],
      readonly_id: 'A-123',
      sig: '',
      rotated: 'rot',
    })
  })

  it('converts widget rectangles to view space, including rotated pages', async () => {
    const { byName, pages } = await sampleFields()
    // pdf-lib grows the widget by its 1pt border: /Rect [49.5 699.5 250.5 720.5].
    const r = byName['applicant.first_name'].widgets[0]
    expect(r.page).toBe(0)
    expect(r.rect.x).toBeCloseTo(49.5)
    expect(r.rect.y).toBeCloseTo(792 - 720.5)
    expect(r.rect.width).toBeCloseTo(201)
    expect(r.rect.height).toBeCloseTo(21)
    expect(pages[1]).toMatchObject({ rotation: 90, width: 792, height: 612 })
    const rot = byName['rotated'].widgets[0]
    expect(rot.page).toBe(1)
    // /Rotate 90: view x = pdf y, view y = pdf x → the box stands on its side.
    expect(rot.rect.x).toBeCloseTo(99.5)
    expect(rot.rect.y).toBeCloseTo(99.5)
    expect(rot.rect.width).toBeCloseTo(21)
    expect(rot.rect.height).toBeCloseTo(201)
  })

  it('leaves out signature fields that are already digitally signed', async () => {
    const { PDFDocument, PDFHexString, PDFName, PDFString } = await import('pdf-lib')
    const doc = await PDFDocument.create()
    const page = doc.addPage([612, 792])
    const form = doc.getForm()
    const sigField = (name: string, y: number, signed: boolean) => {
      const dict = doc.context.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFString.of(name), Rect: [50, y, 250, y + 40], F: 4, P: page.ref })
      if (signed) {
        const sig = doc.context.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached', ByteRange: [0, 10, 20, 10] })
        sig.set(PDFName.of('Contents'), PDFHexString.of('3082000102'))
        dict.set(PDFName.of('V'), doc.context.register(sig))
      }
      const ref = doc.context.register(dict)
      page.node.addAnnot(ref)
      form.acroForm.addField(ref)
    }
    sigField('signed', 600, true)
    sigField('open', 500, false)
    form.acroForm.dict.set(PDFName.of('SigFlags'), doc.context.obj(3))
    const { pdf, raw, pages } = await openWithPdfjs(await doc.save({ updateFieldAppearances: false }))
    expect(await raw.getSignatures()).toHaveLength(1)
    expect((await extractFormFields(pdf, pages)).map((f) => f.name)).toEqual(['open'])
    // Without the signature list both widgets would be offered.
    const annots = [await (await raw.getPage(1)).getAnnotations()]
    expect(buildFormFields(annots, pages).map((f) => f.name)).toEqual(['signed', 'open'])
    await raw.loadingTask.destroy()
  })

  it('leaves out a signed signature field whose widget is a separate kid', async () => {
    const { PDFDocument, PDFHexString, PDFName, PDFString } = await import('pdf-lib')
    const doc = await PDFDocument.create()
    const page = doc.addPage([612, 792])
    const form = doc.getForm()
    const sigField = (name: string, y: number, signed: boolean) => {
      const field = doc.context.nextRef()
      const widget = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [50, y, 250, y + 40], F: 4, P: page.ref, Parent: field }))
      const dict = doc.context.obj({ FT: 'Sig', T: PDFString.of(name), Kids: [widget] })
      if (signed) {
        const sig = doc.context.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached', ByteRange: [0, 10, 20, 10] })
        sig.set(PDFName.of('Contents'), PDFHexString.of('3082000102'))
        dict.set(PDFName.of('V'), doc.context.register(sig))
      }
      doc.context.assign(field, dict)
      page.node.addAnnot(widget)
      form.acroForm.addField(field)
    }
    sigField('signed_kid', 600, true)
    sigField('open_kid', 500, false)
    form.acroForm.dict.set(PDFName.of('SigFlags'), doc.context.obj(3))
    const { pdf, raw, pages } = await openWithPdfjs(await doc.save({ updateFieldAppearances: false }))
    expect(await raw.getSignatures()).toHaveLength(1)
    expect((await extractFormFields(pdf, pages)).map((f) => f.name)).toEqual(['open_kid'])
    await raw.loadingTask.destroy()
  })

  it('returns [] for a document without a form', async () => {
    const { PDFDocument } = await import('pdf-lib')
    const doc = await PDFDocument.create()
    doc.addPage()
    const { pdf, raw, pages } = await openWithPdfjs(await doc.save())
    expect(await extractFormFields(pdf, pages)).toEqual([])
    await raw.loadingTask.destroy()
  })

  it('flags pure XFA documents', async () => {
    const { PDFDocument, PDFName } = await import('pdf-lib')
    const doc = await PDFDocument.create()
    doc.addPage()
    const xfa = doc.context.register(doc.context.flateStream('<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"></xdp:xdp>'))
    doc.catalog.set(PDFName.of('AcroForm'), doc.context.obj({ Fields: [], XFA: xfa }))
    doc.catalog.set(PDFName.of('NeedsRendering'), doc.context.obj(true))
    const { pdf, raw, pages } = await openWithPdfjs(await doc.save({ updateFieldAppearances: false }))
    expect(await extractFormFields(pdf, pages)).toEqual([])
    expect(getFormDocumentInfo(pdf)).toEqual({ pureXfa: true })
    await raw.loadingTask.destroy()
  })
})

describe('buildFormFields', () => {
  const widget = (over: Record<string, unknown>) => ({
    annotationType: 20,
    subtype: 'Widget',
    rect: [100, 100, 114, 114],
    fieldFlags: 0,
    ...over,
  })

  it('treats same-name check boxes with different export values as a radio group', () => {
    const fields = buildFormFields(
      [
        [
          widget({ id: '1R', fieldName: 'size', fieldType: 'Btn', checkBox: true, exportValue: 'S', fieldValue: 'Off', rect: [100, 100, 114, 114] }),
          widget({ id: '2R', fieldName: 'size', fieldType: 'Btn', checkBox: true, exportValue: 'M', fieldValue: 'M', rect: [130, 100, 144, 114] }),
        ],
      ],
      [PAGE],
    )
    expect(fields).toHaveLength(1)
    expect(fields[0]).toMatchObject({ type: 'radio', defaultValue: 'M' })
    expect(fields[0].widgets.map((w) => w.exportValue)).toEqual(['S', 'M'])
  })

  it('keys radio buttons that repeat an export value per group, unless they turn on in unison', () => {
    const radio = (id: string, name: string, value: string, x: number, flags = 0) =>
      widget({ id, fieldName: name, fieldType: 'Btn', radioButton: true, buttonValue: value, fieldValue: 'Yes', fieldFlags: flags, rect: [x, 100, x + 14, 114] })
    // The same group twice (a form merged with itself): each repeats "Yes".
    const group = (ids: string[]) => [radio(ids[0], 'q', 'Yes', 100), radio(ids[1], 'q', 'No', 130), radio(ids[2], 'q', 'Yes', 160)]
    const parentOf = new Map(['1R', '2R', '3R'].map((id) => [id, '10R']).concat(['4R', '5R', '6R'].map((id) => [id, '20R'])) as [string, string][])
    const [q] = buildFormFields([group(['1R', '2R', '3R']), group(['4R', '5R', '6R'])], [PAGE, { ...PAGE, index: 1 }], { parentOf })
    expect(q.widgets.map((w) => w.exportValue)).toEqual(['Yes', 'No', 'Yes#2', 'Yes', 'No', 'Yes#2'])
    expect(q.widgets.map((w) => w.label)).toEqual([undefined, undefined, 'Yes', undefined, undefined, 'Yes'])
    expect(q.defaultValue).toBe('Yes')

    const UNISON = 1 << 25
    const [u] = buildFormFields([[radio('1R', 'u', 'Yes', 100, UNISON), radio('2R', 'u', 'Yes', 130, UNISON)]], [PAGE])
    expect(u.widgets.map((w) => w.exportValue)).toEqual(['Yes', 'Yes'])
  })

  it('shares one value across same-name widgets on different pages', () => {
    const fields = buildFormFields(
      [
        [widget({ id: '1R', fieldName: 'name', fieldType: 'Tx', fieldValue: 'Ann', rect: [50, 700, 250, 720] })],
        [widget({ id: '2R', fieldName: 'name', fieldType: 'Tx', fieldValue: 'Ann', rect: [50, 50, 250, 70] })],
      ],
      [PAGE, { ...PAGE, index: 1 }],
    )
    expect(fields).toHaveLength(1)
    expect(fields[0].widgets.map((w) => w.page)).toEqual([0, 1])
    expect(fields[0].defaultValue).toBe('Ann')
  })

  it('skips push buttons, hidden, zero-size and off-page widgets and never throws on junk', () => {
    const fields = buildFormFields(
      [
        [
          null,
          'junk',
          { annotationType: 2, subtype: 'Link' },
          widget({ id: '1R', fieldName: 'go', fieldType: 'Btn', pushButton: true }),
          widget({ id: '2R', fieldName: 'h', fieldType: 'Tx', hidden: true }),
          widget({ id: '3R', fieldName: 'z', fieldType: 'Sig', rect: [0, 0, 0, 0] }),
          widget({ id: '4R', fieldName: 'off', fieldType: 'Tx', rect: [700, 900, 800, 920] }),
          widget({ id: '5R', fieldName: 'bad', fieldType: 'Tx', rect: [1, 2] }),
          widget({ id: '6R', fieldName: 'ok', fieldType: 'Tx', fieldValue: 'a\r\nb\rc' }),
        ],
      ],
      [PAGE],
    )
    expect(fields.map((f) => f.name)).toEqual(['ok'])
    expect(fields[0].defaultValue).toBe('a\nb\nc')
  })

  it('reads the default appearance text color for the screen', () => {
    const [f] = buildFormFields(
      [[widget({ id: '1R', fieldName: 'blue', fieldType: 'Tx', defaultAppearanceData: { fontSize: 9, fontColor: [0, 0, 255] } })]],
      [PAGE],
    )
    expect(f.fontSize).toBe(9)
    expect(getFieldExtras(f).textColor).toBe('#0000ff')
  })
})
