import type { FormField, FormValue, FormValues } from '../../../model/types'

/** Structural equality for form values (arrays compare element-wise, order-sensitive). */
export function valuesEqual(a: FormValue | undefined, b: FormValue | undefined): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i])
  return false
}

/**
 * Coerces whatever is stored (possibly from an older session) into the shape the field type
 * expects: text/dropdown/radio/signature → string, checkbox → boolean, listbox → string[].
 */
export function coerceValue(field: Pick<FormField, 'type'>, value: FormValue | undefined): FormValue {
  switch (field.type) {
    case 'checkbox':
      return value === true || (typeof value === 'string' && value !== '' && value !== 'Off')
    case 'listbox':
      if (Array.isArray(value)) return value.filter((v) => typeof v === 'string')
      return typeof value === 'string' && value ? [value] : []
    default:
      if (typeof value === 'string') return value
      if (Array.isArray(value)) return value[0] ?? ''
      return ''
  }
}

/** The stored value of a field, if any (own properties only: a field may be called "__proto__"). */
export function storedValue(values: FormValues, name: string): FormValue | undefined {
  return Object.hasOwn(values, name) ? values[name] : undefined
}

/** The effective value of a field: stored value (coerced) or the value the PDF came with. */
export function fieldValue(field: FormField, values: FormValues): FormValue {
  const v = storedValue(values, field.name)
  return v === undefined ? field.defaultValue : coerceValue(field, v)
}

/** Whether a field counts as "filled" for progress / navigation. Signatures are decided elsewhere. */
export function isValueFilled(field: Pick<FormField, 'type'>, value: FormValue | undefined): boolean {
  const v = coerceValue(field, value)
  if (typeof v === 'boolean') return v
  if (Array.isArray(v)) return v.length > 0
  return v.trim() !== ''
}

/** Fields the user can actually fill (excludes read-only fields and push buttons). */
export function isFillable(field: FormField): boolean {
  return !field.readOnly && field.type !== 'button'
}
