import {
  PDFAcroButton,
  PDFBool,
  PDFButton,
  PDFCheckBox,
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
  type PDFWidgetAnnotation,
} from 'pdf-lib'
import type { FormField, FormValues, TextAlign } from '../../model/types'
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
import { flattenFields } from '../pdf/forms/flatten'
import { FieldIndex, PDF_OFF, PageIndex, widgetEntries } from '../pdf/forms/pdfIndex'
import { fieldValue, valuesEqual } from '../pdf/forms/values'
import {
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
}

interface Ctx {
  doc: PDFDocument
  form: PDFForm
  pages: PageIndex
  fonts: AppearanceFonts
  /** The original file asked viewers to regenerate appearances (/NeedAppearances true). */
  refresh: boolean
}

const NEED_APPEARANCES = PDFName.of('NeedAppearances')
const DA = PDFName.of('DA')

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

/** Check boxes / radios keep their own on/off appearances; we only create them when missing. */
function ensureButtonAppearances(target: PDFCheckBox | PDFRadioGroup) {
  if (target.needsAppearancesUpdate()) target.defaultUpdateAppearances()
}

const V = PDFName.of('V')

/** The text stored in /V, with line breaks normalized like the extracted values. */
function storedText(target: PDFTextField): string {
  return (target.acroField.getValue()?.decodeText() ?? '').replace(/\r\n?/g, '\n')
}

function storedChoices(target: PDFDropdown | PDFOptionList): string[] {
  return target.acroField.getValues().map((v) => v.decodeText())
}

/**
 * The value we want in the file is compared with what the file actually stores (not with what
 * pdf.js showed at open): pdf.js falls back to /DV and to XFA data when /V is missing, and pdf-lib
 * drops the XFA — writing those values keeps them. Read-only fields are never given user values.
 */
async function fillField(ctx: Ctx, field: FormField, target: PDFField, values: FormValues) {
  const value = field.readOnly ? field.defaultValue : fieldValue(field, values)
  switch (field.type) {
    case 'text': {
      if (!(target instanceof PDFTextField)) throw new Error('not a text field in the PDF')
      let text = storedText(target)
      const changed = text !== String(value)
      if (changed) text = writeTextValue(target.acroField, String(value))
      if (changed || ctx.refresh || missingStream(target)) await textAppearances(ctx, target, text, field)
      return
    }
    case 'checkbox':
    case 'radio': {
      if (!(target instanceof PDFCheckBox || target instanceof PDFRadioGroup)) throw new Error('not a button field in the PDF')
      // Create missing on/off appearances first so every widget knows its on-state.
      ensureButtonAppearances(target)
      const acro = target.acroField as PDFAcroButton
      const stored = acro.dict.lookup(V)
      const storedOn = stored instanceof PDFName && stored !== PDF_OFF ? stored : null
      if (field.type === 'checkbox') {
        if ((value === true) !== (storedOn !== null)) writeCheckboxState(acro, value === true, field.widgets[0]?.exportValue ?? 'Yes')
      } else {
        const on = onStateForValue(acro, String(value), field.widgets)
        if (on !== storedOn) writeButtonState(acro, on)
      }
      return
    }
    case 'dropdown': {
      if (!(target instanceof PDFDropdown)) throw new Error('not a combo box in the PDF')
      const v = String(value)
      const changed = !valuesEqual(storedChoices(target), v ? [v] : [])
      if (changed) writeChoiceValues(target.acroField, v ? [v] : [], choiceOptions(target).map((o) => o.value), false)
      if (changed || ctx.refresh || missingStream(target)) await dropdownAppearances(ctx, target, v, field)
      return
    }
    case 'listbox': {
      if (!(target instanceof PDFOptionList)) throw new Error('not a list box in the PDF')
      const list = Array.isArray(value) ? value : []
      const changed = !valuesEqual(storedChoices(target), list)
      if (changed) writeChoiceValues(target.acroField, list, choiceOptions(target).map((o) => o.value), !!field.multiSelect)
      if (changed || ctx.refresh || missingStream(target)) await listAppearances(ctx, target, list, field)
      return
    }
    default:
      return
  }
}

/**
 * Fields we didn't fill (hidden, unnamed, or not extracted): make sure each has appearances,
 * so pdf-lib's save never regenerates them with Helvetica (which throws on non-Latin text).
 */
async function ensureAppearances(ctx: Ctx, target: PDFField) {
  if (target instanceof PDFTextField) {
    if (ctx.refresh || missingStream(target)) await textAppearances(ctx, target, storedText(target))
  } else if (target instanceof PDFDropdown) {
    if (ctx.refresh || missingStream(target)) await dropdownAppearances(ctx, target, storedChoices(target)[0] ?? '')
  } else if (target instanceof PDFOptionList) {
    if (ctx.refresh || missingStream(target)) await listAppearances(ctx, target, storedChoices(target))
  } else if (target instanceof PDFCheckBox || target instanceof PDFRadioGroup) {
    ensureButtonAppearances(target)
  } else if (target instanceof PDFButton && target.needsAppearancesUpdate()) {
    try {
      target.defaultUpdateAppearances(ctx.form.getDefaultFont())
    } catch {
      // Caption the standard font can't encode: an empty appearance keeps pdf-lib from retrying.
      for (const { widget } of widgetEntries(target.acroField)) {
        if (hasNormalStream(widget)) continue
        const { width, height } = widget.getRectangle()
        const stream = ctx.doc.context.formXObject([], { BBox: [0, 0, Math.abs(width), Math.abs(height)] })
        widget.setNormalAppearance(ctx.doc.context.register(stream))
      }
    }
  }
}

/**
 * Writes `values` into the AcroForm of `pdfDoc` (a pdf-lib document of the ORIGINAL file),
 * regenerates appearances, and optionally flattens. Called by `exportPdf` before overlay
 * elements are drawn. Must not throw because of a single bad field.
 *
 * - Only fields whose stored value differs from the wanted one are rewritten; the others keep
 *   their original appearance (unless it is missing or the file asked for regeneration).
 * - Text, combo and list appearances are drawn by us with bidi-aware layout (see
 *   lib/pdf/forms/appearance.ts) using Helvetica/Courier, or the Unicode font when needed.
 * - Check boxes and radios get /V + /AS; their own on/off appearances are preserved.
 */
export async function applyFormValues(
  pdfDoc: PDFDocument,
  fields: FormField[],
  values: FormValues,
  opts: ApplyFormOptions,
): Promise<void> {
  if (!fields.length) return
  let ctx: Ctx
  let index: FieldIndex
  try {
    const form = pdfDoc.getForm()
    index = new FieldIndex(form)
    ctx = {
      doc: pdfDoc,
      form,
      pages: new PageIndex(pdfDoc),
      fonts: new AppearanceFonts(pdfDoc, opts.getUnicodeFont),
      refresh: readNeedAppearances(form),
    }
  } catch (err) {
    console.warn('[forms] could not read the form; exporting without form values', err)
    return
  }

  // Fields whose appearance may be stale: never bake those into the page.
  const broken = new Set<PDFField>()
  const handled = new Set<PDFField>()
  for (const field of fields) {
    const target = index.find(field)
    if (!target) {
      console.warn(`[forms] field "${field.name}" was not found in the PDF`)
      continue
    }
    if (handled.has(target)) continue
    handled.add(target)
    try {
      await fillField(ctx, field, target, values)
    } catch (err) {
      broken.add(target)
      console.warn(`[forms] could not fill "${field.name}"`, err)
    }
  }
  for (const target of index.all) {
    if (handled.has(target)) continue
    try {
      await ensureAppearances(ctx, target)
    } catch (err) {
      broken.add(target)
      console.warn(`[forms] could not update "${target.getName()}"`, err)
    }
  }

  if (opts.flatten) {
    const failed = flattenFields(pdfDoc, ctx.form, index.all.filter((f) => !broken.has(f)), ctx.pages)
    const kept = failed.length + broken.size
    if (kept) console.warn(`[forms] ${kept} field(s) were kept fillable instead of being flattened`)
    // Nothing interactive left: drop the calculation order that points at removed fields.
    else ctx.form.acroForm.dict.delete(PDFName.of('CO'))
    // Whatever stays interactive gets its appearance from the viewer.
    setNeedAppearances(ctx.form, kept > 0)
  } else {
    // Our appearances are complete and correct; letting viewers regenerate them would lose
    // the bidi layout (and Hebrew glyphs in viewers whose fallback fonts lack them).
    setNeedAppearances(ctx.form, broken.size > 0)
  }
}
