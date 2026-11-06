import { loadFont } from '../../model/fonts'
import type { Element, FontId } from '../../model/types'
import { useEditor } from '../../store/editor'
import { clearMeasureCache } from '../text/layout'
import { convertImage, loadFontBytes, pdfjsRewriter, rasterizeText } from './browser'
import { renderPdf } from './engine'
import { ExportError } from './errors'
import type { PdfjsDocument } from './pdfjsRewrite'
import type { ExportDeps, ExportInput, ExportOptions } from './types'

export type { ExportDeps, ExportInput, ExportOptions, ExportPhase, ExportProgress } from './types'
export { ExportError, type ExportErrorCode } from './errors'

/**
 * Produces the filled PDF. Pure function of its input (no store access). In the browser the
 * defaults measure text with the editor's canvas measurer and fetch the bundled fonts; pass
 * `deps` to override any of them (tests inject Node-friendly versions).
 */
export async function exportPdf(input: ExportInput, deps: Partial<ExportDeps> = {}): Promise<Uint8Array> {
  return renderPdf(input, {
    loadFontBytes,
    rasterizeText,
    convertImage,
    ...pdfjsRewriter(null),
    ...deps,
  })
}

/**
 * Fetches the default text face (typed text, and form values written in Unicode) ahead of the
 * first download and keeps it in memory, so that a download made offline later still has it: the
 * browser's cache can't be relied on offline.
 */
export function preloadDefaultFont(): void {
  loadFontBytes('sans', false).catch(() => {
    /* offline or failed: the download fetches it again when it runs */
  })
}

export type ExportHooks = Pick<ExportDeps, 'onProgress' | 'onUnwrittenFields' | 'signal'>

/** Exports the document currently open in the editor. */
export async function exportCurrentDocument(options: ExportOptions, hooks: ExportHooks = {}): Promise<Uint8Array> {
  const { doc, elements, assets, formValues } = useEditor.getState()
  if (!doc) throw new ExportError('unknown', 'Open a document first.')
  await loadFontsIn(elements)
  return exportPdf(
    { bytes: doc.bytes, pages: doc.pages, elements, assets, formFields: doc.formFields, formValues, options },
    { ...pdfjsRewriter(doc.pdf as unknown as PdfjsDocument), ...hooks },
  )
}

/** Loads every font the text elements use so measurements match the rendered glyphs. */
async function loadFontsIn(elements: Element[]): Promise<void> {
  const fonts = new Map<string, [FontId, boolean]>()
  for (const el of elements) if (el.kind === 'text') fonts.set(`${el.fontId}:${el.bold}`, [el.fontId, el.bold])
  if (!fonts.size) return
  await Promise.all([...fonts.values()].map(([id, bold]) => loadFont(id, bold)))
  // Widths cached before a face finished loading would come from a fallback font.
  clearMeasureCache()
}
