import { describe, expect, it } from 'vitest'
import type { FormField } from '../../model/types'
import {
  countChangedFields,
  countFilledFields,
  defaultBaseName,
  finalFileName,
  formatFileSize,
  isOpenShortcut,
  isSaveShortcut,
  plural,
  progressLabel,
  quotedList,
  unwrittenFieldLabels,
} from './exportFile'

const field = (name: string, type: FormField['type'], defaultValue: FormField['defaultValue'] = ''): FormField => ({
  name,
  type,
  widgets: [],
  readOnly: false,
  required: false,
  defaultValue,
})

describe('file names', () => {
  it('suggests "<name>-filled"', () => {
    expect(defaultBaseName('Lease Agreement.PDF')).toBe('Lease Agreement-filled')
    expect(defaultBaseName('טופס.pdf')).toBe('טופס-filled')
  })

  it('always ends in a single .pdf and strips characters file systems reject', () => {
    expect(finalFileName('report', 'x.pdf')).toBe('report.pdf')
    expect(finalFileName('report.pdf', 'x.pdf')).toBe('report.pdf')
    expect(finalFileName('a/b\\c:d*e?"f"<g>|h', 'x.pdf')).toBe('a-b-c-d-e-f-g-h.pdf')
    expect(finalFileName('  spaced   out  ', 'x.pdf')).toBe('spaced out.pdf')
    expect(finalFileName('...hidden.', 'x.pdf')).toBe('hidden.pdf')
    expect(finalFileName('טופס מלא', 'x.pdf')).toBe('טופס מלא.pdf')
  })

  it('falls back to the default when nothing usable is left', () => {
    expect(finalFileName('', 'contract.pdf')).toBe('contract-filled.pdf')
    expect(finalFileName(' .pdf ', 'contract.pdf')).toBe('contract-filled.pdf')
    expect(finalFileName('///', 'contract.pdf')).toBe('contract-filled.pdf')
  })
})

describe('summary counts', () => {
  const fields = [
    field('name', 'text'),
    field('agree', 'checkbox', false),
    field('color', 'radio', 'Off'),
    field('city', 'dropdown', 'Haifa'),
    field('tags', 'listbox', []),
    field('sig', 'signature'),
    field('btn', 'button'),
  ]

  it('counts fields that will carry a value', () => {
    expect(countFilledFields(fields, { name: '', agree: false, color: 'Off', city: 'Haifa', tags: [] })).toBe(1)
    expect(countFilledFields(fields, { name: 'Ada', agree: true, color: 'blue', city: 'Haifa', tags: ['a'], sig: 'x', btn: 'y' })).toBe(5)
    expect(countFilledFields(fields, { name: '   ' })).toBe(0)
  })

  it('counts fields the user changed', () => {
    expect(countChangedFields(fields, { name: '', agree: false, color: 'Off', city: 'Haifa', tags: [] })).toBe(0)
    expect(countChangedFields(fields, { name: 'Ada', city: 'Tel Aviv', tags: [] })).toBe(2)
  })

  it('pluralizes', () => {
    expect(plural(1, 'page')).toBe('1 page')
    expect(plural(2, 'page')).toBe('2 pages')
    expect(plural(0, 'item')).toBe('0 items')
    expect(plural(1200, 'page')).toBe(`${(1200).toLocaleString()} pages`)
  })
})

describe('progress and sizes', () => {
  it('describes each phase', () => {
    expect(progressLabel(null)).toMatch(/Preparing/)
    expect(progressLabel({ phase: 'forms', done: 0, total: 0 })).toMatch(/form fields/)
    expect(progressLabel({ phase: 'pages', done: 2, total: 12 })).toBe('Adding your changes… page 3 of 12')
    expect(progressLabel({ phase: 'pages', done: 0, total: 1 })).toBe('Adding your changes…')
    expect(progressLabel({ phase: 'save', done: 1, total: 1 })).toBe('Saving…')
  })

  it('formats file sizes', () => {
    expect(formatFileSize(900)).toBe('900 B')
    expect(formatFileSize(1500)).toBe('1 KB')
    expect(formatFileSize(250 * 1024)).toBe('250 KB')
    expect(formatFileSize(3.25 * 1024 * 1024)).toBe('3.3 MB')
    expect(formatFileSize(42 * 1024 * 1024)).toBe('42 MB')
  })
})

describe('isSaveShortcut', () => {
  const key = (k: Partial<KeyboardEvent>) => ({ key: 's', code: 'KeyS', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...k })

  it('uses ⌘ on Mac and Ctrl elsewhere', () => {
    expect(isSaveShortcut(key({ ctrlKey: true }), false)).toBe(true)
    expect(isSaveShortcut(key({ metaKey: true }), true)).toBe(true)
    expect(isSaveShortcut(key({ metaKey: true }), false)).toBe(false)
    expect(isSaveShortcut(key({ ctrlKey: true }), true)).toBe(false)
  })

  it('works on non-Latin layouts and ignores modified variants', () => {
    expect(isSaveShortcut(key({ ctrlKey: true, key: 'ד' }), false)).toBe(true)
    expect(isSaveShortcut(key({ ctrlKey: true, shiftKey: true }), false)).toBe(false)
    expect(isSaveShortcut(key({ ctrlKey: true, altKey: true }), false)).toBe(false)
    expect(isSaveShortcut(key({ ctrlKey: true, key: 'd', code: 'KeyD' }), false)).toBe(false)
  })

  it('also recognizes ⌘O / Ctrl+O, on any layout', () => {
    expect(isOpenShortcut(key({ ctrlKey: true, key: 'o', code: 'KeyO' }), false)).toBe(true)
    expect(isOpenShortcut(key({ metaKey: true, key: 'o', code: 'KeyO' }), true)).toBe(true)
    expect(isOpenShortcut(key({ ctrlKey: true, key: 'ם', code: 'KeyO' }), false)).toBe(true)
    expect(isOpenShortcut(key({ ctrlKey: true }), false)).toBe(false)
    expect(isOpenShortcut(key({ key: 'o', code: 'KeyO' }), false)).toBe(false)
  })
})

describe('fields the export could not write', () => {
  const fields = [{ ...field('applicant.last_name', 'text'), label: 'Last name' }, field('address.city', 'text'), field('zip', 'text', '123')]

  it('lists the ones the user changed, by label', () => {
    const values = { 'applicant.last_name': 'Lovelace', 'address.city': 'London', zip: '123' }
    expect(unwrittenFieldLabels(fields, values, ['applicant.last_name', 'address.city', 'zip'])).toEqual(['Last name', 'City'])
    expect(unwrittenFieldLabels(fields, values, [])).toEqual([])
    expect(unwrittenFieldLabels(fields, { 'address.city': '' }, ['address.city'])).toEqual([])
  })

  it('quotes names in a short list', () => {
    expect(quotedList(['Name'])).toBe('“Name”')
    expect(quotedList(['Name', 'City'])).toBe('“Name” and “City”')
    expect(quotedList(['A', 'B', 'C'])).toBe('“A”, “B” and “C”')
    expect(quotedList(['A', 'B', 'C', 'D', 'E'])).toBe('“A”, “B”, “C” and 2 more')
  })
})

describe('file name edge cases', () => {
  it('does not leave separators at the ends', () => {
    expect(finalFileName('final?', 'x.pdf')).toBe('final.pdf')
    expect(finalFileName('Mój wniosek / final?', 'x.pdf')).toBe('Mój wniosek - final.pdf')
    expect(finalFileName('-draft-', 'x.pdf')).toBe('draft.pdf')
  })
})
