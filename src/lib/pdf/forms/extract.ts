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
  /** The widget has an appearance (or the file asks viewers to draw one). */
  hasAppearance?: boolean
  /** Text fields: the lines of text its appearance draws (none when it draws no text). */
  textContent?: string[]
  /** Scripts by trigger ("Format", "Keystroke"…): a Map in pdf.js 6. */
  actions?: unknown
  /** The optional content (layer) the widget is in. */
  oc?: unknown
}

/** pdf.js AnnotationType.WIDGET */
const WIDGET = 20
/** Choice field flag: combo box that accepts typed text. */
const FLAG_EDIT = 1 << 18
/** Radio field flag: buttons with the same on-state turn on and off together. */
const FLAG_RADIOS_IN_UNISON = 1 << 25

/** Whether a field name is the placeholder we give fields the PDF left unnamed ("(unnamed 12R)"). */
export function isUnnamedField(name: string): boolean {
  return name.startsWith('(unnamed ') && name.endsWith(')')
}

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

const staleFields = new WeakSet<FormField>()

/**
 * Whether the PDF's own appearance of a text field shows something other than its value (a tool
 * stored /V without redrawing it, or drew right-to-left text in the wrong order). The editor
 * shows the value, so the export redraws such appearances.
 */
export function hasStaleAppearance(field: FormField): boolean {
  return staleFields.has(field)
}

function hasScript(actions: unknown, trigger: string): boolean {
  if (actions instanceof Map) return actions.has(trigger)
  return !!actions && typeof actions === 'object' && trigger in actions
}

/** Runs of right-to-left letters, and of other letters and digits. */
const RUN = /[\p{Script=Hebrew}\p{Script=Arabic}]+|[^\s\p{P}\p{S}\p{Script=Hebrew}\p{Script=Arabic}]+/gu
const RTL = /[\p{Script=Hebrew}\p{Script=Arabic}]/u

/**
 * Whether text an appearance draws, as pdf.js reads it back, shows `value`. It is laid out in
 * lines, cells or runs, so spaces (and invisible marks such as RLM) don't count. And pdf.js reads
 * a line that mixes directions back in an order of its own ("123456789 .ת.ז" for "ת.ז. 123456789"),
 * so there its runs may come in any order, but not what is in them: digits drawn reversed ("21"
 * for "12") don't show the value. Text without right-to-left letters is read back in order:
 * "04/03/2025" doesn't show "03/04/2025".
 */
function showsText(shown: string, value: string): boolean {
  const [a, b] = [shown, value].map((s) => s.normalize('NFKC').replace(/\p{Cf}/gu, ''))
  const squash = (s: string) => s.replace(/\s+/g, '')
  if (squash(a) === squash(b)) return true
  if (!RTL.test(a + b)) return false
  const chars = (s: string) => [...squash(s)].sort().join('')
  const runs = (s: string) => (s.match(RUN) ?? []).sort().join(' ')
  return chars(a) === chars(b) && runs(a) === runs(b)
}

/**
 * Whether a text widget's appearance doesn't show its value. pdf.js reports the text it draws
 * (none for a blank one; none either when the file asks viewers to redraw appearances, which the
 * export then does for every field). Password fields never show their value, and formatted ones
 * (a /AA /F script) show it formatted.
 */
function staleText(a: WidgetAnnotationData): boolean {
  if (!a.hasAppearance || a.password || hasScript(a.actions, 'Format')) return false
  const shown = Array.isArray(a.textContent) ? a.textContent.join('\n') : ''
  return !showsText(shown, normalizeText(a.fieldValue))
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
  /** Radio buttons that are separate choices even when they repeat an export value. */
  separate: Set<FormWidget>
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

function startField(name: string, type: FormFieldType, a: WidgetAnnotationData, label: string | undefined): Accumulator {
  const field: FormField = {
    name,
    type,
    widgets: [],
    readOnly: !!a.readOnly,
    required: !!a.required,
    defaultValue: '',
  }
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
    separate: new Set(),
    extras: {
      textColor: cssColor(a.defaultAppearanceData?.fontColor),
      borderWidth: a.borderColor && a.borderColor.length ? Math.max(0, a.borderStyle?.width ?? 1) : 0,
    },
  }
}

export interface BuildOptions {
  /** Annotation ids of signature widgets that already carry a digital signature. */
  signedIds?: ReadonlySet<string>
  /** Annotation id → id of the field it belongs to (pdf.js field objects' kidIds), when known. */
  parentOf?: ReadonlyMap<string, string>
  /** Whether optional content (pdf.js' `oc` of a widget) is hidden when the document opens. */
  hiddenLayer?: (oc: unknown) => boolean
  /**
   * Annotation id → label (/TU) of the field a widget belongs to. pdf.js reads labels from the
   * widget only, but a field with separate widgets keeps its own on the field.
   */
  tooltipOf?: ReadonlyMap<string, string>
}

/**
 * Radio buttons are told apart by their export value, but a group can make several separate
 * buttons share one (states /0 /1 /2 with /Opt [Yes No Yes]). Repeats get a value key unique in
 * the group ("Yes#2") and keep the PDF's export value as their label. Same-named groups (a form
 * merged twice) number their buttons alike, so they stay in step like other same-named fields.
 */
function distinguishRepeatedValues(acc: Accumulator, parentOf: ReadonlyMap<string, string> | undefined) {
  const values = new Set(acc.field.widgets.map((w) => w.exportValue ?? ''))
  const count = new Map<string, number>()
  for (const w of acc.field.widgets) {
    if (!acc.separate.has(w)) continue
    const value = w.exportValue ?? ''
    const group = `${parentOf?.get(w.id) ?? ''}\u0000${value}`
    const n = (count.get(group) ?? 0) + 1
    count.set(group, n)
    if (n === 1) continue
    let key = `${value}#${n}`
    while (values.has(key)) key += '#'
    w.label = value
    w.exportValue = key
  }
}

/** Whether some fillable widget has no label of its own (its field may have one, see `tooltipOf`). */
export function lacksLabels(annotationsByPage: readonly (readonly unknown[])[]): boolean {
  return annotationsByPage.some(
    (annotations) =>
      Array.isArray(annotations) &&
      annotations.some((raw) => {
        const a = raw as WidgetAnnotationData | null
        if (!a || (a.annotationType !== WIDGET && a.subtype !== 'Widget') || a.hidden) return false
        const type = kindOf(a)
        return !!type && type !== 'button' && !a.alternativeText?.trim()
      }),
  )
}

/** Whether some widget is in optional content (a layer), which may be hidden. */
export function usesLayers(annotationsByPage: readonly (readonly unknown[])[]): boolean {
  return annotationsByPage.some((annotations) => Array.isArray(annotations) && annotations.some((raw) => !!(raw as WidgetAnnotationData | null)?.oc))
}

/** Whether some radio group repeats an export value (telling its buttons apart needs the field tree). */
export function repeatsRadioValue(annotationsByPage: readonly (readonly unknown[])[]): boolean {
  const seen = new Set<string>()
  for (const annotations of annotationsByPage) {
    for (const raw of Array.isArray(annotations) ? annotations : []) {
      const a = raw as WidgetAnnotationData | null
      if (!a?.radioButton || typeof a.buttonValue !== 'string') continue
      const key = `${a.fieldName}\u0000${a.buttonValue}`
      if (seen.has(key)) return true
      seen.add(key)
    }
  }
  return false
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
      // In a layer that is off: the page doesn't show it, here or in other viewers.
      if (a.oc && opts.hiddenLayer?.(a.oc)) continue
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
      const label = a.alternativeText?.trim() || opts.tooltipOf?.get(id)?.trim()
      let acc = byName.get(name)
      if (!acc) byName.set(name, (acc = startField(name, type, a, label)))
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
        if (((a.fieldFlags ?? 0) & FLAG_RADIOS_IN_UNISON) === 0) acc.separate.add(widget)
        const v = asString(a.fieldValue)
        if (v !== null && v !== 'Off' && acc.selected === null) acc.selected = v
      }
      if (!field.label && label) field.label = label
      if (type === 'text' && staleText(a)) staleFields.add(field)
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
      distinguishRepeatedValues(acc, opts.parentOf)
      // pdf.js reports the export value only: with repeats, the first such button is shown on.
      const sel = acc.selected
      field.defaultValue = sel !== null && field.widgets.some((w) => w.exportValue === sel) ? sel : ''
    }
    extrasByField.set(field, acc.extras)
    fields.push(field)
  }
  return readingOrder(fields, (f) => f.widgets[0])
}
