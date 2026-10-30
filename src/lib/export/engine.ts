import fontkit from '@pdf-lib/fontkit'
import {
  PDFDict,
  PDFDocument,
  PDFName,
  ParseSpeeds,
  concatTransformationMatrix,
  popGraphicsState,
  pushGraphicsState,
  type PDFOperator,
} from 'pdf-lib'
import type { Element, PageInfo } from '../../model/types'
import { exportMatrix } from '../pdf/geometry'
import { measureTextCanvas } from '../text/layout'
import { protectOriginalContent } from './contentBalance'
import { DocFonts } from './docFonts'
import type { DrawContext } from './drawContext'
import { imageOperators, inkOperators, markOperators, shapeOperators } from './drawShapes'
import { textOperators } from './drawText'
import { ExportError, throwIfAborted, toExportError } from './errors'
import { applyFormValues } from './forms'
import { DocImages } from './images'
import { r } from './num'
import { DocGraphicsStates, PageResources } from './pageResources'
import type { ExportDeps, ExportInput, RecoveredInfo } from './types'

/**
 * The export pipeline (pure: everything environment-specific comes in through `deps`).
 *
 *  1. Load the original with pdf-lib (decrypting / repairing through pdf.js when needed).
 *  2. Make sure original page content can't leak graphics state into what we append.
 *  3. Write form values (forms engine), optionally flattening.
 *  4. Draw each page's elements in paint order inside `q <exportMatrix> cm … Q`.
 *  5. Embed font subsets, stamp the producer, save.
 */
export async function renderPdf(input: ExportInput, deps: ExportDeps): Promise<Uint8Array> {
  try {
    return await run(input, deps)
  } catch (err) {
    throw toExportError(err)
  }
}

async function run(input: ExportInput, deps: ExportDeps): Promise<Uint8Array> {
  const { signal } = deps
  const progress = deps.onProgress ?? (() => {})
  const pause = deps.yieldToUI ?? yieldToUI

  progress({ phase: 'prepare', done: 0, total: 0 })
  const { doc, info: recovered } = await openForWriting(input, deps)
  doc.registerFontkit(fontkit)
  throwIfAborted(signal)

  const byPage = groupByPage(input.elements, input.pages)
  const flatten = input.options.flattenForms
  const hasFields = input.formFields.length > 0

  // Protect original content on every page we are about to draw on (incl. flattened widgets).
  const touched = new Set(byPage.keys())
  if (hasFields && flatten) for (const f of input.formFields) for (const w of f.widgets) touched.add(w.page)
  const pages = doc.getPages()
  for (const index of touched) if (pages[index]) protectOriginalContent(doc, pages[index])

  const fonts = new DocFonts(doc, deps.loadFontBytes, flatten)

  if (hasFields) {
    progress({ phase: 'forms', done: 0, total: 0 })
    try {
      await applyFormValues(doc, input.formFields, input.formValues, { flatten, getUnicodeFont: fonts.getUnicodeFont })
    } catch (err) {
      if (err instanceof ExportError) throw err
      throw new ExportError('forms', undefined, { cause: err })
    }
    throwIfAborted(signal)
  }

  const images = new DocImages(doc, deps.convertImage)
  const states = new DocGraphicsStates(doc)
  const measure = deps.measure ?? measureTextCanvas
  const total = byPage.size
  let done = 0
  for (const [index, elements] of byPage) {
    progress({ phase: 'pages', done, total })
    const page = pages[index]
    const info = input.pages[index]
    const ctx: DrawContext = {
      doc,
      pageHeight: info.height,
      res: new PageResources(page, states),
      fonts,
      images,
      assets: input.assets,
      measure,
      rasterizeText: deps.rasterizeText,
    }
    const ops: PDFOperator[] = [pushGraphicsState(), concatTransformationMatrix(...(exportMatrix(info).map(r) as Matrix6))]
    for (const el of elements) ops.push(...(await elementOperators(el, ctx)))
    ops.push(popGraphicsState())
    page.pushOperators(...ops)
    done++
    throwIfAborted(signal)
    await pause()
  }
  progress({ phase: 'save', done: total, total })

  await fonts.finalize()
  applyMetadata(doc, recovered)
  throwIfAborted(signal)
  return save(doc)
}

type Matrix6 = [number, number, number, number, number, number]

function elementOperators(el: Element, ctx: DrawContext): Promise<PDFOperator[]> | PDFOperator[] {
  switch (el.kind) {
    case 'text':
      return textOperators(el, ctx)
    case 'mark':
      return markOperators(el, ctx)
    case 'image':
      return imageOperators(el, ctx)
    case 'shape':
      return shapeOperators(el, ctx)
    case 'ink':
      return inkOperators(el, ctx)
  }
}

/** Elements grouped by page (ascending), keeping paint order; drops elements on missing pages. */
function groupByPage(elements: Element[], pages: PageInfo[]): Map<number, Element[]> {
  const byPage = new Map<number, Element[]>()
  for (const el of elements) {
    if (!pages[el.page]) {
      console.warn(`[export] element ${el.id} is on missing page ${el.page}`)
      continue
    }
    const list = byPage.get(el.page)
    if (list) list.push(el)
    else byPage.set(el.page, [el])
  }
  return new Map([...byPage].sort((a, b) => a[0] - b[0]))
}

const LOAD_OPTIONS = { updateMetadata: false, parseSpeed: ParseSpeeds.Fast } as const

/**
 * pdf-lib can't write encrypted files (it would emit a broken mix of encrypted and plain
 * objects), so encrypted input is rewritten unencrypted by pdf.js first. Files pdf-lib can't
 * parse get the same treatment as a repair.
 */
async function openForWriting(input: ExportInput, deps: ExportDeps): Promise<{ doc: PDFDocument; info?: RecoveredInfo }> {
  let doc: PDFDocument | null = null
  let pageCount = -1
  try {
    doc = await PDFDocument.load(input.bytes, { ...LOAD_OPTIONS, ignoreEncryption: true })
    if (!doc.isEncrypted) pageCount = doc.getPageCount()
  } catch (err) {
    // Unparseable, or parsed without a usable catalog / page tree.
    if (!doc?.isEncrypted) doc = null
    console.warn('[export] pdf-lib could not read the file; rewriting it with pdf.js', err)
  }

  if (doc && !doc.isEncrypted && pageCount === input.pages.length) return { doc }

  // Encrypted object streams can make pdf-lib's parse fail before it sees /Encrypt.
  const encrypted = doc ? doc.isEncrypted : looksEncrypted(input.bytes)
  const rewrite = encrypted ? deps.decrypt : deps.repair
  if (!rewrite) {
    if (encrypted) throw new ExportError('encrypted')
    throw new ExportError('damaged')
  }
  let copy
  try {
    copy = await rewrite(input.bytes)
  } catch (err) {
    if (err instanceof ExportError) throw err
    throw new ExportError(encrypted ? 'encrypted' : 'damaged', undefined, { cause: err })
  }
  throwIfAborted(deps.signal)

  let rewritten: PDFDocument
  try {
    rewritten = await PDFDocument.load(copy.bytes, LOAD_OPTIONS)
  } catch (err) {
    throw new ExportError(encrypted ? 'encrypted' : 'damaged', undefined, { cause: err })
  }
  if (copy.extraPageIndex !== undefined && copy.extraPageIndex < rewritten.getPageCount()) rewritten.removePage(copy.extraPageIndex)
  if (rewritten.isEncrypted || rewritten.getPageCount() !== input.pages.length) {
    throw new ExportError(encrypted ? 'encrypted' : 'damaged')
  }
  return { doc: rewritten, info: copy.info }
}

/** Cheap check for an /Encrypt entry in a trailer or cross-reference stream dictionary. */
export function looksEncrypted(bytes: Uint8Array): boolean {
  const text = new TextDecoder('latin1').decode(bytes)
  return /\/Encrypt[\s<\d]/.test(text)
}

function applyMetadata(doc: PDFDocument, info?: RecoveredInfo) {
  if (info) {
    if (info.title) doc.setTitle(info.title)
    if (info.author) doc.setAuthor(info.author)
    if (info.subject) doc.setSubject(info.subject)
    if (info.keywords) doc.setKeywords([info.keywords])
    if (info.creationDate) doc.setCreationDate(info.creationDate)
    // The rewrite stamps its own creator ("PDF.js"); keep the original one or none.
    if (info.creator) doc.setCreator(info.creator)
    else doc.context.lookupMaybe(doc.context.trailerInfo.Info, PDFDict)?.delete(PDFName.of('Creator'))
  }
  doc.setProducer('FillFlow')
  doc.setModificationDate(new Date())
}

async function save(doc: PDFDocument): Promise<Uint8Array> {
  try {
    return await doc.save({ objectsPerTick: 200 })
  } catch (err) {
    // A field left "dirty" by the forms step makes pdf-lib regenerate its appearance with
    // Helvetica, which throws for non-Latin values. Keep the appearances that were written.
    console.warn('[export] save failed; retrying without regenerating field appearances', err)
    return doc.save({ objectsPerTick: 200, updateFieldAppearances: false })
  }
}

/** Yields to the event loop without the 1 s clamp background tabs apply to timers. */
export function yieldToUI(): Promise<void> {
  const sched = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  if (sched?.yield) return sched.yield()
  if (typeof MessageChannel !== 'undefined') {
    return new Promise((resolve) => {
      const ch = new MessageChannel()
      ch.port1.onmessage = () => {
        ch.port1.close()
        ch.port2.close()
        resolve()
      }
      ch.port2.postMessage(null)
    })
  }
  return new Promise((resolve) => setTimeout(resolve, 0))
}
