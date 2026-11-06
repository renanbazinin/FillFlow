import { getFieldExtras } from '../../lib/pdf/formFields'
import {
  FIELD_LINE_HEIGHT,
  MONO_ADVANCE,
  combLayout,
  listFontSize,
  multiLineLayout,
  singleLineFontSize,
  textPadding,
} from '../../lib/pdf/forms/textLayout'
import type { FormField, Rect } from '../../model/types'
import { measureFieldText } from './measure'

/**
 * How a field's text is shown on the page, in points. Uses the exact same rules as the
 * exported appearance streams (lib/pdf/forms/textLayout.ts), so sizes and positions match.
 */
export interface TextLook {
  fontSize: number
  /** Horizontal inset (and top inset of multi-line fields). */
  padding: number
  color: string
  /** Comb fields: monospaced cells. */
  comb?: { cell: number; letterSpacing: number; inset: number }
}

export function textLook(field: FormField, rect: Rect, value: string, opts: { singleLine?: boolean } = {}): TextLook {
  const extras = getFieldExtras(field)
  const padding = textPadding(extras.borderWidth ?? 0)
  const color = extras.textColor ?? '#000000'
  const box = { width: rect.width, height: rect.height, fontSize: field.fontSize, padding }
  if (opts.singleLine) return { fontSize: singleLineFontSize(value, box, measureFieldText), padding, color }
  if (field.comb && field.maxLength) {
    const { fontSize, cellWidth } = combLayout({ ...box, maxLength: field.maxLength })
    const advance = MONO_ADVANCE * fontSize
    return { fontSize, padding: 0, color, comb: { cell: cellWidth, letterSpacing: cellWidth - advance, inset: (cellWidth - advance) / 2 } }
  }
  if (field.type === 'listbox') return { fontSize: listFontSize(box), padding, color }
  if (field.multiline && !field.password) {
    return { fontSize: multiLineLayout(value, box, measureFieldText).fontSize, padding, color }
  }
  const shown = field.password ? '•'.repeat([...value].length) : value
  return { fontSize: singleLineFontSize(shown, box, measureFieldText), padding, color }
}

export const LINE_HEIGHT = FIELD_LINE_HEIGHT

const IOS =
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

/**
 * iOS zooms the whole page when an input with a font smaller than 16px gets focus. We render
 * such inputs k× larger and scale them back down with a transform: same pixels, no zoom.
 */
export function inputScale(fontPx: number): number {
  return IOS && fontPx > 0 && fontPx < 16 ? 16 / fontPx : 1
}
