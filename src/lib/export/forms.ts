import {
  PDFAcroButton,
  PDFArray,
  PDFBool,
  PDFButton,
  PDFCheckBox,
  PDFDict,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFString,
  PDFTextField,
  TextAlignment,
  type PDFDocument,
  type PDFField,
  type PDFFont,
  type PDFForm,
  type PDFRef,
  type PDFWidgetAnnotation,
} from 'pdf-lib'
import type { FormField, FormValues, PageInfo, TextAlign } from '../../model/types'
import {
  AppearanceFonts,
  hasNormalStream,
  parseDaColor,
  parseDaFontSize,
  textRotation,
  writeDropdownAppearance,
  writeListAppearance,
  writeTextAppearance,
  type TextSpec,
} from '../pdf/forms/appearance'
import { adoptOrphanWidgets, relinkBareWidgets, relinkCutOffFields, sanitizeFieldList } from '../pdf/forms/fieldTree'
import { flattenFields } from '../pdf/forms/flatten'
import { FieldIndex, PDF_OFF, PageIndex, nameForLog, usesPrintFlag, widgetEntries } from '../pdf/forms/pdfIndex'
import { fieldValue, valuesEqual } from '../pdf/forms/values'
import {
  exportValueOfState,
  onStateForValue,
  readTopIndex,
  writeButtonState,
  writeCheckboxState,
  writeChoiceValues,
  writeTextValue,
  writeTopIndex,
} from '../pdf/forms/write'

export interface ApplyFormOptions {
  /** Bake the fields into page content and remove them from the form. */
  flatten: boolean
  /**
   * Returns the Unicode font embedded by the exporter (Arimo). Use it for field appearances
   * when a value contains characters the standard Helvetica (WinAnsi) font can't encode.
   */
  getUnicodeFont: () => Promise<PDFFont>
  /** Page geometry as the editor saw it (the same `pages` the field rects are relative to). */
  pages: PageInfo[]
  /**
   * The document was rewritten by pdf.js (decrypted or repaired) before export, so its object
   * numbers changed: the pdf.js widget ids in `fields` don't refer to this document's objects.
   */
  rewritten: boolean
  /**
   * Names of fields to flatten even when `flatten` is off: fields that items placed by the user
   * cover (a signature placed in its signature field…). Left as fields, viewers would paint them
   * over those items.
   */
  flattenAlso?: string[]
}

export interface ApplyFormResult {
  /** Names of fields whose values could not be written into the PDF. */
  unwritten: string[]
}

interface Ctx {
  doc: PDFDocument
  form: PDFForm
  pages: PageIndex
  index: FieldIndex
  fonts: AppearanceFonts
  /** The original file asked viewers to regenerate appearances (/NeedAppearances true). */
  refresh: boolean
}

const NEED_APPEARANCES = PDFName.of('NeedAppearances')
const DA = PDFName.of('DA')
const DV = PDFName.of('DV')
const AP = PDFName.of('AP')
const N = PDFName.of('N')
const CO = PDFName.of('CO')

function readNeedAppearances(form: PDFForm): boolean {
  const v = form.acroForm.dict.lookup(NEED_APPEARANCES)
  return v instanceof PDFBool && v.asBoolean()
}

function setNeedAppearances(form: PDFForm, on: boolean) {
  if (on) form.acroForm.dict.set(NEED_APPEARANCES, PDFBool.True)
  else form.acroForm.dict.delete(NEED_APPEARANCES)
}

/** The /DA string that applies to a widget (widget → field chain → AcroForm). */
function defaultAppearance(ctx: Ctx, field: PDFField, widget: PDFWidgetAnnotation): string | undefined {
  const own = widget.getDefaultAppearance()
  if (own) return own
  const inherited = field.acroField.getInheritableAttribute(DA) ?? ctx.form.acroForm.dict.lookup(DA)
  return inherited instanceof PDFString || inherited instanceof PDFHexString ? inherited.decodeText() : undefined
}

function alignOf(a: TextAlignment): TextAlign {
  return a === TextAlignment.Center ? 'center' : a === TextAlignment.Right ? 'right' : 'left'
}

function textSpec(ctx: Ctx, target: PDFField, widget: PDFWidgetAnnotation, field?: FormField): TextSpec {
  const da = defaultAppearance(ctx, target, widget)
  const spec: TextSpec = {
    fontSize: field?.fontSize ?? parseDaFontSize(da),
    color: parseDaColor(da),
  }
  if (target instanceof PDFTextField) {
    spec.multiline = field?.multiline ?? target.isMultiline()
    spec.comb = field?.comb ?? target.isCombed()
    spec.maxLength = field?.maxLength ?? target.getMaxLength()
    spec.password = field?.password ?? target.isPassword()
    spec.align = field?.textAlign ?? alignOf(target.getAlignment())
  }
  return spec
}

function missingStream(target: PDFField): boolean {
  return widgetEntries(target.acroField).some((e) => !hasNormalStream(e.widget))
}

async function textAppearances(ctx: Ctx, target: PDFTextField, text: string, field?: FormField) {
  for (const entry of widgetEntries(target.acroField)) {
    const rotation = textRotation(entry.widget, PageIndex.rotation(ctx.pages.pageOf(entry)))
    await writeTextAppearance(ctx.doc, ctx.fonts, entry.widget, rotation, text, textSpec(ctx, target, entry.widget, field))
  }
}

function choiceOptions(target: PDFDropdown | PDFOptionList) {
  return target.acroField.getOptions().map((o) => ({ value: o.value.decodeText(), label: (o.display ?? o.value).decodeText() }))
}

async function dropdownAppearances(ctx: Ctx, target: PDFDropdown, value: string, field?: FormField) {
  const label = choiceOptions(target).find((o) => o.value === value)?.label ?? value
  for (const entry of widgetEntries(target.acroField)) {
    const rotation = textRotation(entry.widget, PageIndex.rotation(ctx.pages.pageOf(entry)))
    await writeDropdownAppearance(ctx.doc, ctx.fonts, entry.widget, rotation, label, textSpec(ctx, target, entry.widget, field))
  }
}

async function listAppearances(ctx: Ctx, target: PDFOptionList, values: string[], field?: FormField) {
  const options = choiceOptions(target)
  const selected = new Set(values)
  let top = readTopIndex(target.acroField)
  for (const entry of widgetEntries(target.acroField)) {
    const rotation = textRotation(entry.widget, PageIndex.rotation(ctx.pages.pageOf(entry)))
    top = await writeListAppearance(ctx.doc, ctx.fonts, entry.widget, rotation, options, selected, top, textSpec(ctx, target, entry.widget, field))
  }
  writeTopIndex(target.acroField, top)
}

/** A form XObject that draws nothing, sized to the widget. */
function emptyAppearance(doc: PDFDocument, widget: PDFWidgetAnnotation): PDFRef {
  const { width, height } = widget.getRectangle()
  return doc.context.register(doc.context.formXObject([], { BBox: [0, 0, Math.abs(width), Math.abs(height)] }))
}

/**
 * Check boxes / radios keep their own on/off appearances. A widget without any (no /AP /N
 * dictionary), or whose current state has none, gets pdf-lib's default look. A missing "Off"
 * appearance is fine (it draws nothing): an empty one keeps pdf-lib from redrawing the field.
 */
function ensureButtonAppearances(ctx: Ctx, target: PDFCheckBox | PDFRadioGroup) {
  let redraw = false
  for (const { widget } of widgetEntries(target.acroField)) {
    const ap = widget.dict.lookup(AP)
    const normal = ap instanceof PDFDict ? ap.lookup(N) : undefined
    const state = widget.getAppearanceState()
    if (!(normal instanceof PDFDict)) redraw = true
    else if (state === PDF_OFF && !normal.has(PDF_OFF)) normal.set(PDF_OFF, emptyAppearance(ctx.doc, widget))
    else if (state && !normal.has(state)) redraw = true
  }
  if (redraw) target.defaultUpdateAppearances()
}

const V = PDFName.of('V')

/** The text stored in /V (undefined without /V), line breaks normalized like the extracted values. */
function storedText(target: PDFTextField): string | undefined {
  return target.acroField.getValue()?.decodeText().replace(/\r\n?/g, '\n')
}

/** The export values stored in /V (undefined without /V); an empty combo box value selects nothing. */
function storedChoices(target: PDFDropdown | PDFOptionList): string[] | undefined {
  if (target.acroField.V() === undefined) return undefined
  const values = target.acroField.getValues().map((v) => v.decodeText())
  return target instanceof PDFDropdown ? values.filter(Boolean) : values
}

/** Whether the field has a non-empty default value (/DV), which viewers show while /V is missing. */
function hasDefaultValue(target: PDFField): boolean {
  const dv = target.acroField.dict.context.lookup(target.acroField.getInheritableAttribute(DV))
  if (dv instanceof PDFString || dv instanceof PDFHexString) return dv.decodeText() !== ''
  return dv instanceof PDFArray && dv.size() > 0
}

/**
 * Whether `want` has to be written. It is compared with what the file stores, not with what
 * pdf.js showed at open: without /V, pdf.js shows /DV or XFA data (which pdf-lib drops), so then
 * a value is always written — an empty one too, or the default would come back.
 */
function differs(target: PDFField, stored: string | string[] | undefined, want: string | string[]): boolean {
  if (stored === undefined) return want.length > 0 || hasDefaultValue(target)
  return !valuesEqual(stored, want)
}

/** Read-only fields are never given user values. */
async function fillField(ctx: Ctx, field: FormField, target: PDFField, values: FormValues) {
  const value = field.readOnly ? field.defaultValue : fieldValue(field, values)
  switch (field.type) {
    case 'text': {
      if (!(target instanceof PDFTextField)) throw new Error('not a text field in the PDF')
      const want = String(value)
      const stored = storedText(target)
      let text = stored ?? ''
      const changed = differs(target, stored, want)
      if (changed) text = writeTextValue(target.acroField, want)
      if (changed || ctx.refresh || missingStream(target)) await textAppearances(ctx, target, text, field)
      return
    }
    case 'checkbox':
    case 'radio': {
      if (!(target instanceof PDFCheckBox || target instanceof PDFRadioGroup)) throw new Error('not a button field in the PDF')
      // Create missing on/off appearances first so every widget knows its on-state.
      ensureButtonAppearances(ctx, target)
      const acro = target.acroField as PDFAcroButton
      const stored = acro.dict.lookup(V)
      const storedOn = stored instanceof PDFName && stored !== PDF_OFF ? stored : null
      if (field.type === 'checkbox') {
        if ((value === true) !== (storedOn !== null)) writeCheckboxState(acro, value === true, field.widgets[0]?.exportValue ?? 'Yes')
      } else {
        const on = radioOnState(ctx, field, acro, String(value))
        // pdf.js reports only the export value, so when buttons share it the first one is shown
        // on: unless the user changed the choice, keep the button the file has on.
        const kept = storedOn && on && value === field.defaultValue && exportValueOfState(acro, storedOn) === exportValueOfState(acro, on)
        if (on !== storedOn && !kept) writeButtonState(acro, on)
      }
      // The state just written may have no appearance of its own yet.
      ensureButtonAppearances(ctx, target)
      return
    }
    case 'dropdown': {
      if (!(target instanceof PDFDropdown)) throw new Error('not a combo box in the PDF')
      const v = String(value)
      const changed = differs(target, storedChoices(target), v ? [v] : [])
      if (changed) writeChoiceValues(target.acroField, v ? [v] : [], choiceOptions(target).map((o) => o.value), false)
      if (changed || ctx.refresh || missingStream(target)) await dropdownAppearances(ctx, target, v, field)
      return
    }
    case 'listbox': {
      if (!(target instanceof PDFOptionList)) throw new Error('not a list box in the PDF')
      const list = Array.isArray(value) ? value : []
      const changed = differs(target, storedChoices(target), list)
      if (changed) writeChoiceValues(target.acroField, list, choiceOptions(target).map((o) => o.value), !!field.multiSelect)
      if (changed || ctx.refresh || missingStream(target)) await listAppearances(ctx, target, list, field)
      return
    }
    default:
      return
  }
}

/** The on-state of the radio button(s) the user chose (`key` is their value in FormValues). */
function radioOnState(ctx: Ctx, field: FormField, acro: PDFAcroButton, key: string) {
  const chosen = field.widgets.filter((w) => key !== '' && w.exportValue === key)
  const widgets = new Set(chosen.map((w) => ctx.index.widgetOf(w)).filter((d) => d !== undefined))
  const on = onStateForValue(acro, chosen[0]?.label ?? key, widgets)
  // The chosen button is nowhere in this file: report it rather than turning the group off.
  if (!on && chosen.length && !widgets.size) throw new Error('the chosen option was not found in the PDF')
  return on
}

/** Whether the user can give the field a value (that the export has to write). */
function carriesValue(field: FormField): boolean {
  return !field.readOnly && field.type !== 'signature' && field.type !== 'button'
}

/** Drops calculation-order entries of fields that were flattened away. */
function pruneCalculationOrder(form: PDFForm) {
  const co = form.acroForm.dict.lookup(CO)
  if (!(co instanceof PDFArray)) return
  for (let i = co.size() - 1; i >= 0; i--) if (co.lookup(i) === undefined) co.remove(i)
  if (!co.size()) form.acroForm.dict.delete(CO)
}

/**
 * Fields we didn't fill (hidden, unnamed, or not extracted): make sure each has appearances,
 * so pdf-lib's save never regenerates them with Helvetica (which throws on non-Latin text).
 */
async function ensureAppearances(ctx: Ctx, target: PDFField) {
  if (target instanceof PDFTextField) {
    if (ctx.refresh || missingStream(target)) await textAppearances(ctx, target, storedText(target) ?? '')
  } else if (target instanceof PDFDropdown) {
    if (ctx.refresh || missingStream(target)) await dropdownAppearances(ctx, target, storedChoices(target)?.[0] ?? '')
  } else if (target instanceof PDFOptionList) {
    if (ctx.refresh || missingStream(target)) await listAppearances(ctx, target, storedChoices(target) ?? [])
  } else if (target instanceof PDFCheckBox || target instanceof PDFRadioGroup) {
    ensureButtonAppearances(ctx, target)
  } else if (target instanceof PDFButton && target.needsAppearancesUpdate()) {
    try {
      target.defaultUpdateAppearances(ctx.form.getDefaultFont())
    } catch {
      // Caption the standard font can't encode: an empty appearance keeps pdf-lib from retrying.
      for (const { widget } of widgetEntries(target.acroField)) {
        if (!hasNormalStream(widget)) widget.setNormalAppearance(emptyAppearance(ctx.doc, widget))
      }
    }
  }
}

/**
 * Writes `values` into the AcroForm of `pdfDoc` (a pdf-lib document of the ORIGINAL file),
 * regenerates appearances, and optionally flattens. Called by `exportPdf` before overlay
 * elements are drawn. Must not throw because of a single bad field.
 *
 * - Our fields are found by widget (by page and position when the file was rewritten, see
 *   FieldIndex); widgets missing from the field tree are linked into it first, then fields the
 *   rewrite cut off from their parents are put back under them, and widgets it cut off from
 *   their field are linked back into it.
 * - Only fields whose stored value differs from the wanted one are rewritten; the others keep
 *   their original appearance (unless it is missing or the file asked for regeneration).
 * - Text, combo and list appearances are drawn by us with bidi-aware layout (see
 *   lib/pdf/forms/appearance.ts) using Helvetica/Courier, or the Unicode font when needed.
 * - Check boxes and radios get /V + /AS; their own on/off appearances are preserved.
 * - Values that can't be written are reported in `unwritten`, never dropped silently.
 */
export async function applyFormValues(
  pdfDoc: PDFDocument,
  fields: FormField[],
  values: FormValues,
  opts: ApplyFormOptions,
): Promise<ApplyFormResult> {
  const unwritten: string[] = []
  if (!fields.length) return { unwritten }
  let ctx: Ctx
  try {
    const form = pdfDoc.getForm()
    const pages = new PageIndex(pdfDoc)
    const dropped = sanitizeFieldList(form)
    if (dropped) console.warn(`[forms] ignored ${dropped} invalid entr${dropped === 1 ? 'y' : 'ies'} of the field list`)
    const adopted = adoptOrphanWidgets(form, pages)
    if (adopted) console.warn(`[forms] ${adopted} widget(s) were missing from the field list`)
    let index = new FieldIndex(form, pages, fields, opts)
    if (opts.rewritten) {
      // The rewrite may have cut fields off the parents their names need: put them back first,
      // as the fields rebuilt below are placed by name.
      const moved = relinkCutOffFields(form, fields, index)
      if (moved) {
        console.warn(`[forms] ${moved} field(s) had lost their parent in the rewrite`)
        index = new FieldIndex(form, pages, fields, opts)
      }
      // It may also have cut widgets off their fields: link them back, then match again.
      try {
        const relinked = relinkBareWidgets(form, pages, fields, index, opts.pages)
        if (relinked) console.warn(`[forms] ${relinked} widget(s) had lost their field in the rewrite`)
      } catch (err) {
        console.warn('[forms] could not link widgets back to their fields', err)
      }
      index = new FieldIndex(form, pages, fields, opts)
    }
    ctx = {
      doc: pdfDoc,
      form,
      pages,
      index,
      fonts: new AppearanceFonts(pdfDoc, opts.getUnicodeFont),
      refresh: readNeedAppearances(form),
    }
  } catch (err) {
    console.warn('[forms] could not read the form; exporting without form values', err)
    return { unwritten: fields.filter(carriesValue).map((f) => f.name) }
  }

  // Fields whose appearance may be stale: never bake those into the page.
  const broken = new Set<PDFField>()
  const handled = new Set<PDFField>()
  /** Fields holding a value the user changed. */
  const edited = new Set<PDFField>()
  for (const field of fields) {
    const targets = ctx.index.findAll(field)
    if (!targets.length) {
      console.warn(`[forms] field "${field.name}" was not found in the PDF`)
      if (carriesValue(field)) unwritten.push(field.name)
      continue
    }
    const changed = carriesValue(field) && !valuesEqual(fieldValue(field, values), field.defaultValue)
    let failed = false
    for (const target of targets) {
      if (changed) edited.add(target)
      if (handled.has(target)) continue
      handled.add(target)
      try {
        await fillField(ctx, field, target, values)
      } catch (err) {
        broken.add(target)
        failed = true
        console.warn(`[forms] could not fill "${field.name}"`, err)
      }
    }
    if (failed && carriesValue(field)) unwritten.push(field.name)
  }
  for (const target of ctx.index.all) {
    if (handled.has(target)) continue
    try {
      await ensureAppearances(ctx, target)
    } catch (err) {
      broken.add(target)
      console.warn(`[forms] could not update "${nameForLog(target)}"`, err)
    }
  }

  if (opts.flatten) {
    // Screen-only widgets are mostly buttons and on-screen hints, which don't belong on paper.
    // But what the user typed does, and a file that sets the Print flag on no widget at all
    // (PDFBox, for one, doesn't by default) never meant its fields to be screen-only.
    const printFlag = usesPrintFlag(ctx.index.all)
    const drawScreenOnly = (f: PDFField) => !(f instanceof PDFButton) && (!printFlag || edited.has(f))
    const failed = flattenFields(pdfDoc, ctx.form, ctx.index.all.filter((f) => !broken.has(f)), ctx.pages, drawScreenOnly)
    const stale = failed.length + broken.size
    if (stale) console.warn(`[forms] ${stale} field(s) were kept fillable instead of being flattened`)
    pruneCalculationOrder(ctx.form)
    // What stays interactive because it failed gets its appearance from the viewer. (Fields kept
    // for their print-only widgets have good appearances.)
    setNeedAppearances(ctx.form, stale > 0)
  } else {
    // Our appearances are complete and correct; letting viewers regenerate them would lose
    // the bidi layout (and Hebrew glyphs in viewers whose fallback fonts lack them).
    setNeedAppearances(ctx.form, broken.size > 0)
  }
  return { unwritten }
}
