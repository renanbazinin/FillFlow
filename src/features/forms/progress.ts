import { isValueFilled, valuesEqual, coerceValue, storedValue } from '../../lib/pdf/forms/values'
import type { Element, FormField, FormValues } from '../../model/types'
import { fieldSigned } from './signed'

export type FieldFilter = 'all' | 'required' | 'empty'

/** Fields the user can fill (read-only fields and push buttons aren't counted). */
export function fillableFields(fields: readonly FormField[]): FormField[] {
  return fields.filter((f) => !f.readOnly && f.type !== 'button')
}

export function isFieldFilled(field: FormField, values: FormValues, elements: readonly Element[]): boolean {
  if (field.type === 'signature') return fieldSigned(elements, field)
  const v = storedValue(values, field.name)
  return isValueFilled(field, v === undefined ? field.defaultValue : v)
}

export interface FormProgress {
  total: number
  filled: number
  required: number
  requiredFilled: number
}

export function formProgress(fields: readonly FormField[], values: FormValues, elements: readonly Element[]): FormProgress {
  const p: FormProgress = { total: 0, filled: 0, required: 0, requiredFilled: 0 }
  for (const f of fillableFields(fields)) {
    const filled = isFieldFilled(f, values, elements)
    p.total++
    if (filled) p.filled++
    if (f.required) {
      p.required++
      if (filled) p.requiredFilled++
    }
  }
  return p
}

/** Names of the fields shown for a filter; `keep` (the active field) never disappears mid-edit. */
export function visibleFieldNames(
  fields: readonly FormField[],
  filter: FieldFilter,
  values: FormValues,
  elements: readonly Element[],
  keep: string | null,
): string[] {
  const out: string[] = []
  for (const f of fields) {
    if (f.type === 'button') continue
    let show = true
    if (filter === 'required') show = f.required
    else if (filter === 'empty') show = !f.readOnly && !isFieldFilled(f, values, elements)
    if (show || f.name === keep) out.push(f.name)
  }
  return out
}

/** The next unfilled fillable field after `after` (wrapping), or undefined when all are filled. */
export function nextEmptyField(
  fields: readonly FormField[],
  values: FormValues,
  elements: readonly Element[],
  after: string | null,
): FormField | undefined {
  const list = fillableFields(fields)
  const start = after ? list.findIndex((f) => f.name === after) + 1 : 0
  for (let i = 0; i < list.length; i++) {
    const f = list[(start + i) % list.length]
    if (!isFieldFilled(f, values, elements)) return f
  }
  return undefined
}

/** Whether any field differs from the value the PDF came with. */
export function formIsDirty(fields: readonly FormField[], values: FormValues): boolean {
  return fields.some((f) => {
    const v = storedValue(values, f.name)
    return v !== undefined && !valuesEqual(coerceValue(f, v), f.defaultValue)
  })
}
