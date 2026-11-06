/**
 * Test-only helpers: pdf.js (legacy build, in-process worker) and pdf-lib form fixtures.
 * Imported by *.test.ts files only — never by app code.
 */
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  TextAlignment,
  decodePDFRawStream,
  degrees,
  type PDFRawStream,
  type PDFRef,
} from 'pdf-lib'
import arimoDataUrl from '../../../assets/fonts/Arimo-Regular.ttf?inline'
import type { PageInfo, PageRotation } from '../../../model/types'
import type { PDFDocumentProxy } from '../pdfjs'

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href

export const arimoBytes = Uint8Array.from(atob(arimoDataUrl.slice(arimoDataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0))

export async function openWithPdfjs(bytes: Uint8Array) {
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise
  const pages: PageInfo[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 1 })
    const [x0, y0, x1, y1] = page.view
    pages.push({
      index: i - 1,
      width: viewport.width,
      height: viewport.height,
      rotation: (((page.rotate % 360) + 360) % 360) as PageRotation,
      view: [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)],
      userUnit: page.userUnit || 1,
    })
  }
  return { pdf: pdf as unknown as PDFDocumentProxy, raw: pdf, pages }
}

/** Widget annotations of every page, as pdf.js reports them. */
export async function widgetAnnotations(pdf: Awaited<ReturnType<typeof openWithPdfjs>>['raw']) {
  const out: Record<string, unknown>[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    for (const a of await page.getAnnotations()) if (a.subtype === 'Widget') out.push({ ...a, pageIndex: i - 1 })
  }
  return out
}

/** Text of a page as pdf.js extracts it (items joined in content order). */
export async function pageText(pdf: Awaited<ReturnType<typeof openWithPdfjs>>['raw'], pageNumber: number) {
  const page = await pdf.getPage(pageNumber)
  const content = await page.getTextContent()
  return content.items.map((i) => ('str' in i ? i.str : '')).join(' ')
}

/**
 * Renders a page the way PDF viewers show it: every annotation, form fields included, painted
 * with its own appearance over the page (pdf.js AnnotationMode.ENABLE), on white. `inkIn` gives
 * the fraction of dark pixels in a rect given in view space.
 */
export async function renderAsViewers(bytes: Uint8Array, pageNumber = 1, scale = 2) {
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise
  try {
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale })
    const width = Math.ceil(viewport.width)
    const height = Math.ceil(viewport.height)
    const factory = (pdf as unknown as { canvasFactory: { create(w: number, h: number): { canvas: unknown; context: CanvasRenderingContext2D } } })
      .canvasFactory
    const { canvas, context } = factory.create(width, height)
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    await page.render({ canvas: canvas as HTMLCanvasElement, canvasContext: context, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise
    const { data } = context.getImageData(0, 0, width, height)
    return {
      inkIn(x: number, y: number, w: number, h: number): number {
        let dark = 0
        let total = 0
        for (let py = Math.floor(y * scale); py < Math.ceil((y + h) * scale) && py < height; py++) {
          for (let px = Math.floor(x * scale); px < Math.ceil((x + w) * scale) && px < width; px++) {
            const i = (py * width + px) * 4
            if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 128) dark++
            total++
          }
        }
        return total ? dark / total : 0
      },
    }
  } finally {
    await pdf.loadingTask.destroy()
  }
}

/** Decoded content of a widget's normal appearance stream. */
export function appearanceContent(doc: PDFDocument, fieldName: string, widgetIndex = 0): string {
  const field = doc.getForm().getField(fieldName)
  const widget = field.acroField.getWidgets()[widgetIndex]
  const ref = widget.getNormalAppearance() as PDFRef
  const stream = doc.context.lookup(ref) as PDFRawStream
  return Array.from(decodePDFRawStream(stream).decode(), (b) => String.fromCharCode(b)).join('')
}

/** Decoded content of a page: its content streams, in order. */
export function pageContent(doc: PDFDocument, pageIndex = 0): string {
  const contents = doc.getPage(pageIndex).node.Contents()
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents]
  return streams.map((stream) => Array.from(decodePDFRawStream(stream as PDFRawStream).decode(), (b) => String.fromCharCode(b)).join('')).join('\n')
}

/** Hex strings shown with Tj in a content stream, in order. */
export function shownHexStrings(content: string): string[] {
  return [...content.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)].map((m) => m[1])
}

/**
 * A form exercising every field kind. Page 1 is upright, page 2 has /Rotate 90.
 * Layout (PDF points, y up): see the coordinates below; reading order is the declaration order.
 */
export async function buildSampleForm(opts: { needAppearances?: boolean } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const p1 = doc.addPage([612, 792])
  const p2 = doc.addPage([612, 792])
  p2.setRotation(degrees(90))
  const form = doc.getForm()

  const first = form.createTextField('applicant.first_name')
  first.setText('John')
  first.enableRequired()
  first.addToPage(p1, { x: 50, y: 700, width: 200, height: 20 })
  // pdf.js reads /TU from the widget dictionary (as in merged field/widget dicts).
  first.acroField.getWidgets()[0].dict.set(PDFName.of('TU'), PDFHexString.fromText('Given name'))

  const last = form.createTextField('applicant.last_name')
  last.enableRequired()
  last.addToPage(p1, { x: 300, y: 700, width: 200, height: 20 })

  const zip = form.createTextField('zip')
  zip.setMaxLength(5)
  zip.enableCombing()
  zip.addToPage(p1, { x: 50, y: 650, width: 100, height: 20 })

  const pin = form.createTextField('pin')
  pin.enablePassword()
  pin.addToPage(p1, { x: 300, y: 650, width: 100, height: 20 })

  const notes = form.createTextField('notes')
  notes.enableMultiline()
  notes.setAlignment(TextAlignment.Center)
  notes.addToPage(p1, { x: 50, y: 560, width: 300, height: 60 })

  const agree = form.createCheckBox('agree')
  agree.addToPage(p1, { x: 50, y: 520, width: 14, height: 14 })
  agree.check()

  const news = form.createCheckBox('newsletter')
  news.addToPage(p1, { x: 150, y: 520, width: 14, height: 14 })

  const color = form.createRadioGroup('color')
  color.addOptionToPage('red', p1, { x: 50, y: 480, width: 14, height: 14 })
  color.addOptionToPage('green', p1, { x: 100, y: 480, width: 14, height: 14 })
  color.addOptionToPage('blue', p1, { x: 150, y: 480, width: 14, height: 14 })
  color.select('green')

  const country = form.createDropdown('country')
  country.addOptions(['Israel', 'USA', 'France'])
  country.select('USA')
  country.addToPage(p1, { x: 50, y: 440, width: 150, height: 20 })

  const city = form.createDropdown('city')
  city.addOptions(['Tel Aviv', 'Haifa'])
  city.enableEditing()
  city.addToPage(p1, { x: 250, y: 440, width: 150, height: 20 })

  const langs = form.createOptionList('langs')
  langs.addOptions(['en', 'he', 'fr'])
  langs.enableMultiselect()
  langs.select(['en', 'he'])
  langs.addToPage(p1, { x: 50, y: 340, width: 150, height: 70 })

  const ro = form.createTextField('readonly_id')
  ro.setText('A-123')
  ro.enableReadOnly()
  ro.addToPage(p1, { x: 50, y: 300, width: 150, height: 20 })

  const hidden = form.createTextField('hidden_field')
  hidden.setText('secret')
  hidden.addToPage(p1, { x: 400, y: 300, width: 100, height: 20, hidden: true })

  // pdf-lib can't create signature fields; build an unsigned /FT /Sig widget by hand.
  const sig = doc.context.register(
    doc.context.obj({
      Type: 'Annot',
      Subtype: 'Widget',
      FT: 'Sig',
      T: PDFString.of('sig'),
      Rect: [50, 200, 250, 240],
      F: 4,
      P: p1.ref,
    }),
  )
  p1.node.addAnnot(sig)
  form.acroForm.addField(sig)

  const rotated = form.createTextField('rotated')
  rotated.setText('rot')
  rotated.addToPage(p2, { x: 100, y: 100, width: 200, height: 20 })

  // pdf-lib bakes its own auto font size into /DA; real forms mostly say 0 (auto).
  form.updateFieldAppearances()
  notes.acroField.setDefaultAppearance('0 g /Helv 0 Tf')
  langs.acroField.setDefaultAppearance('0 g /Helv 0 Tf')

  if (opts.needAppearances) form.acroForm.dict.set(PDFName.of('NeedAppearances'), doc.context.obj(true))
  return doc.save({ updateFieldAppearances: false })
}

/** Field names of the sample form in reading order (hidden_field is skipped). */
export const SAMPLE_ORDER = [
  'applicant.first_name',
  'applicant.last_name',
  'zip',
  'pin',
  'notes',
  'agree',
  'newsletter',
  'color',
  'country',
  'city',
  'langs',
  'readonly_id',
  'sig',
  'rotated',
]
