import type { PDFDocument } from 'pdf-lib'
import type { Asset } from '../../model/types'
import type { TextMeasurer } from '../text/layout'
import type { DocFonts } from './docFonts'
import type { DocImages } from './images'
import type { PageResources } from './pageResources'
import type { ExportDeps } from './types'

/**
 * Everything element renderers need for one page. Operators are emitted in the page's local
 * frame set up by `exportMatrix`: u = viewX, w = pageHeight − viewY (origin bottom-left of the
 * page as displayed, y up).
 */
export interface DrawContext {
  doc: PDFDocument
  /** View-space height of the page (points). */
  pageHeight: number
  res: PageResources
  fonts: DocFonts
  images: DocImages
  assets: Record<string, Asset>
  measure: TextMeasurer
  rasterizeText?: ExportDeps['rasterizeText']
}
