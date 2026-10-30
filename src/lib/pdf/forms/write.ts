import { PDFHexString, PDFName, PDFNumber, type PDFAcroButton, type PDFAcroChoice, type PDFAcroText, type PDFWidgetAnnotation } from 'pdf-lib'
import type { FormWidget } from '../../../model/types'
import { PDF_OFF, refKey, widgetEntries } from './pdfIndex'

const V = PDFName.of('V')
const RV = PDFName.of('RV')
const I = PDFName.of('I')
const TI = PDFName.of('TI')
/** Text field flag: rich text (the /RV value would win over /V in Acrobat). */
const RICH_TEXT = 1 << 25

/** Writes a text value (truncated to /MaxLen); line breaks are stored as CR like Acrobat does. */
export function writeTextValue(acro: PDFAcroText, value: string): string {
  const max = acro.getMaxLength()
  let v = value.replace(/\r\n?/g, '\n')
  if (max !== undefined && v.length > max) v = v.slice(0, max)
  if (v) acro.setValue(PDFHexString.fromText(v.replace(/\n/g, '\r')))
  else acro.removeValue()
  acro.dict.delete(RV)
  if (acro.hasFlag(RICH_TEXT)) acro.setFlagTo(RICH_TEXT, false)
  return v
}

/**
 * Sets a check box / radio group state: /V on the field and /AS on every widget (a widget is
 * "on" when its own on-state equals `on`). `null` turns everything off.
 */
export function writeButtonState(acro: PDFAcroButton, on: PDFName | null): void {
  acro.dict.set(V, on ?? PDF_OFF)
  for (const { widget } of widgetEntries(acro)) {
    const own = widget.getOnValue()
    widget.setAppearanceState(on && own === on ? on : PDF_OFF)
  }
}

/** Checks/unchecks every widget of a check box (each widget uses its own on-state). */
export function writeCheckboxState(acro: PDFAcroButton, checked: boolean, fallbackOn: string): void {
  const entries = widgetEntries(acro)
  const first = entries[0] ? onStateOf(entries[0].widget, fallbackOn) : PDFName.of(fallbackOn || 'Yes')
  acro.dict.set(V, checked ? first : PDF_OFF)
  for (const { widget } of entries) widget.setAppearanceState(checked ? onStateOf(widget, fallbackOn) : PDF_OFF)
}

/** The on-state name of a widget, also when it has no appearance dictionary yet. */
export function onStateOf(widget: PDFWidgetAnnotation, fallback: string): PDFName {
  return widget.getOnValue() ?? PDFName.of(fallback || 'Yes')
}

/**
 * Resolves the on-state for a selected export value. pdf.js reports export values (mapped
 * through /Opt), which can differ from the appearance state names, so we map through the
 * widget references we extracted, then fall back to comparing state names.
 */
export function onStateForValue(acro: PDFAcroButton, value: string, widgets: readonly FormWidget[]): PDFName | null {
  if (!value) return null
  const entries = widgetEntries(acro)
  const ids = new Set(widgets.filter((w) => w.exportValue === value).map((w) => w.id))
  for (const e of entries) {
    if (e.ref && ids.has(refKey(e.ref))) return onStateOf(e.widget, value)
  }
  for (const e of entries) {
    const on = e.widget.getOnValue()
    if (on && (on.decodeText() === value || on.asString() === `/${value}`)) return on
  }
  // /Opt export values, index-aligned with the widgets.
  const opts = acro.getExportValues()
  if (opts) {
    const i = opts.findIndex((o) => o.decodeText() === value)
    if (i >= 0 && entries[i]) return onStateOf(entries[i].widget, value)
  }
  return null
}

/** Writes choice values (export values) and keeps /I (selected indices) consistent. */
export function writeChoiceValues(acro: PDFAcroChoice, values: string[], optionValues: string[], multi: boolean): void {
  const clean = values.filter((v) => typeof v === 'string')
  if (!clean.length) acro.dict.delete(V)
  else if (clean.length === 1) acro.dict.set(V, PDFHexString.fromText(clean[0]))
  else acro.dict.set(V, acro.dict.context.obj(clean.map((v) => PDFHexString.fromText(v))))
  const indices = clean
    .map((v) => optionValues.indexOf(v))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)
  if (multi && indices.length) acro.dict.set(I, acro.dict.context.obj(indices))
  else acro.dict.delete(I)
}

/** Reads /TI (list box top index). */
export function readTopIndex(acro: PDFAcroChoice): number {
  const ti = acro.dict.lookup(TI)
  return ti instanceof PDFNumber ? Math.max(0, Math.floor(ti.asNumber())) : 0
}

export function writeTopIndex(acro: PDFAcroChoice, top: number): void {
  if (top > 0) acro.dict.set(TI, PDFNumber.of(top))
  else acro.dict.delete(TI)
}
