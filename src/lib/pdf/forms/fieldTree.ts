import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  type PDFContext,
  type PDFField,
  type PDFForm,
  type PDFObject,
} from 'pdf-lib'
import type { FormField, FormFieldType, FormWidget, PageInfo, Rect } from '../../../model/types'
import { isUnnamedField } from './extract'
import { PDF_OFF, SAME_PLACE, holdsType, placeOffset, qualifiedName, viewRectOf, type FieldIndex, type PageIndex } from './pdfIndex'

/**
 * Repairs of the AcroForm field tree before it is filled. The editor shows the fields pdf.js
 * finds in the page annotations, and pdf.js skips entries it can't use. pdf-lib only knows the
 * fields under /AcroForm /Fields and throws on a single bad entry there — without these repairs,
 * values the user filled on screen would be missing from the export.
 */

const FIELDS = PDFName.of('Fields')
const KIDS = PDFName.of('Kids')
const PARENT = PDFName.of('Parent')
const SUBTYPE = PDFName.of('Subtype')
const WIDGET = PDFName.of('Widget')
const FT = PDFName.of('FT')
const DA = PDFName.of('DA')
const DR = PDFName.of('DR')
const T = PDFName.of('T')
const TU = PDFName.of('TU')
const FF = PDFName.of('Ff')
const V = PDFName.of('V')
const DV = PDFName.of('DV')
const I = PDFName.of('I')
const Q = PDFName.of('Q')
const MAX_LEN = PDFName.of('MaxLen')
const OPT = PDFName.of('Opt')
const AA = PDFName.of('AA')
const AP = PDFName.of('AP')
const N = PDFName.of('N')
const AS = PDFName.of('AS')
const CO = PDFName.of('CO')

/**
 * Removes /Fields entries that aren't references to dictionaries (a freed object, `null`) and
 * repeated entries. Returns how many were removed.
 */
export function sanitizeFieldList(form: PDFForm): number {
  const fields = form.acroForm.dict.lookup(FIELDS)
  if (!(fields instanceof PDFArray)) return 0
  const seen = new Set<PDFRef>()
  const drop: number[] = []
  for (let i = 0; i < fields.size(); i++) {
    const ref = fields.get(i)
    if (!(ref instanceof PDFRef) || seen.has(ref) || !(fields.lookup(i) instanceof PDFDict)) drop.push(i)
    if (ref instanceof PDFRef) seen.add(ref)
  }
  for (const i of drop.reverse()) fields.remove(i)
  return drop.length
}

/** Every object reachable from `roots` through /Kids. */
function reachable(roots: PDFObject[], context: PDFContext): Set<PDFRef> {
  const out = new Set<PDFRef>()
  const stack = [...roots]
  while (stack.length) {
    const ref = stack.pop()
    if (!(ref instanceof PDFRef) || out.has(ref)) continue
    out.add(ref)
    const dict = context.lookup(ref)
    const kids = dict instanceof PDFDict ? dict.lookup(KIDS) : undefined
    if (kids instanceof PDFArray) for (const kid of kids.asArray()) stack.push(kid)
  }
  return out
}

/** Whether an annotation belongs to a form field: it has a field type, maybe inherited. */
function hasFieldType(dict: PDFDict): boolean {
  const seen = new Set<PDFDict>()
  let node: unknown = dict
  while (node instanceof PDFDict && !seen.has(node)) {
    if (node.lookup(FT) instanceof PDFName) return true
    seen.add(node)
    node = node.lookup(PARENT)
  }
  return false
}

/** Whether a field dictionary is merged with its widget (its widget can't have siblings then). */
function isMergedField(dict: PDFDict): boolean {
  return dict.get(SUBTYPE) === WIDGET && !(dict.lookup(KIDS) instanceof PDFArray)
}

/** Entries of a field dictionary (PDF 32000-1 §12.7.3, §12.7.4); the others are its widget's. */
const FIELD_ENTRIES = ['FT', 'Parent', 'T', 'TU', 'TM', 'Ff', 'V', 'DV', 'DA', 'Q', 'DS', 'RV', 'MaxLen', 'Opt', 'TI', 'I', 'Lock', 'SV'].map((key) =>
  PDFName.of(key),
)
/** The field's own trigger events in /AA (the others are its widget's). */
const FIELD_EVENTS = ['K', 'F', 'V', 'C'].map((key) => PDFName.of(key))

/** Moves the field's own trigger events from the /AA of a field merged with its widget to `field`, unless it has its own. */
function moveFieldEvents(merged: PDFDict, field: PDFDict) {
  const actions = merged.lookup(AA)
  if (!(actions instanceof PDFDict)) return
  const held = field.lookup(AA)
  const own = held instanceof PDFDict ? held : merged.context.obj({})
  for (const key of FIELD_EVENTS) {
    const action = actions.get(key)
    if (action === undefined) continue
    if (!own.has(key)) own.set(key, action)
    actions.delete(key)
  }
  if (own !== held && own.keys().length) field.set(AA, own)
}

/** Puts `field` in the place of `ref` in a list of fields (/Kids, /Fields, /CO) that doesn't hold it yet. */
function replaceInList(list: PDFObject | undefined, ref: PDFRef, field: PDFRef) {
  if (!(list instanceof PDFArray)) return
  const i = list.indexOf(ref)
  if (i === undefined) return
  if (list.indexOf(field) === undefined) list.set(i, field)
  else list.remove(i)
}

/**
 * Splits a field merged with its widget into a field with that widget as its kid, so that more
 * widgets can join it. The widget keeps its reference (pages and the structure tree point to
 * it); the new field takes its place in the field tree. Returns the new field's reference.
 */
function splitMergedField(acroForm: PDFDict, ref: PDFRef, merged: PDFDict): PDFRef {
  const context = acroForm.context
  const field = context.obj({})
  for (const key of FIELD_ENTRIES) {
    const value = merged.get(key)
    if (value === undefined) continue
    field.set(key, value)
    // pdf.js reads the field's label (/TU) from the widget only.
    if (key !== TU) merged.delete(key)
  }
  moveFieldEvents(merged, field)
  const fieldRef = context.register(field)
  field.set(KIDS, context.obj([ref]))
  merged.set(PARENT, fieldRef)
  const parent = field.lookup(PARENT)
  for (const list of [parent instanceof PDFDict ? parent.lookup(KIDS) : acroForm.lookup(FIELDS), acroForm.lookup(CO)]) replaceInList(list, ref, fieldRef)
  return fieldRef
}

/** Sets the defaults viewers redraw fields with, which a file that lost its AcroForm lost too. */
function ensureFieldDefaults(acroForm: PDFDict) {
  if (!acroForm.has(DA)) acroForm.set(DA, PDFString.of('/Helv 0 Tf 0 g'))
  if (!acroForm.has(DR)) {
    acroForm.set(DR, acroForm.context.obj({ Font: { Helv: { Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' } } }))
  }
}

/**
 * Links page widgets that the field tree doesn't reach — pages merged without their AcroForm, a
 * lost /Fields entry — into the tree: into their parent's /Kids, or their topmost field into
 * /Fields (pdf.js does the same when it writes a file without /Fields). Returns how many widgets
 * were adopted.
 */
export function adoptOrphanWidgets(form: PDFForm, pages: PageIndex): number {
  const acroForm = form.acroForm.dict
  const context = acroForm.context
  const listed = acroForm.lookup(FIELDS)
  const inTree = reachable(listed instanceof PDFArray ? listed.asArray() : [], context)
  /** Fields merged with their widget that were split: the widget's ref → the new field's. */
  const split = new Map<PDFRef, PDFRef>()
  // Kids would hide a merged parent's own widget from pdf-lib: give that widget a field of its own.
  const splitParent = (ref: PDFRef, merged: PDFDict) => {
    const fieldRef = splitMergedField(acroForm, ref, merged)
    split.set(ref, fieldRef)
    if (inTree.has(ref)) inTree.add(fieldRef)
    return fieldRef
  }
  let adopted = 0
  for (const page of pages.pages) {
    const annots = page.node.Annots()
    for (let i = 0; i < (annots?.size() ?? 0); i++) {
      const ref = annots?.get(i)
      if (!(ref instanceof PDFRef) || inTree.has(ref)) continue
      const widget = context.lookup(ref)
      if (!(widget instanceof PDFDict) || widget.get(SUBTYPE) !== WIDGET || !hasFieldType(widget)) continue
      let node = ref
      let dict = widget
      const seen = new Set([ref])
      for (;;) {
        const raw = dict.get(PARENT)
        const parentRef = raw instanceof PDFRef ? (split.get(raw) ?? raw) : raw
        const parentDict = parentRef instanceof PDFRef && !seen.has(parentRef) ? context.lookup(parentRef) : undefined
        if (!(parentRef instanceof PDFRef) || !(parentDict instanceof PDFDict)) {
          // The topmost field. A /Parent that leads nowhere (or in a circle) would make pdf-lib throw.
          if (parentRef !== undefined && !(parentRef instanceof PDFDict)) dict.delete(PARENT)
          const fields = acroForm.lookup(FIELDS)
          if (fields instanceof PDFArray) fields.push(node)
          else acroForm.set(FIELDS, context.obj([node]))
          break
        }
        seen.add(parentRef)
        const up = isMergedField(parentDict) ? splitParent(parentRef, parentDict) : parentRef
        const parent = context.lookup(up, PDFDict)
        seen.add(up)
        if (raw !== up) dict.set(PARENT, up)
        const kids = parent.lookup(KIDS)
        if (!(kids instanceof PDFArray)) parent.set(KIDS, context.obj([node]))
        else if (kids.indexOf(node) === undefined) kids.push(node)
        if (inTree.has(up)) break
        node = up
        dict = parent
      }
      for (const r of reachable([node], context)) inTree.add(r)
      adopted++
    }
  }
  if (adopted) ensureFieldDefaults(acroForm)
  return adopted
}

interface BareWidget {
  ref: PDFRef
  dict: PDFDict
  /** Its rectangle in view space. */
  rect: Rect
}

/** Widget annotations of each page that belong to no field (no field type, own or inherited). */
function bareWidgets(pages: PageIndex, views: readonly PageInfo[]): Map<number, BareWidget[]> {
  const out = new Map<number, BareWidget[]>()
  pages.pages.forEach((page, index) => {
    const annots = page.node.Annots()
    for (let i = 0; i < (annots?.size() ?? 0); i++) {
      const ref = annots?.get(i)
      const dict = annots?.lookup(i)
      if (!(ref instanceof PDFRef) || !(dict instanceof PDFDict) || dict.get(SUBTYPE) !== WIDGET || hasFieldType(dict)) continue
      const rect = views[index] ? viewRectOf(dict, views[index]) : null
      if (rect) out.set(index, [...(out.get(index) ?? []), { ref, dict, rect }])
    }
  })
  return out
}

const FIELD_TYPES: Record<FormFieldType, string> = {
  text: 'Tx',
  checkbox: 'Btn',
  radio: 'Btn',
  button: 'Btn',
  dropdown: 'Ch',
  listbox: 'Ch',
  signature: 'Sig',
}

/** The field flags (PDF 32000-1 §12.7.3.1, §12.7.4) of a field as the editor read it. */
function fieldFlags(field: FormField): number {
  const flags = (field.readOnly ? 1 : 0) | (field.required ? 2 : 0)
  switch (field.type) {
    case 'text':
      return flags | (field.multiline ? 1 << 12 : 0) | (field.password ? 1 << 13 : 0) | (field.comb ? 1 << 24 : 0)
    case 'radio': {
      // Buttons that share an export value without being told apart turn on together.
      const values = field.widgets.map((w) => w.exportValue)
      return flags | (1 << 15) | (new Set(values).size < values.length ? 1 << 25 : 0)
    }
    case 'button':
      return flags | (1 << 16)
    case 'dropdown':
      return flags | (1 << 17) | (field.editable ? 1 << 18 : 0)
    case 'listbox':
      return flags | (field.multiSelect ? 1 << 21 : 0)
    default:
      return flags
  }
}

/** Whether a node of the field tree has fields as kids (pdf-lib tells fields from widgets by /T). */
function hasFieldKids(node: PDFDict): boolean {
  const kids = node.lookup(KIDS)
  return (
    kids instanceof PDFArray &&
    kids.asArray().some((kid) => {
      const dict = node.context.lookup(kid)
      return dict instanceof PDFDict && dict.has(T)
    })
  )
}

/**
 * Where a field named `name` goes in the field tree: under its parent fields (found by name, or
 * created) or at the top. Unnamed fields (no /T in the PDF) go to the top.
 */
function placeInTree(acroForm: PDFDict, name: string): { kids: PDFArray; parent?: PDFRef; partial?: string } {
  if (isUnnamedField(name)) return parentFields(acroForm, [])
  const parts = name.split('.')
  const partial = parts.pop() ?? ''
  return { ...parentFields(acroForm, parts), partial }
}

/** The parent fields named `parts` (found by name, or created), or the top of the field tree. */
function parentFields(acroForm: PDFDict, parts: readonly string[]): { kids: PDFArray; parent?: PDFRef } {
  const context = acroForm.context
  const top = acroForm.lookup(FIELDS)
  let kids = top instanceof PDFArray ? top : context.obj([])
  if (kids !== top) acroForm.set(FIELDS, kids)
  let parent: PDFRef | undefined
  for (let i = 0; i < parts.length; i++) {
    const prefix = parts.slice(0, i + 1).join('.')
    const found = kids.asArray().find((ref) => {
      const node = context.lookup(ref)
      return node instanceof PDFDict && hasFieldKids(node) && qualifiedName(node) === prefix
    })
    let next: PDFRef
    if (found instanceof PDFRef) next = found
    else {
      const group = context.obj({ T: PDFHexString.fromText(parts[i]), Kids: [] })
      if (parent) group.set(PARENT, parent)
      next = context.register(group)
      kids.push(next)
    }
    parent = next
    kids = context.lookup(next, PDFDict).lookup(KIDS, PDFArray)
  }
  return { kids, parent }
}

interface FoundWidget extends BareWidget {
  widget: FormWidget
}

/** A button widget's on-state: the name of its normal appearance that isn't Off. */
function onStateName(widget: PDFDict): string | undefined {
  const ap = widget.lookup(AP)
  const normal = ap instanceof PDFDict ? ap.lookup(N) : undefined
  return normal instanceof PDFDict ? normal.keys().find((key) => key !== PDF_OFF)?.decodeText() : undefined
}

/**
 * A field dictionary rebuilt from what the editor read of `field`, with `kids` as its widgets,
 * placed in the field tree by its name. Its value is the one the editor showed, which the
 * user's value is compared with when filling.
 */
function rebuildField(acroForm: PDFDict, field: FormField, kids: FoundWidget[]): PDFRef {
  const context = acroForm.context
  const text = (s: string) => PDFHexString.fromText(s)
  const dict = context.obj({ FT: FIELD_TYPES[field.type], Kids: kids.map((k) => k.ref) })
  const flags = fieldFlags(field)
  if (flags) dict.set(FF, PDFNumber.of(flags))
  if (field.label) dict.set(TU, text(field.label))
  if (field.type === 'checkbox' || field.type === 'radio') {
    // The buttons kept their appearances: /AP names each one's on-state, /AS the one that is on.
    const exports = kids.map((k) => k.widget.label ?? k.widget.exportValue ?? '')
    const states = kids.map((k) => onStateName(k.dict))
    if (exports.some((v, i) => v !== states[i])) dict.set(OPT, context.obj(exports.map(text)))
    const on = kids.map((k) => k.dict.get(AS)).find((s) => s instanceof PDFName && s !== PDF_OFF)
    dict.set(V, on ?? PDF_OFF)
  } else if (field.type !== 'signature') {
    if (!kids.some((k) => k.dict.has(DA))) dict.set(DA, PDFString.of(`/Helv ${field.fontSize ?? 0} Tf 0 g`))
    if (field.maxLength) dict.set(MAX_LEN, PDFNumber.of(field.maxLength))
    if (field.textAlign === 'center' || field.textAlign === 'right') dict.set(Q, PDFNumber.of(field.textAlign === 'center' ? 1 : 2))
    if (field.options) {
      dict.set(OPT, context.obj(field.options.map((o) => (o.label === o.value ? text(o.value) : context.obj([text(o.value), text(o.label)])))))
    }
    const value = field.defaultValue
    const values = (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === 'string' && v !== '')
    if (values.length > 1) dict.set(V, context.obj(values.map(text)))
    else if (values.length) dict.set(V, text(field.type === 'text' ? values[0].replace(/\n/g, '\r') : values[0]))
  }
  const place = placeInTree(acroForm, field.name)
  if (place.partial !== undefined) dict.set(T, text(place.partial))
  if (place.parent) dict.set(PARENT, place.parent)
  const ref = context.register(dict)
  place.kids.push(ref)
  return ref
}

/**
 * pdf.js' rewrite (decrypt / repair) rebuilds the field tree from /Fields alone: a widget whose
 * field it can't reach that way comes out bare, without /Parent and so without a name, type or
 * value (a field merged with its widget keeps its own entries, but not the ones it inherited).
 * Links each bare widget lying where the editor showed a widget of `fields` back into that
 * field: into the field holding its other widgets, or into one rebuilt from what the editor
 * read. A rebuilt field is placed by its name, so put the fields the rewrite cut off from their
 * parents back first (relinkCutOffFields): until then, one may pass for a parent of that name.
 * Returns how many widgets were linked (`index` is out of date then).
 */
export function relinkBareWidgets(
  form: PDFForm,
  pages: PageIndex,
  fields: readonly FormField[],
  index: FieldIndex,
  views: readonly PageInfo[],
): number {
  const acroForm = form.acroForm.dict
  const bare = bareWidgets(pages, views)
  if (!bare.size) return 0
  const split = new Map<PDFField, PDFRef>()
  let linked = 0
  for (const field of fields) {
    const found: FoundWidget[] = []
    for (const widget of field.widgets) {
      if (index.widgetOf(widget)) continue
      const list = bare.get(widget.page) ?? []
      const offsets = list.map((b) => placeOffset(b.rect, widget.rect))
      const best = offsets.indexOf(Math.min(...offsets))
      if (best >= 0 && offsets[best] <= SAME_PLACE) found.push({ ...list.splice(best, 1)[0], widget })
    }
    if (!found.length) continue
    const target = index.findAll(field).find((f) => holdsType(f, field.type))
    let parent: PDFRef
    if (!target) parent = rebuildField(acroForm, field, found)
    else {
      parent = split.get(target) ?? target.ref
      // Without /Kids, pdf-lib takes the field for its own (only) widget.
      if (!split.has(target) && !(target.acroField.dict.lookup(KIDS) instanceof PDFArray)) {
        parent = splitMergedField(acroForm, target.ref, target.acroField.dict)
        split.set(target, parent)
      }
      const kids = acroForm.context.lookup(parent, PDFDict).lookup(KIDS, PDFArray)
      for (const w of found) kids.push(w.ref)
    }
    for (const w of found) {
      // What it kept of a field merged with it would make it a field of its own under this one
      // (/T), or show over this field's value: pdf.js reads /V and /DV from the widget first, and
      // a list box's selection (/I) from the widget alone, ahead of /V. This field holds the
      // value, and writing it keeps the field's own /I in step.
      for (const key of [T, V, DV, I]) w.dict.delete(key)
      // That field's own trigger events and place in the calculation order are this field's now.
      moveFieldEvents(w.dict, acroForm.context.lookup(parent, PDFDict))
      replaceInList(acroForm.lookup(CO), w.ref, parent)
      w.dict.set(PARENT, parent)
    }
    linked += found.length
  }
  if (linked) ensureFieldDefaults(acroForm)
  return linked
}

/**
 * The rewrite keeps a field's parents only as far as /Fields reaches them: a field merged with
 * its widget that the editor showed as "p1.name", with p1 missing from /Fields, comes out on its
 * own as "name" (and two such fields read as one). Puts the topmost field above each of
 * `fields` whose name lost its first parts back under parent fields of those names (found by
 * name, or created). Returns how many fields were moved (`index` is out of date then).
 */
export function relinkCutOffFields(form: PDFForm, fields: readonly FormField[], index: FieldIndex): number {
  const acroForm = form.acroForm.dict
  const context = acroForm.context
  const list = acroForm.lookup(FIELDS)
  if (!(list instanceof PDFArray)) return 0
  // All of them leave the list before any is put back: one that is still to move must not be
  // taken for the parent of another.
  const cutOff: { ref: PDFRef; top: PDFDict; parents: string[] }[] = []
  for (const field of fields) {
    for (const target of index.findAll(field)) {
      const name = qualifiedName(target.acroField.dict)
      if (!name || !field.name.endsWith(`.${name}`) || !holdsType(target, field.type)) continue
      // The parents were lost above the topmost field.
      let ref = target.ref
      let top = target.acroField.dict
      const seen = new Set([ref])
      for (let up = top.get(PARENT); up instanceof PDFRef && !seen.has(up); up = top.get(PARENT)) {
        const parent = context.lookup(up)
        if (!(parent instanceof PDFDict)) break
        seen.add(up)
        ref = up
        top = parent
      }
      const at = list.indexOf(ref)
      // Under a new parent, a field without /T would pass for a widget (pdf-lib tells them apart by /T).
      if (at === undefined || !top.has(T)) continue
      list.remove(at)
      cutOff.push({ ref, top, parents: field.name.slice(0, -name.length - 1).split('.') })
    }
  }
  for (const { ref, top, parents } of cutOff) {
    const place = parentFields(acroForm, parents)
    place.kids.push(ref)
    if (place.parent) top.set(PARENT, place.parent)
  }
  return cutOff.length
}
