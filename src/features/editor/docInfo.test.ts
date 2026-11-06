import { describe, expect, it } from 'vitest'
import type { FormField } from '../../model/types'
import { fillableFieldCount, formFieldsMessage } from './docInfo'

const field = (name: string, type: FormField['type']): FormField => ({
  name,
  type,
  widgets: [],
  readOnly: false,
  required: false,
  defaultValue: '',
})

describe('docInfo', () => {
  it('counts fillable fields (not push buttons)', () => {
    expect(fillableFieldCount(undefined)).toBe(0)
    expect(fillableFieldCount([field('a', 'text'), field('b', 'checkbox'), field('c', 'button'), field('d', 'signature')])).toBe(3)
  })

  it('words the first-open toast', () => {
    expect(formFieldsMessage(1)).toBe('1 fillable field found — click a field to type')
    expect(formFieldsMessage(12)).toBe('12 fillable fields found — click a field to type')
    expect(formFieldsMessage(2, true)).toBe('2 fillable fields found — tap a field to type')
  })
})
