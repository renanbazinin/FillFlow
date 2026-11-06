import { DEFAULT_STYLES, createTextElement } from '../../../model/elements'
import type { Element, PageInfo, TextElement } from '../../../model/types'
import { layoutTextBlock } from '../../text/layout'
import type { ExportDeps, ExportInput } from '../types'
import { fontkitMeasurer, loadTestFontBytes } from './fonts'

/** Node-friendly exporter services (deterministic fontkit measurer, fonts from the repo). */
export const testDeps: ExportDeps = {
  loadFontBytes: loadTestFontBytes,
  measure: fontkitMeasurer,
  yieldToUI: async () => {},
}

export function makeInput(bytes: Uint8Array, pages: PageInfo[], elements: Element[], extra: Partial<ExportInput> = {}): ExportInput {
  return {
    bytes,
    pages,
    elements,
    assets: {},
    formFields: [],
    formValues: {},
    options: { flattenForms: true },
    ...extra,
  }
}

/** A text element laid out with the test measurer (as the editor would have stored it). */
export function makeText(page: number, x: number, y: number, value: string, style: Partial<TextElement> = {}): TextElement {
  const base = createTextElement(page, { x, y }, { ...DEFAULT_STYLES.text, ...style }, value, fontkitMeasurer)
  const el = { ...base, ...style, x, y } as TextElement
  const layout = layoutTextBlock(el.text, el, el.align, fontkitMeasurer)
  return { ...el, width: layout.width, height: layout.height }
}
