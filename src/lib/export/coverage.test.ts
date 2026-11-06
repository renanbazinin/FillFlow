import { describe, expect, it } from 'vitest'
import type { Element, FormField } from '../../model/types'
import { fieldsUnderItems } from './coverage'

const field = (name: string, page: number, x: number, y: number, width = 100, height = 20): FormField => ({
  name,
  type: 'text',
  widgets: [{ id: `${name}-w`, page, rect: { x, y, width, height } }],
  readOnly: false,
  required: false,
  defaultValue: '',
})

const mark = (page: number, x: number, y: number): Element => ({ id: `m${x}${y}`, kind: 'mark', page, x, y, width: 14, height: 14, shape: 'check', color: '#111827' })

describe('fieldsUnderItems', () => {
  const fields = [field('name', 0, 100, 100), field('sig', 0, 100, 200, 160, 40), field('other', 1, 100, 100)]

  it('lists the fields an item overlaps, on the same page only', () => {
    expect(fieldsUnderItems(fields, [mark(0, 150, 105)])).toEqual(['name'])
    expect(fieldsUnderItems(fields, [mark(1, 150, 105)])).toEqual(['other'])
    expect(fieldsUnderItems(fields, [mark(0, 150, 105), mark(0, 180, 210)])).toEqual(['name', 'sig'])
    expect(fieldsUnderItems(fields, [])).toEqual([])
  })

  it('ignores items that only touch a field', () => {
    // Right next to the field's right edge, and just touching its bottom edge.
    expect(fieldsUnderItems(fields, [mark(0, 200, 105), mark(0, 150, 119.8)])).toEqual([])
  })

  it('counts the stroke of lines and ink', () => {
    const line: Element = { id: 'l', kind: 'shape', page: 0, x: 120, y: 96, width: 60, height: 0, shape: 'line', strokeColor: '#000000', fillColor: null, strokeWidth: 10, opacity: 1 }
    expect(fieldsUnderItems(fields, [line])).toEqual(['name'])
  })
})
