import { describe, expect, it } from 'vitest'
import type { Element, FormField } from '../../model/types'
import { fitInside } from './signatureTarget'
import { formIsDirty, formProgress, nextEmptyField, visibleFieldNames } from './progress'
import { widgetSigned } from './signed'
import { widgetsOnPage } from './pageWidgets'

const rect = { x: 10, y: 10, width: 100, height: 20 }
const field = (name: string, over: Partial<FormField> = {}): FormField => ({
  name,
  type: 'text',
  widgets: [{ id: `${name}-w`, page: 0, rect }],
  readOnly: false,
  required: false,
  defaultValue: '',
  ...over,
})

const fields: FormField[] = [
  field('a', { required: true }),
  field('b', { type: 'checkbox', defaultValue: false }),
  field('c', { readOnly: true, defaultValue: 'fixed' }),
  field('d', { type: 'listbox', defaultValue: [] }),
  field('sig', { type: 'signature', widgets: [{ id: 'sig-w', page: 1, rect: { x: 0, y: 0, width: 200, height: 40 } }] }),
]

const signature: Element = { id: 's', kind: 'image', page: 1, x: 50, y: 5, width: 100, height: 30, role: 'signature', assetId: 'x', opacity: 1 }

describe('form progress', () => {
  it('counts fillable fields, required ones and signatures', () => {
    expect(formProgress(fields, {}, [])).toEqual({ total: 4, filled: 0, required: 1, requiredFilled: 0 })
    expect(formProgress(fields, { a: 'x', b: true, d: ['1'] }, [signature])).toEqual({ total: 4, filled: 4, required: 1, requiredFilled: 1 })
  })

  it('filters rows but keeps the active field visible', () => {
    expect(visibleFieldNames(fields, 'required', {}, [], null)).toEqual(['a'])
    expect(visibleFieldNames(fields, 'empty', { a: 'x' }, [], null)).toEqual(['b', 'd', 'sig'])
    expect(visibleFieldNames(fields, 'empty', { a: 'x' }, [], 'a')).toEqual(['a', 'b', 'd', 'sig'])
  })

  it('finds the next empty field, wrapping around', () => {
    expect(nextEmptyField(fields, {}, [], null)?.name).toBe('a')
    expect(nextEmptyField(fields, {}, [], 'b')?.name).toBe('d')
    expect(nextEmptyField(fields, { a: 'x' }, [signature], 'd')?.name).toBe('b')
    expect(nextEmptyField(fields, { a: 'x', b: true, d: ['1'] }, [signature], 'a')).toBeUndefined()
  })

  it('detects changes from the PDF values', () => {
    expect(formIsDirty(fields, { a: '', b: false })).toBe(false)
    expect(formIsDirty(fields, { d: ['1'] })).toBe(true)
  })
})

describe('signature targets', () => {
  it('fits an image inside the field (contain, centered)', () => {
    expect(fitInside({ x: 0, y: 0, width: 200, height: 40 }, 4)).toEqual({ center: { x: 100, y: 20 }, width: 160 })
    expect(fitInside({ x: 0, y: 0, width: 200, height: 40 }, 10)).toEqual({ center: { x: 100, y: 20 }, width: 200 })
  })

  it('knows when a field is signed', () => {
    expect(widgetSigned([signature], fields[4].widgets[0])).toBe(true)
    expect(widgetSigned([{ ...signature, page: 0 }], fields[4].widgets[0])).toBe(false)
  })
})

describe('widgetsOnPage', () => {
  it('lists widgets per page in reading order', () => {
    const list = [field('right', { widgets: [{ id: 'r', page: 0, rect: { ...rect, x: 300 } }] }), field('left')]
    expect(widgetsOnPage(list, 0).map((w) => w.field.name)).toEqual(['left', 'right'])
    expect(widgetsOnPage(list, 3)).toEqual([])
  })
})
