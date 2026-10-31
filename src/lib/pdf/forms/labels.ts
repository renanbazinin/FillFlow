import type { FormField, FormFieldOption } from '../../../model/types'

/** Lowercase widget-type prefixes form designers glue onto names ("txtFirstName", "chkAgree"). */
const TYPE_PREFIX = /^(?:txt|tf|chk|chkbx|cbx|cb|rb|rdo|ddl|dd|cmb|lst|lb|btn|fld|sig)(?=[A-Z])/

/** XFA-style subscripts: "form1[0].page1[0].firstName[0]". */
const SUBSCRIPT = /\[\d+\]/g

/** Leaf names too vague on their own: "employment.status" reads better as "Employment status". */
const GENERIC = new Set(['status', 'type', 'name', 'date', 'number', 'no', 'code', 'value', 'amount', 'other', 'text', 'total', 'title', 'details', 'reason'])

/** Container names that add nothing ("form1", "page2", "topmostSubform", "Section3"…). */
const CONTAINER = /^(?:form|page|subform|topmostsubform|root|fields?|data|section|part|group)\d*$/i

/** Abbreviations that read better in capitals ("id_number" → "ID number"). */
const ACRONYMS = new Set(['id', 'ssn', 'dob', 'zip', 'pin', 'iban', 'bic', 'vat', 'tin', 'ein', 'url', 'po', 'uk', 'us', 'usa', 'eu', 'cvv', 'atm', 'gp', 'md', 'hr'])

/**
 * Turns a technical field name into a readable label:
 * "applicant.first_name" → "First name", "form1[0].txtDateOfBirth[0]" → "Date of birth",
 * "Check Box12" → "Check box 12", "SSNNumber" → "SSN number".
 */
export function humanizeFieldName(name: string): string {
  const segments = name
    .split('.')
    .map((s) => s.replace(SUBSCRIPT, '').trim())
    .filter(Boolean)
  let raw = segments.at(-1) ?? ''
  const parent = segments.length > 1 ? segments.at(-2)! : ''
  // "address.0" / "phone.1" — a bare index says nothing on its own.
  if (/^\d+$/.test(raw) && parent) raw = `${parent} ${raw}`
  else if (GENERIC.has(raw.toLowerCase()) && parent && !CONTAINER.test(parent)) raw = `${parent} ${raw}`

  const words = raw
    .replace(TYPE_PREFIX, '')
    .replace(/[_\-+]+/g, ' ')
    // camelCase and ACRONYMWord boundaries
    .replace(/([\p{Ll}\d])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
    // letters ↔ digits
    .replace(/(\p{L})(\d)/gu, '$1 $2')
    .replace(/(\d)(\p{L}{2,})/gu, '$1 $2')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase()))

  const text = words.join(' ')
  if (!text) return 'Untitled field'
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** The label shown for a field: the PDF's own tooltip (/TU) when present, else a humanized name. */
export function fieldLabel(field: Pick<FormField, 'name' | 'label'>): string {
  const label = field.label?.replace(/\s+/g, ' ').trim()
  return label || humanizeFieldName(field.name)
}

/** Readable text for a radio export value ("Choice_1" → "Choice 1"). */
export function optionLabel(value: string): string {
  const t = value.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
  return t || '(blank)'
}

/**
 * The choices of a radio field, one per value in widget order, with readable labels. Separate
 * buttons that share an export value are numbered: "Yes", "No", "Yes (2)".
 */
export function radioOptions(field: Pick<FormField, 'widgets'>): FormFieldOption[] {
  const out: FormFieldOption[] = []
  const seen = new Set<string>()
  const repeats = new Map<string, number>()
  for (const w of field.widgets) {
    const value = w.exportValue ?? ''
    if (seen.has(value)) continue
    seen.add(value)
    const label = optionLabel(w.label ?? value)
    const n = (repeats.get(label) ?? 0) + 1
    repeats.set(label, n)
    out.push({ value, label: n > 1 ? `${label} (${n})` : label })
  }
  return out
}
