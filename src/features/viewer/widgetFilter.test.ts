import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createAnnotationSkipFilter, formLayerWidgetIds, isFormLayerWidget, type OperatorListLike } from './widgetFilter'

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href

/** One page with every widget kind (filled in) plus a plain, non-widget Square annotation. */
async function makeForm() {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([600, 800])
  page.drawText('Static page content', { x: 40, y: 760, size: 14, font })
  const form = doc.getForm()

  const cb = form.createCheckBox('agree')
  cb.addToPage(page, { x: 40, y: 700, width: 18, height: 18 })
  cb.check()

  const radio = form.createRadioGroup('color')
  radio.addOptionToPage('red', page, { x: 40, y: 660, width: 16, height: 16 })
  radio.addOptionToPage('blue', page, { x: 80, y: 660, width: 16, height: 16 })
  radio.select('blue')

  const name = form.createTextField('name')
  name.setText('Ada Lovelace')
  name.addToPage(page, { x: 40, y: 600, width: 200, height: 24 })

  const locked = form.createTextField('locked')
  locked.setText('Read only value')
  locked.addToPage(page, { x: 40, y: 560, width: 200, height: 24 })
  locked.enableReadOnly()

  const pick = form.createDropdown('pick')
  pick.addOptions(['One', 'Two'])
  pick.select('Two')
  pick.addToPage(page, { x: 40, y: 520, width: 200, height: 24 })

  const button = form.createButton('print')
  button.addToPage('Print', page, { x: 40, y: 470, width: 100, height: 28 })

  const square = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Square',
    Rect: [300, 300, 420, 400],
    C: [1, 0, 0],
    Border: [0, 0, 3],
    F: 4,
  })
  page.node.addAnnot(doc.context.register(square))
  // Sanity: the annotation array now holds all widgets + the square.
  expect(page.node.lookup(PDFName.of('Annots'))).toBeTruthy()
  return doc.save()
}

interface AnnotationData {
  id: string
  subtype: string
  annotationType: number
  fieldName?: string
  fieldType?: string
  pushButton?: boolean
  checkBox?: boolean
  radioButton?: boolean
}

function drawnAnnotationIds(list: OperatorListLike, filter?: ReturnType<typeof createAnnotationSkipFilter>): string[] {
  const ids: string[] = []
  for (let i = 0; i < list.fnArray.length; i++) {
    const keep = filter ? filter(i, list) : true
    if (keep && list.fnArray[i] === pdfjs.OPS.beginAnnotation) ids.push((list.argsArray[i] as unknown[])[0] as string)
  }
  return ids
}

describe('widget filter', () => {
  it('classifies annotations', () => {
    expect(isFormLayerWidget({ annotationType: 20, fieldType: 'Tx' })).toBe(true)
    expect(isFormLayerWidget({ annotationType: 20, fieldType: 'Btn' })).toBe(true)
    expect(isFormLayerWidget({ annotationType: 20, fieldType: 'Btn', pushButton: true })).toBe(false)
    expect(isFormLayerWidget({ annotationType: 20, fieldType: 'Sig' })).toBe(false)
    expect(isFormLayerWidget({ annotationType: 5 })).toBe(false)
  })

  it('returns no filter when there is nothing to skip', () => {
    expect(createAnnotationSkipFilter(new Set(), pdfjs.OPS)).toBeUndefined()
  })

  it('keeps form widgets out of an ENABLE_FORMS bitmap while other annotations still render', async () => {
    const bytes = await makeForm()
    const pdf = await pdfjs.getDocument({ data: bytes }).promise
    const page = await pdf.getPage(1)
    const annotations = (await page.getAnnotations()) as AnnotationData[]
    const byField = (name: string) => annotations.filter((a) => a.fieldName === name).map((a) => a.id)
    const squareId = annotations.find((a) => a.subtype === 'Square')!.id
    const [checkbox] = byField('agree')
    const radios = byField('color')
    const [readOnlyText] = byField('locked')
    const [pushButton] = byField('print')
    expect(radios).toHaveLength(2)

    const list = await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS })

    // Without our filter pdf.js still paints check boxes (on+off appearances), radios and read-only fields.
    const unfiltered = drawnAnnotationIds(list)
    expect(unfiltered).toContain(checkbox)
    expect(unfiltered).toContain(radios[1])
    expect(unfiltered).toContain(readOnlyText)
    // Editable text fields and dropdowns are already left out by ENABLE_FORMS.
    expect(unfiltered).not.toContain(byField('name')[0])
    expect(unfiltered).not.toContain(byField('pick')[0])

    const skip = formLayerWidgetIds(annotations)
    const drawn = drawnAnnotationIds(list, createAnnotationSkipFilter(skip, pdfjs.OPS))
    expect(drawn).not.toContain(checkbox)
    for (const r of radios) expect(drawn).not.toContain(r)
    expect(drawn).not.toContain(readOnlyText)
    // Non-widget annotations and push buttons are still part of the page.
    expect(drawn).toContain(squareId)
    expect(drawn).toContain(pushButton)

    // The page content itself (outside any annotation) is untouched by the filter.
    const filter = createAnnotationSkipFilter(skip, pdfjs.OPS)!
    const firstAnnotationOp = Array.from(list.fnArray).indexOf(pdfjs.OPS.beginAnnotation)
    expect(firstAnnotationOp).toBeGreaterThan(0)
    for (let i = 0; i < firstAnnotationOp; i++) expect(filter(i, list)).toBe(true)

    await pdf.loadingTask.destroy()
  })
})
