import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString, type PDFRef } from 'pdf-lib'
import type { FormField, FormValues, FormWidget, PageInfo } from '../../../model/types'
import { renderPdf } from '../../export/engine'
import { applyFormValues } from '../../export/forms'
import { encryptPdf } from '../../export/testing/fixtures'
import { makeInput, testDeps } from '../../export/testing/helpers'
import { openPdfjs, pdfjsDecrypt, pdfjsRepair, textInView } from '../../export/testing/pdfjs'
import { defaultFormValues, extractFormFields } from '../formFields'
import { pdfRectToViewRect } from '../geometry'
import { buildSampleForm, openWithPdfjs } from './testing'

/**
 * Encrypted and repaired files are rewritten by pdf.js before export, which renumbers every
 * object: the widget ids we extracted from the original name other objects there.
 */

const VALUES: FormValues = {
  'applicant.first_name': 'Ada',
  'applicant.last_name': 'Lovelace',
  zip: '12345',
  pin: 'abc',
  notes: 'Analytical engine',
  agree: false,
  newsletter: true,
  color: 'blue',
  country: 'France',
  city: 'London',
  langs: ['fr'],
  rotated: 'Turned',
}

async function sample(encrypt: boolean) {
  const plain = await buildSampleForm()
  const bytes = encrypt ? await encryptPdf(plain, { owner: 'owner-only' }) : plain
  const { pdf, raw, pages } = await openWithPdfjs(bytes)
  const fields = await extractFormFields(pdf, pages)
  await raw.loadingTask.destroy()
  return { bytes, fields, pages, values: { ...defaultFormValues(fields), ...VALUES } }
}

const nums = (a: PDFArray) => a.asArray().map((n) => (n as PDFNumber).asNumber())

/** The output's widget at the place of one of our widgets: its own /AS and its field's /V. */
function widgetAt(doc: PDFDocument, pages: PageInfo[], w: FormWidget) {
  for (const ref of doc.getPage(w.page).node.Annots()?.asArray() ?? []) {
    const dict = doc.context.lookup(ref, PDFDict)
    const r = pdfRectToViewRect(pages[w.page], nums(dict.lookup(PDFName.of('Rect'), PDFArray)))
    if (Math.max(Math.abs(r.x - w.rect.x), Math.abs(r.y - w.rect.y), Math.abs(r.width - w.rect.width)) > 0.5) continue
    const field = dict.has(PDFName.of('T')) ? dict : dict.lookup(PDFName.of('Parent'), PDFDict)
    const v = field.lookup(PDFName.of('V'))
    const text = (o: unknown) => (o && typeof o === 'object' && 'decodeText' in o ? (o as { decodeText(): string }).decodeText() : String(o))
    return { value: v instanceof PDFArray ? v.asArray().map(text) : text(v), state: String(dict.lookup(PDFName.of('AS'))) }
  }
  throw new Error(`no widget at ${JSON.stringify(w.rect)}`)
}

/** What the exported file holds at each field's place (names may differ in a rewritten file). */
async function readBack(out: Uint8Array, fields: FormField[], pages: PageInfo[]) {
  const doc = await PDFDocument.load(out)
  const at = (name: string, i = 0) => widgetAt(doc, pages, fields.find((f) => f.name === name)!.widgets[i])
  return {
    text: (name: string) => at(name).value,
    on: (name: string, i = 0) => at(name, i).state !== '/Off',
  }
}

function expectFilled(read: Awaited<ReturnType<typeof readBack>>) {
  expect(read.text('applicant.first_name')).toBe('Ada')
  expect(read.text('applicant.last_name')).toBe('Lovelace')
  expect(read.text('zip')).toBe('12345')
  expect(read.text('pin')).toBe('abc')
  expect(read.text('notes')).toBe('Analytical engine')
  expect(read.text('country')).toBe('France')
  expect(read.text('city')).toBe('London')
  expect(read.text('langs')).toBe('fr')
  expect(read.text('rotated')).toBe('Turned')
  expect(read.on('agree')).toBe(false)
  expect(read.on('newsletter')).toBe(true)
  expect([0, 1, 2].map((i) => read.on('color', i))).toEqual([false, false, true])
}

describe('form values in files pdf.js rewrote', () => {
  it('lands every value in its own field of an encrypted form (flatten off)', async () => {
    const { bytes, fields, pages, values } = await sample(true)
    const out = await renderPdf(makeInput(bytes, pages, [], { formFields: fields, formValues: values, options: { flattenForms: false } }), {
      ...testDeps,
      decrypt: pdfjsDecrypt(),
    })
    expectFilled(await readBack(out, fields, pages))
  })

  it('bakes every value into its own box of an encrypted form (flatten on)', async () => {
    const { bytes, fields, pages, values } = await sample(true)
    const out = await renderPdf(makeInput(bytes, pages, [], { formFields: fields, formValues: values, options: { flattenForms: true } }), {
      ...testDeps,
      decrypt: pdfjsDecrypt(),
    })
    expect((await PDFDocument.load(out)).getForm().getFields()).toHaveLength(0)
    const pdf = await openPdfjs(out)
    const items = [...(await textInView(pdf, 1)), ...(await textInView(pdf, 2)).map((t) => ({ ...t, page: 1 }))]
    await pdf.loadingTask.destroy()
    for (const [name, text] of [
      ['applicant.first_name', 'Ada'],
      ['applicant.last_name', 'Lovelace'],
      ['city', 'London'],
      ['country', 'France'],
      ['rotated', 'Turned'],
    ]) {
      const box = fields.find((f) => f.name === name)!.widgets[0]
      const item = items.find((t) => t.str === text && ('page' in t ? 1 : 0) === box.page)
      expect(item, text).toBeDefined()
      // The baseline starts inside the field's own box.
      expect(item!.x).toBeGreaterThanOrEqual(box.rect.x - 1)
      expect(item!.x).toBeLessThanOrEqual(box.rect.x + box.rect.width + 1)
      expect(item!.y).toBeGreaterThanOrEqual(box.rect.y - 1)
      expect(item!.y).toBeLessThanOrEqual(box.rect.y + box.rect.height + 1)
    }
  })

  it('lands every value in its own field of a repaired copy, and reports what it cannot place', async () => {
    const { bytes, fields, pages, values } = await sample(false)
    const copy = await pdfjsRepair()(bytes)
    const doc = await PDFDocument.load(copy.bytes)
    const ghost: FormField = { ...fields[0], name: 'ghost', widgets: [{ ...fields[0].widgets[0], id: '1R', rect: { x: 0, y: 0, width: 5, height: 5 } }] }
    const result = await applyFormValues(doc, [...fields, ghost], { ...values, ghost: 'lost' }, {
      flatten: false,
      getUnicodeFont: () => Promise.reject(new Error('unused')),
      pages,
      rewritten: true,
    })
    expect(result.unwritten).toEqual(['ghost'])
    expectFilled(await readBack(await doc.save(), fields, pages))
  })

  it('reports a radio choice it cannot find instead of turning the group off', async () => {
    const { bytes, fields, pages, values } = await sample(false)
    const doc = await PDFDocument.load((await pdfjsRepair()(bytes)).bytes)
    // No /Opt to fall back on, and the chosen button is not where we saw it.
    doc.getForm().getRadioGroup('color').acroField.dict.delete(PDFName.of('Opt'))
    const moved = fields.map((f) =>
      f.name === 'color' ? { ...f, widgets: f.widgets.map((w) => (w.exportValue === 'blue' ? { ...w, rect: { ...w.rect, x: w.rect.x + 300 } } : w)) } : f,
    )
    const result = await applyFormValues(doc, moved, values, {
      flatten: false,
      getUnicodeFont: () => Promise.reject(new Error('unused')),
      pages,
      rewritten: true,
    })
    expect(result.unwritten).toEqual(['color'])
    expect(String(doc.getForm().getRadioGroup('color').acroField.dict.get(PDFName.of('V')))).toBe('/1') // still "green"
  })

  it('trusts a widget id only when the field names agree', async () => {
    const { bytes, fields, pages } = await sample(false)
    // As if the ids came from a parse that numbered the objects differently.
    const first = fields.find((f) => f.name === 'applicant.first_name')!
    const last = fields.find((f) => f.name === 'applicant.last_name')!
    const swapped = fields.map((f) =>
      f === first ? { ...f, widgets: [{ ...f.widgets[0], id: last.widgets[0].id }] } : f === last ? { ...f, widgets: [{ ...f.widgets[0], id: first.widgets[0].id }] } : f,
    )
    const doc = await PDFDocument.load(bytes)
    const result = await applyFormValues(doc, swapped, { 'applicant.first_name': 'Ada', 'applicant.last_name': 'Lovelace' }, {
      flatten: false,
      getUnicodeFont: () => Promise.reject(new Error('unused')),
      pages,
      rewritten: false,
    })
    expect(result.unwritten).toEqual([])
    expect(doc.getForm().getTextField('applicant.first_name').getText()).toBe('Ada')
    expect(doc.getForm().getTextField('applicant.last_name').getText()).toBe('Lovelace')
  })
})

/**
 * pdf.js rebuilds the field tree from /Fields alone: a widget whose field it can't reach comes
 * out as a bare annotation, without its name, type, value or /Parent.
 */
describe('widgets the rewrite cut off from their fields', () => {
  /** An encrypted form whose field tree misses fields and a kid that pdf.js shows all the same. */
  async function cutOffForm(dropAcroForm = false) {
    const doc = await PDFDocument.create()
    const page = doc.addPage([612, 792])
    const form = doc.getForm()
    form.createTextField('listed').addToPage(page, { x: 50, y: 700, width: 200, height: 20 })
    const orphan = form.createTextField('group.orphan')
    orphan.enableMultiline()
    orphan.setMaxLength(40)
    orphan.addToPage(page, { x: 50, y: 650, width: 200, height: 40 })
    form.createTextField('group.sibling').addToPage(page, { x: 300, y: 650, width: 200, height: 20 })
    const pick = form.createRadioGroup('pick')
    pick.addOptionToPage('a', page, { x: 50, y: 600, width: 14, height: 14 })
    pick.addOptionToPage('b', page, { x: 100, y: 600, width: 14, height: 14 })
    pick.select('a')
    const agree = form.createCheckBox('agree')
    agree.addToPage(page, { x: 150, y: 600, width: 14, height: 14 })
    const size = form.createDropdown('size')
    size.addOptions(['S', 'M', 'L'])
    size.select('S')
    size.addToPage(page, { x: 300, y: 600, width: 100, height: 20 })
    const twice = form.createTextField('twice')
    twice.addToPage(page, { x: 50, y: 550, width: 200, height: 20 })
    twice.addToPage(page, { x: 300, y: 550, width: 200, height: 20 })
    // A field that is its own widget, missing from the list too: the rewrite keeps its entries.
    const merged = doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Widget',
        FT: 'Tx',
        T: PDFString.of('merged'),
        DA: PDFString.of('/Helv 0 Tf 0 g'),
        Rect: [50, 500, 250, 520],
        F: 4,
        P: page.ref,
      }),
    )
    page.node.addAnnot(merged)
    form.updateFieldAppearances()

    const list = form.acroForm.dict.lookup(PDFName.of('Fields'), PDFArray)
    for (const ref of [orphan.acroField.getParent()!.ref, pick.ref, agree.ref, size.ref]) list.remove(list.indexOf(ref)!)
    twice.acroField.Kids()!.remove(1)
    if (dropAcroForm) doc.catalog.delete(PDFName.of('AcroForm'))
    const bytes = await encryptPdf(await doc.save({ updateFieldAppearances: false }), { owner: 'owner-only' })

    const { pdf, raw, pages } = await openWithPdfjs(bytes)
    const fields = await extractFormFields(pdf, pages)
    await raw.loadingTask.destroy()
    return { bytes, fields, pages }
  }

  const FILLED: FormValues = {
    listed: 'Listed',
    'group.orphan': 'Cut off',
    'group.sibling': 'Sibling',
    pick: 'b',
    agree: true,
    size: 'L',
    twice: 'Both boxes',
    merged: 'Merged',
  }

  it.each([
    ['missing from the field list', false],
    ['in a file without an AcroForm', true],
  ])('writes the values of fields %s', async (_, dropAcroForm) => {
    const { bytes, fields, pages } = await cutOffForm(dropAcroForm)
    expect(fields.map((f) => [f.name, f.widgets.length])).toEqual([
      ['listed', 1],
      ['group.orphan', 1],
      ['group.sibling', 1],
      ['pick', 2],
      ['agree', 1],
      ['size', 1],
      ['twice', 2],
      ['merged', 1],
    ])
    const unwritten: string[][] = []
    const out = await renderPdf(
      makeInput(bytes, pages, [], { formFields: fields, formValues: { ...defaultFormValues(fields), ...FILLED }, options: { flattenForms: false } }),
      { ...testDeps, decrypt: pdfjsDecrypt(), onUnwrittenFields: (names) => unwritten.push(names) },
    )
    expect(unwritten).toEqual([])
    const { pdf, raw, pages: views } = await openWithPdfjs(out)
    const reread = await extractFormFields(pdf, views)
    await raw.loadingTask.destroy()
    expect(reread.map((f) => [f.name, f.widgets.length])).toEqual(fields.map((f) => [f.name, f.widgets.length]))
    expect(defaultFormValues(reread)).toEqual(FILLED)
    const saved = (await PDFDocument.load(out)).getForm()
    // Under one parent again, not two top-level fields with dots in their names.
    for (const name of ['group.orphan', 'group.sibling']) expect(saved.getTextField(name).acroField.getParent()?.getPartialName()).toBe('group')
    expect(saved.getTextField('group.orphan').isMultiline()).toBe(true)
    expect(saved.getTextField('group.orphan').getMaxLength()).toBe(40)
    expect(saved.getRadioGroup('pick').getOptions()).toEqual(['a', 'b'])
    expect(saved.getDropdown('size').getOptions()).toEqual(['S', 'M', 'L'])
  })

  it('bakes their values into their own boxes when flattening', async () => {
    const { bytes, fields, pages } = await cutOffForm()
    const unwritten: string[][] = []
    const out = await renderPdf(
      makeInput(bytes, pages, [], { formFields: fields, formValues: { ...defaultFormValues(fields), ...FILLED }, options: { flattenForms: true } }),
      { ...testDeps, decrypt: pdfjsDecrypt(), onUnwrittenFields: (names) => unwritten.push(names) },
    )
    expect(unwritten).toEqual([])
    const doc = await PDFDocument.load(out)
    expect(doc.getForm().getFields()).toHaveLength(0)
    expect(doc.getPage(0).node.Annots()?.size() ?? 0).toBe(0)
    const pdf = await openPdfjs(out)
    const items = await textInView(pdf, 1)
    await pdf.loadingTask.destroy()
    for (const [name, text, widget = 0] of [
      ['group.orphan', 'Cut off'],
      ['size', 'L'],
      ['twice', 'Both boxes', 0],
      ['twice', 'Both boxes', 1],
      ['merged', 'Merged'],
    ] as const) {
      const box = fields.find((f) => f.name === name)!.widgets[widget].rect
      const inBox = items.filter((t) => t.str === text && t.x >= box.x - 1 && t.x <= box.x + box.width && t.y >= box.y && t.y <= box.y + box.height + 1)
      expect(inBox, `${name} #${widget}`).toHaveLength(1)
    }
  })

  it.each([
    ['as opened', false],
    ['after a rewrite', true],
  ])('gives a field that is its own widget a second widget %s', async (_, encrypt) => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([612, 792])
    const js = (code: string) => doc.context.obj({ S: 'JavaScript', JS: PDFString.of(code) })
    // The second widget names the field as its /Parent, but the field has no /Kids to list it in.
    const merged = doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Widget',
        FT: 'Tx',
        T: PDFString.of('x'),
        TU: PDFString.of('Your name'),
        V: PDFString.of('Old'),
        DA: PDFString.of('/Helv 12 Tf 0 g'),
        Rect: [50, 700, 250, 720],
        F: 4,
        P: page.ref,
        AA: { K: js('keystroke'), Fo: js('focus') },
      }),
    )
    const second = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Widget', Parent: merged, Rect: [300, 700, 500, 720], F: 4, P: page.ref }))
    page.node.addAnnot(merged)
    page.node.addAnnot(second)
    doc.getForm().acroForm.addField(merged)
    const plain = await doc.save()
    const bytes = encrypt ? await encryptPdf(plain, { owner: 'owner-only' }) : plain
    const opened = await openWithPdfjs(bytes)
    const fields = await extractFormFields(opened.pdf, opened.pages)
    await opened.raw.loadingTask.destroy()
    const { pages } = opened
    expect(fields.map((f) => [f.name, f.widgets.length, f.defaultValue, f.label])).toEqual([['x', 2, 'Old', 'Your name']])
    const deps = { ...testDeps, decrypt: pdfjsDecrypt() }
    const input = (flattenForms: boolean) => makeInput(bytes, pages, [], { formFields: fields, formValues: { x: 'Both' }, options: { flattenForms } })

    const live = await renderPdf(input(false), deps)
    const reopened = await openWithPdfjs(live)
    const reread = await extractFormFields(reopened.pdf, reopened.pages)
    await reopened.raw.loadingTask.destroy()
    // The label too: pdf.js reads it from the widget.
    expect(reread.map((f) => [f.name, f.widgets.length, f.defaultValue, f.label])).toEqual([['x', 2, 'Both', 'Your name']])
    const field = (await PDFDocument.load(live)).getForm().getTextField('x')
    const widgets = field.acroField.getWidgets()
    expect(widgets).toHaveLength(2)
    // The field keeps its own actions, its first widget the widget's.
    expect(field.acroField.dict.lookup(PDFName.of('AA'), PDFDict).keys().map(String)).toEqual(['/K'])
    expect(widgets[0].dict.lookup(PDFName.of('AA'), PDFDict).keys().map(String)).toEqual(['/Fo'])
    // Acrobat reads the label from the field.
    expect(field.acroField.dict.lookup(PDFName.of('TU'), PDFString, PDFHexString).decodeText()).toBe('Your name')

    const flat = await renderPdf(input(true), deps)
    expect((await PDFDocument.load(flat)).getPage(0).node.Annots()?.size() ?? 0).toBe(0)
    const pdf = await openPdfjs(flat)
    expect((await textInView(pdf, 1)).filter((t) => t.str === 'Both')).toHaveLength(2)
    await pdf.loadingTask.destroy()
  })

  it('keeps the full names of fields whose parents the rewrite cut off', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([612, 792])
    const form = doc.getForm()
    const { context } = doc
    const kidsOf = (ref: PDFRef) => context.lookup(ref, PDFDict).lookup(PDFName.of('Kids'), PDFArray)
    /** A text field named "name" under `parent` that is its own widget. */
    const name = (parent: PDFRef, y: number) => {
      const ref = context.register(
        context.obj({
          Type: 'Annot',
          Subtype: 'Widget',
          FT: 'Tx',
          T: PDFString.of('name'),
          Parent: parent,
          DA: PDFString.of('/Helv 0 Tf 0 g'),
          Rect: [50, y, 250, y + 20],
          F: 4,
          P: page.ref,
        }),
      )
      kidsOf(parent).push(ref)
      page.node.addAnnot(ref)
      return ref
    }
    const other = form.createTextField('p1.other')
    other.addToPage(page, { x: 300, y: 700, width: 200, height: 20 })
    const c = form.createTextField('a.b.c')
    c.addToPage(page, { x: 300, y: 550, width: 200, height: 20 })
    const list = form.acroForm.dict.lookup(PDFName.of('Fields'), PDFArray)
    // Parents missing from the field list: p1, p2, p3, and a (whose kid b is listed instead).
    const p1 = other.acroField.getParent()!.ref
    list.remove(list.indexOf(p1)!)
    name(p1, 700)
    name(context.register(context.obj({ T: PDFString.of('p2'), Kids: [] })), 650)
    // A second widget names p3's kid as its /Parent, but the kid has no /Kids to list it in.
    const kid = name(context.register(context.obj({ T: PDFString.of('p3'), Kids: [] })), 600)
    page.node.addAnnot(context.register(context.obj({ Type: 'Annot', Subtype: 'Widget', Parent: kid, Rect: [300, 600, 500, 620], F: 4, P: page.ref })))
    const b = c.acroField.getParent()!
    name(b.ref, 550)
    list.set(list.indexOf(b.getParent()!.ref)!, b.ref)
    form.updateFieldAppearances()
    const bytes = await encryptPdf(await doc.save({ updateFieldAppearances: false }), { owner: 'owner-only' })

    const read = async (file: Uint8Array) => {
      const opened = await openWithPdfjs(file)
      const fields = await extractFormFields(opened.pdf, opened.pages)
      await opened.raw.loadingTask.destroy()
      return { fields, pages: opened.pages }
    }
    const { fields, pages } = await read(bytes)
    expect(fields.map((f) => [f.name, f.widgets.length])).toEqual([
      ['p1.name', 1],
      ['p1.other', 1],
      ['p2.name', 1],
      ['p3.name', 2],
      ['a.b.name', 1],
      ['a.b.c', 1],
    ])
    const filled: FormValues = { 'p1.name': 'First', 'p1.other': 'Other', 'p2.name': 'Second', 'p3.name': 'Third', 'a.b.name': 'Fourth', 'a.b.c': 'Fifth' }
    const unwritten: string[][] = []
    const out = await renderPdf(makeInput(bytes, pages, [], { formFields: fields, formValues: filled, options: { flattenForms: false } }), {
      ...testDeps,
      decrypt: pdfjsDecrypt(),
      onUnwrittenFields: (names) => unwritten.push(names),
    })
    expect(unwritten).toEqual([])
    const reopened = await read(out)
    expect(reopened.fields.map((f) => [f.name, f.widgets.length])).toEqual(fields.map((f) => [f.name, f.widgets.length]))
    expect(defaultFormValues(reopened.fields)).toEqual(filled)
    const saved = (await PDFDocument.load(out)).getForm()
    expect(saved.getTextField('p1.name').acroField.getParent()?.ref).toBe(saved.getTextField('p1.other').acroField.getParent()?.ref)

    // Saved again as it is, every "name" keeps its own value.
    const again = await renderPdf(
      makeInput(out, reopened.pages, [], { formFields: reopened.fields, formValues: defaultFormValues(reopened.fields), options: { flattenForms: false } }),
      testDeps,
    )
    expect(defaultFormValues((await read(again)).fields)).toEqual(filled)
  })

  it('keeps the names of copies of a field whose parent the rewrite cut off', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([612, 792])
    const { context } = doc
    const js = (code: string) => context.obj({ S: 'JavaScript', JS: PDFString.of(code) })
    doc.getForm().createTextField('listed').addToPage(page, { x: 50, y: 700, width: 200, height: 20 })
    // Acrobat's copies of a field: the parent, missing from the field list, holds the field type;
    // each copy is a field of its own merged with its widget, with only its name, value and label.
    const parent = context.register(context.obj({ FT: 'Tx', T: PDFString.of('Text1'), DA: PDFString.of('/Helv 0 Tf 0 g'), Kids: [] }))
    const copies = ['First copy', 'Second copy'].map((label, i) => {
      const copy = context.register(
        context.obj({
          Type: 'Annot',
          Subtype: 'Widget',
          T: PDFString.of(String(i)),
          TU: PDFString.of(label),
          V: PDFString.of(`Old ${i}`),
          DV: PDFString.of(`Default ${i}`),
          Parent: parent,
          Rect: [50, 650 - i * 50, 250, 670 - i * 50],
          F: 4,
          P: page.ref,
          AA: { K: js(`keystroke ${i}`), Fo: js(`focus ${i}`), ...(i ? { C: js('calculate') } : {}) },
        }),
      )
      context.lookup(parent, PDFDict).lookup(PDFName.of('Kids'), PDFArray).push(copy)
      page.node.addAnnot(copy)
      return copy
    })
    doc.getForm().acroForm.dict.set(PDFName.of('CO'), context.obj([copies[1]]))
    const bytes = await encryptPdf(await doc.save(), { owner: 'owner-only' })

    const read = async (file: Uint8Array) => {
      const opened = await openWithPdfjs(file)
      const fields = await extractFormFields(opened.pdf, opened.pages)
      await opened.raw.loadingTask.destroy()
      return { fields, pages: opened.pages }
    }
    const { fields, pages } = await read(bytes)
    expect(fields.map((f) => [f.name, f.widgets.length, f.defaultValue, f.label])).toEqual([
      ['listed', 1, '', undefined],
      ['Text1.0', 1, 'Old 0', 'First copy'],
      ['Text1.1', 1, 'Old 1', 'Second copy'],
    ])
    const filled: FormValues = { listed: 'Listed', 'Text1.0': 'Zero', 'Text1.1': 'One' }
    const unwritten: string[][] = []
    const out = await renderPdf(makeInput(bytes, pages, [], { formFields: fields, formValues: filled, options: { flattenForms: false } }), {
      ...testDeps,
      decrypt: pdfjsDecrypt(),
      onUnwrittenFields: (names) => unwritten.push(names),
    })
    expect(unwritten).toEqual([])
    const reopened = await read(out)
    expect(reopened.fields.map((f) => [f.name, f.widgets.length, f.label])).toEqual(fields.map((f) => [f.name, f.widgets.length, f.label]))
    expect(defaultFormValues(reopened.fields)).toEqual(filled)
    const saved = (await PDFDocument.load(out)).getForm()
    expect(saved.getFields().map((f) => f.getName())).toEqual(['listed', 'Text1.0', 'Text1.1'])
    // A copy's own actions: the field's on the field, the widget's on its widget.
    const actions = (dict: PDFDict) => dict.lookup(PDFName.of('AA'), PDFDict).keys().map(String)
    for (const [i, own] of [['/K'], ['/K', '/C']].entries()) {
      const copy = saved.getTextField(`Text1.${i}`).acroField
      expect(actions(copy.dict)).toEqual(own)
      expect(actions(copy.getWidgets()[0].dict)).toEqual(['/Fo'])
    }
    // The calculation order lists the field, not its widget.
    expect(saved.acroForm.dict.lookup(PDFName.of('CO'), PDFArray).asArray()).toEqual([saved.getTextField('Text1.1').ref])

    // Saved again as it is, every copy keeps its own value.
    const again = await renderPdf(
      makeInput(out, reopened.pages, [], { formFields: reopened.fields, formValues: defaultFormValues(reopened.fields), options: { flattenForms: false } }),
      testDeps,
    )
    expect(defaultFormValues((await read(again)).fields)).toEqual(filled)

    // Flattened, every value is drawn in its own box.
    const flat = await renderPdf(makeInput(bytes, pages, [], { formFields: fields, formValues: filled, options: { flattenForms: true } }), {
      ...testDeps,
      decrypt: pdfjsDecrypt(),
    })
    expect((await PDFDocument.load(flat)).getPage(0).node.Annots()?.size() ?? 0).toBe(0)
    const pdf = await openPdfjs(flat)
    const items = await textInView(pdf, 1)
    await pdf.loadingTask.destroy()
    for (const [name, text] of Object.entries(filled)) {
      const box = fields.find((f) => f.name === name)!.widgets[0].rect
      const inBox = items.filter((t) => t.str === text && t.x >= box.x - 1 && t.x <= box.x + box.width && t.y >= box.y && t.y <= box.y + box.height + 1)
      expect(inBox, name).toHaveLength(1)
    }
  })

  it('links copies of fields the rewrite cut off from their parent into the fields of their names', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([612, 792])
    const { context } = doc
    const list = doc.getForm().acroForm.dict.lookup(PDFName.of('Fields'), PDFArray)
    /** A copy of the field `parent`: a field of its own merged with its widget, whose type `parent` holds. */
    const copy = (parent: PDFRef, name: string, rect: number[], entries: Record<string, unknown>) => {
      const ref = context.register(context.obj({ Type: 'Annot', Subtype: 'Widget', T: PDFString.of(name), Parent: parent, Rect: rect, F: 4, P: page.ref, ...entries }))
      context.lookup(parent, PDFDict).lookup(PDFName.of('Kids'), PDFArray).push(ref)
      page.node.addAnnot(ref)
    }
    // A form merged twice: two parents "Text1" with a copy "0" each, only one of them in the field list.
    for (const [y, listed] of [
      [650, true],
      [600, false],
    ] as const) {
      const parent = context.register(context.obj({ FT: 'Tx', T: PDFString.of('Text1'), DA: PDFString.of('/Helv 0 Tf 0 g'), Kids: [] }))
      copy(parent, '0', [50, y, 250, y + 20], { TU: PDFString.of('Copy'), V: PDFString.of('Old') })
      if (listed) list.push(parent)
    }
    // Copies of a check box, whose parent is missing from the field list.
    const box = context.register(context.obj({ FT: 'Btn', T: PDFString.of('Check1'), Kids: [] }))
    const look = (ops: string) => context.register(context.stream(ops, { BBox: [0, 0, 14, 14] }))
    for (const [i, on] of [true, false].entries()) {
      const state = on ? 'Yes' : 'Off'
      copy(box, String(i), [50 + i * 30, 550, 64 + i * 30, 564], { V: state, AS: state, AP: { N: { Yes: look('0 g 2 2 10 10 re f'), Off: look('') } } })
    }
    const bytes = await encryptPdf(await doc.save(), { owner: 'owner-only' })

    const read = async (file: Uint8Array) => {
      const opened = await openWithPdfjs(file)
      const fields = await extractFormFields(opened.pdf, opened.pages)
      await opened.raw.loadingTask.destroy()
      return { fields, pages: opened.pages }
    }
    const { fields, pages } = await read(bytes)
    expect(fields.map((f) => [f.name, f.type, f.widgets.length, f.defaultValue])).toEqual([
      ['Text1.0', 'text', 2, 'Old'],
      ['Check1.0', 'checkbox', 1, true],
      ['Check1.1', 'checkbox', 1, false],
    ])
    const filled: FormValues = { 'Text1.0': 'New', 'Check1.0': false, 'Check1.1': true }
    const unwritten: string[][] = []
    const out = await renderPdf(makeInput(bytes, pages, [], { formFields: fields, formValues: filled, options: { flattenForms: false } }), {
      ...testDeps,
      decrypt: pdfjsDecrypt(),
      onUnwrittenFields: (names) => unwritten.push(names),
    })
    expect(unwritten).toEqual([])
    const reopened = await read(out)
    expect(reopened.fields.map((f) => [f.name, f.type, f.widgets.length, f.label])).toEqual(fields.map((f) => [f.name, f.type, f.widgets.length, f.label]))
    expect(defaultFormValues(reopened.fields)).toEqual(filled)
    // The copy joined the field of its name, not a field of its own under it.
    const saved = (await PDFDocument.load(out)).getForm()
    expect(saved.getFields().map((f) => [f.getName(), f.acroField.getWidgets().length])).toEqual([
      ['Text1.0', 2],
      ['Check1.0', 1],
      ['Check1.1', 1],
    ])

    const again = await renderPdf(
      makeInput(out, reopened.pages, [], { formFields: reopened.fields, formValues: defaultFormValues(reopened.fields), options: { flattenForms: false } }),
      testDeps,
    )
    expect(defaultFormValues((await read(again)).fields)).toEqual(filled)
  })
})
