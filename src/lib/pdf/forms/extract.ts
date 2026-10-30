import type { FormField, FormFieldOption, FormFieldType, FormWidget, PageInfo, TextAlign } from '../../../model/types'
import { pdfRectToViewRect } from '../geometry'
import { readingOrder } from './order'

/**
 * The subset of a pdf.js (v6) widget annotation we read — see `page.getAnnotations()`.
 * Verified against pdf.js 6.4 output for pdf-lib and Acrobat generated forms.
 */
export interface WidgetAnnotationData {
  annotationType?: number
  subtype?: string
  id?: string
  rect?: number[]
  fieldName?: string
  fieldType?: string | null
  fieldValue?: unknown
  fieldFlags?: number
  alternativeText?: string
  defaultAppearanceData?: { fontSize?: number; fontName?: string; fontColor?: ArrayLike<number> | null }
  borderStyle?: { width?: number }
  borderColor?: ArrayLike<number> | null
  /** /MK /R of the widget, normalized to 0/90/180/270 by pdf.js. */
  rotation?: number
  hidden?: boolean
  readOnly?: boolean
  required?: boolean
  multiLine?: boolean
  password?: boolean
  comb?: boolean
  maxLen?: number
  textAlignment?: number | null
  checkBox?: boolean
  radioButton?: boolean
  pushButton?: boolean
  exportValue?: string
  buttonValue?: string | null
  options?: { exportValue?: unknown; displayValue?: unknown }[]
  combo?: boolean
  multiSelect?: boolean
}

/** pdf.js AnnotationType.WIDGET */
const WIDGET = 20
/** Choice field flag: combo box that accepts typed text. */
const FLAG_EDIT = 1 << 18

/** Screen-only details of a field that the shared FormField type has no room for. */
export interface FieldExtras {
  /** Text color from the field's default appearance (/DA), when it isn't black. */
  textColor?: string
  /** Width of the drawn border (0 without a border color) — text is inset past it. */
  borderWidth?: number
}

const extrasByField = new WeakMap<FormField, FieldExtras>()
const NO_EXTRAS: FieldExtras = {}

export function getFieldExtras(field: FormField): FieldExtras {
  return extrasByField.get(field) ?? NO_EXTRAS
}

export type QuarterTurn = 0 | 90 | 180 | 270

const rotationByWidget = new WeakMap<FormWidget, QuarterTurn>()

/** The widget's own /MK /R (counterclockwise in PDF space); 0 when unset. */
export function getWidgetRotation(widget: FormWidget): QuarterTurn {
  return rotationByWidget.get(widget) ?? 0
}

/**
 * How far the widget's text is turned (counterclockwise) as the user sees the page.
 * An explicit /MK /R is honored. Without one, text on a rotated page runs along the box's long
 * side: upright when the box is wide on screen (generators often forget /MK /R), along the
 * page's own x axis when it is tall. The exporter applies the same rule (see textRotation).
 */
export function visualTextRotation(widget: FormWidget, pageRotation: number): QuarterTurn {
  const turn = (r: number) => ((((r - pageRotation) % 360) + 360) % 360) as QuarterTurn
  const r = getWidgetRotation(widget)
  if (r) return turn(r)
  if (pageRotation % 180 === 0) return 0
  return widget.rect.width >= widget.rect.height ? 0 : turn(0)
}

interface Accumulator {
  field: FormField
  /** Checkbox widgets that are on. */
  checked: Set<string>
  /** Radio: the field value pdf.js reported (selected export value or "Off"). */
  selected: string | null
  extras: FieldExtras
}

function kindOf(a: WidgetAnnotationData): FormFieldType | null {
  switch (a.fieldType) {
    case 'Tx':
      return 'text'
    case 'Btn':
      if (a.pushButton) return 'button'
      if (a.radioButton) return 'radio'
      return a.checkBox ? 'checkbox' : null
    case 'Ch':
      return a.combo ? 'dropdown' : 'listbox'
    case 'Sig':
      return 'signature'
    default:
      return null
  }
}

const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null)

function normalizeText(v: unknown): string {
  const s = Array.isArray(v) ? asString(v[0]) : asString(v)
  return (s ?? '').replace(/\r\n?/g, '\n')
}

function textAlign(q: number | null | undefined): TextAlign | undefined {
  return q === 1 ? 'center' : q === 2 ? 'right' : q === 0 ? 'left' : undefined
}

function options(a: WidgetAnnotationData): FormFieldOption[] {
  const out: FormFieldOption[] = []
  for (const o of a.options ?? []) {
    const value = asString(o.exportValue) ?? asString(o.displayValue)
    if (value === null) continue
    out.push({ value, label: asString(o.displayValue) ?? value })
  }
  return out
}

function cssColor(c: ArrayLike<number> | null | undefined): string | undefined {
  if (!c || c.length < 3) return undefined
  const [r, g, b] = [c[0], c[1], c[2]].map((n) => Math.max(0, Math.min(255, Math.round(n))))
  if (r + g + b < 40) return undefined // black / near-black: use the default
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

function validRect(r: number[] | undefined): r is number[] {
  return Array.isArray(r) && r.length === 4 && r.every((n) => Number.isFinite(n))
}

function startField(name: string, type: FormFieldType, a: WidgetAnnotationData): Accumulator {
  const field: FormField = {
    name,
    type,
    widgets: [],
    readOnly: !!a.readOnly,
    required: !!a.required,
    defaultValue: '',
  }
  const label = a.alternativeText?.trim()
  if (label) field.label = label
  const fontSize = a.defaultAppearanceData?.fontSize
  if (type === 'text') {
    field.multiline = !!a.multiLine
    field.password = !!a.password
    if (a.maxLen && a.maxLen > 0) field.maxLength = a.maxLen
    field.comb = !!a.comb && !!field.maxLength && !field.multiline && !field.password
    const align = textAlign(a.textAlignment)
    if (align) field.textAlign = align
    field.fontSize = typeof fontSize === 'number' && fontSize > 0 ? fontSize : 0
    field.defaultValue = normalizeText(a.fieldValue)
  } else if (type === 'dropdown' || type === 'listbox') {
    field.options = options(a)
    field.fontSize = typeof fontSize === 'number' && fontSize > 0 ? fontSize : 0
    const values = (Array.isArray(a.fieldValue) ? a.fieldValue : [a.fieldValue]).filter((v): v is string => typeof v === 'string')
    if (type === 'dropdown') {
      field.editable = ((a.fieldFlags ?? 0) & FLAG_EDIT) !== 0
      field.defaultValue = values[0] ?? ''
    } else {
      field.multiSelect = !!a.multiSelect
      field.defaultValue = field.multiSelect ? values : values.slice(0, 1)
    }
  } else if (type === 'checkbox') {
    field.defaultValue = false
  }
  return {
    field,
    checked: new Set(),
    selected: null,
    extras: {
      textColor: cssColor(a.defaultAppearanceData?.fontColor),
      borderWidth: a.borderColor && a.borderColor.length ? Math.max(0, a.borderStyle?.width ?? 1) : 0,
    },
  }
}

export interface BuildOptions {
  /** Annotation ids of signature fields that already carry a digital signature. */
  signedIds?: ReadonlySet<string>
}

/**
 * Builds FormFields from pdf.js widget annotations (one array per page, in page order).
 * Pure and defensive: malformed entries are skipped, never thrown on.
 */
export function buildFormFields(
  annotationsByPage: readonly (readonly unknown[])[],
  pages: readonly PageInfo[],
  opts: BuildOptions = {},
): FormField[] {
  const byName = new Map<string, Accumulator>()
  annotationsByPage.forEach((annotations, pageIndex) => {
    const page = pages[pageIndex]
    if (!page || !Array.isArray(annotations)) return
    for (const raw of annotations) {
      if (!raw || typeof raw !== 'object') continue
      const a = raw as WidgetAnnotationData
      if (a.annotationType !== WIDGET && a.subtype !== 'Widget') continue
      if (a.hidden) continue
      const type = kindOf(a)
      if (!type || type === 'button') continue
      if (!validRect(a.rect)) continue
      const rect = pdfRectToViewRect(page, a.rect)
      if (rect.width < 1 || rect.height < 1) continue
      if (rect.x >= page.width || rect.y >= page.height || rect.x + rect.width <= 0 || rect.y + rect.height <= 0) continue

      const id = a.id ?? `${pageIndex}:${a.rect.join(',')}`
      // Already signed (digitally): nothing to fill, and no "Sign here" over a real signature.
      if (type === 'signature' && opts.signedIds?.has(id)) continue
      const name = a.fieldName?.trim() ? a.fieldName : `(unnamed ${id})`
      let acc = byName.get(name)
      if (!acc) byName.set(name, (acc = startField(name, type, a)))
      const { field } = acc
      // A corrupt file may reuse a name for different kinds of fields; keep the first kind.
      const sameKind = field.type === type || (field.type === 'checkbox' && type === 'radio') || (field.type === 'radio' && type === 'checkbox')
      if (!sameKind) continue

      const widget: FormWidget = { id, page: pageIndex, rect }
      const turn = a.rotation ?? 0
      if (turn === 90 || turn === 180 || turn === 270) rotationByWidget.set(widget, turn)
      if (type === 'checkbox') {
        widget.exportValue = asString(a.exportValue) ?? 'Yes'
        const v = asString(a.fieldValue)
        if (v !== null && v !== 'Off' && v === widget.exportValue) acc.checked.add(widget.id)
      } else if (type === 'radio') {
        widget.exportValue = asString(a.buttonValue) ?? ''
        const v = asString(a.fieldValue)
        if (v !== null && v !== 'Off' && acc.selected === null) acc.selected = v
      }
      if (!field.label && a.alternativeText?.trim()) field.label = a.alternativeText.trim()
      field.widgets.push(widget)
    }
  })

  const fields: FormField[] = []
  for (const acc of byName.values()) {
    const { field } = acc
    if (!field.widgets.length) continue
    field.widgets = readingOrder(field.widgets, (w) => w)
    if (field.type === 'checkbox') {
      const exports = new Set(field.widgets.map((w) => w.exportValue))
      if (exports.size > 1) {
        // Same-name check boxes with different export values behave like a radio group.
        field.type = 'radio'
        const on = field.widgets.find((w) => acc.checked.has(w.id))
        field.defaultValue = on?.exportValue ?? ''
      } else {
        field.defaultValue = acc.checked.size > 0
      }
    } else if (field.type === 'radio') {
      const sel = acc.selected
      field.defaultValue = sel !== null && field.widgets.some((w) => w.exportValue === sel) ? sel : ''
    }
    extrasByField.set(field, acc.extras)
    fields.push(field)
  }
  return readingOrder(fields, (f) => f.widgets[0])
}
