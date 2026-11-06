import { describe, expect, it } from 'vitest'
import type { FormField } from '../../../model/types'
import { baseDirection, bidiParagraph, hasRtl, visualOrder } from './bidi'
import { fieldLabel, humanizeFieldName, optionLabel } from './labels'
import { readingOrder } from './order'
import {
  combLayout,
  multiLineLayout,
  resolveAlign,
  singleLineBaseline,
  singleLineFontSize,
  wrapParagraph,
} from './textLayout'
import { coerceValue, isValueFilled, valuesEqual } from './values'

/** 0.5em per character — easy to reason about. */
const measure = (s: string, size: number) => [...s].length * size * 0.5

describe('humanizeFieldName', () => {
  it.each([
    ['applicant.first_name', 'First name'],
    ['form1[0].page1[0].txtDateOfBirth[0]', 'Date of birth'],
    ['Check Box12', 'Check box 12'],
    ['SSNNumber', 'SSN number'],
    ['address.1', 'Address 1'],
    ['Text1', 'Text 1'],
    ['email-address', 'Email address'],
    ['applicant.id_number', 'ID number'],
    ['dob', 'DOB'],
    ['zipCode', 'ZIP code'],
    ['employment.status', 'Employment status'],
    ['form1[0].Page1[0].Name[0]', 'Name'],
    ['שם_פרטי', 'שם פרטי'],
    ['', 'Untitled field'],
  ])('%s → %s', (name, label) => expect(humanizeFieldName(name)).toBe(label))

  it('prefers the PDF tooltip', () => {
    expect(fieldLabel({ name: 'f1_01', label: '  Your  first name ' })).toBe('Your first name')
    expect(fieldLabel({ name: 'f1_01' })).toBe('F 1 01')
    expect(optionLabel('Choice_1')).toBe('Choice 1')
  })
})

describe('readingOrder', () => {
  const box = (page: number, x: number, y: number, h = 20) => ({ page, rect: { x, y, width: 50, height: h } })
  it('sorts by page, rows (with tolerance), then x', () => {
    const items = [box(1, 0, 0), box(0, 300, 102), box(0, 10, 100), box(0, 10, 200), box(0, 200, 95, 10)]
    expect(readingOrder(items, (b) => b)).toEqual([box(0, 10, 100), box(0, 200, 95, 10), box(0, 300, 102), box(0, 10, 200), box(1, 0, 0)])
  })
})

describe('bidi', () => {
  it('detects direction from the first strong character', () => {
    expect(baseDirection('123 שלום')).toBe('rtl')
    expect(baseDirection('Hi שלום')).toBe('ltr')
    expect(baseDirection('123')).toBe('ltr')
    expect(hasRtl('abc')).toBe(false)
  })

  it.each([
    ['שלום 123', 'rtl', '123 םולש'],
    ['Hello שלום', 'ltr', 'Hello םולש'],
    ['(שלום)', 'rtl', '(םולש)'],
    ['מחיר: 42.50 ₪', 'rtl', '₪ 42.50 :ריחמ'],
    ['abc', 'ltr', 'abc'],
  ] as const)('%s → %s', (text, dir, visual) => expect(visualOrder(text, dir).shown).toBe(visual))

  it('keeps combining marks after their base and drops bidi controls', () => {
    // bet + dagesh, then shin: marks stay attached to the base letter after reversal.
    expect(visualOrder('בּש', 'rtl').shown).toBe('שבּ')
    expect(visualOrder('‏abc‎', 'ltr')).toEqual({ shown: 'abc', typed: 'abc' })
  })

  it('gives each line as typed too: the same characters, brackets not mirrored', () => {
    expect(visualOrder('(לא חובה)', 'rtl')).toEqual({ shown: '(הבוח אל)', typed: ')הבוח אל(' })
    expect(visualOrder('שָׁלוֹם (לא חובה)', 'rtl')).toEqual({ shown: '(הבוח אל) םוֹלשָׁ', typed: ')הבוח אל( םוֹלשָׁ' })
    // An RLM is dropped from both, which stay aligned; brackets in a left-to-right run aren't mirrored.
    expect(visualOrder('‏[x] {שלום}', 'ltr')).toEqual({ shown: '[x] {םולש}', typed: '[x] {םולש}' })
    expect(visualOrder('מספר ‏(123)', 'rtl')).toEqual({ shown: '(123) רפסמ', typed: ')123( רפסמ' })
  })

  it('reorders wrapped lines independently', () => {
    const p = 'תאריך: 31/10/2026'
    const b = bidiParagraph(p, 'rtl')
    expect(b.line(0, 6).shown).toBe(':ךיראת')
    expect(b.line(7, p.length).shown).toBe('31/10/2026')
    expect(bidiParagraph('(א) ב', 'rtl').line(0, 3)).toEqual({ shown: '(א)', typed: ')א(' })
  })
})

describe('field text layout', () => {
  it('auto-sizes single-line text from the height and shrinks long text to fit', () => {
    expect(singleLineFontSize('Hi', { width: 200, height: 20 }, measure)).toBe(12)
    expect(singleLineFontSize('Hi', { width: 200, height: 12 }, measure)).toBe(8.16)
    // 40 chars × 0.5em must fit 196pt → 9.8pt
    expect(singleLineFontSize('x'.repeat(40), { width: 200, height: 20 }, measure)).toBe(9.8)
    expect(singleLineFontSize('x', { width: 200, height: 20, fontSize: 9 }, measure)).toBe(9)
    // An explicit size never exceeds what the height can show.
    expect(singleLineFontSize('x', { width: 200, height: 10, fontSize: 30 }, measure)).toBeLessThan(10)
  })

  it('centers single-line baselines vertically', () => {
    const b = singleLineBaseline(20, 10)
    expect(b).toBeGreaterThan(10)
    expect(b).toBeLessThan(16)
  })

  it('wraps words greedily and breaks words longer than a line', () => {
    // width 10 chars at size 2 (1pt per char)
    expect(wrapParagraph('aaa bbb ccc', 8, 2, measure)).toEqual([[0, 8], [8, 11]])
    expect(wrapParagraph('abcdefghij', 4, 2, measure)).toEqual([[0, 4], [4, 8], [8, 10]])
    expect(wrapParagraph('', 4, 2, measure)).toEqual([[0, 0]])
  })

  it('breaks where a <textarea> does: after hyphens and dashes, not at no-break spaces', () => {
    // 1pt per char at size 2; the browser's breaks are checked in e2e/forms-fixes.spec.ts.
    const lines = (text: string, width: number) => wrapParagraph(text, width, 2, measure).map(([s, e]) => text.slice(s, e))
    expect(lines('state-of-the-art, well-known', 10)).toEqual(['state-of-', 'the-art, ', 'well-known'])
    expect(lines('state-of-the-art, well-known', 8)).toEqual(['state-', 'of-the-', 'art, ', 'well-', 'known'])
    expect(lines('https://example.com/a-long-page?x=1', 22)).toEqual(['https://example.com/a-', 'long-page?x=1'])
    expect(lines('call 555-0100 or 2026-10-31', 9)).toEqual(['call 555-', '0100 or ', '2026-10-', '31'])
    expect(lines('word—word', 6)).toEqual(['word—', 'word'])
    expect(lines('תל-אביב', 5)).toEqual(['תל-', 'אביב'])
    // No break: a sign, a Hebrew prefix before a number, a no-break space.
    expect(lines('x -55', 3)).toEqual(['x ', '-55'])
    expect(lines('ב-2020', 4)).toEqual(['ב-20', '20'])
    expect(lines('ab c\u00a0d', 4)).toEqual(['ab ', 'c\u00a0d'])
  })

  it('shrinks auto-sized multi-line text until it fits', () => {
    const short = multiLineLayout('one\ntwo', { width: 200, height: 60 }, measure)
    expect(short.fontSize).toBe(10)
    expect(short.lines).toHaveLength(2)
    const long = multiLineLayout('word '.repeat(80), { width: 200, height: 60 }, measure)
    expect(long.fontSize).toBeLessThan(10)
    expect(long.lines.length * long.fontSize * 1.15).toBeLessThanOrEqual(56.01)
  })

  it('fits comb characters into their cells', () => {
    const { fontSize, cellWidth } = combLayout({ width: 100, height: 20, maxLength: 10 })
    expect(cellWidth).toBe(10)
    expect(fontSize * (1229 / 2048)).toBeLessThanOrEqual(10)
  })

  it('treats the default alignment as "start"', () => {
    expect(resolveAlign(undefined, 'rtl')).toBe('right')
    expect(resolveAlign('left', 'rtl')).toBe('right')
    expect(resolveAlign('left', 'ltr')).toBe('left')
    expect(resolveAlign('center', 'rtl')).toBe('center')
  })
})

describe('values', () => {
  const text = { type: 'text' } as FormField
  const box = { type: 'checkbox' } as FormField
  const list = { type: 'listbox' } as FormField
  it('compares and coerces', () => {
    expect(valuesEqual(['a'], ['a'])).toBe(true)
    expect(valuesEqual(['a'], ['b'])).toBe(false)
    expect(coerceValue(box, 'Yes')).toBe(true)
    expect(coerceValue(box, 'Off')).toBe(false)
    expect(coerceValue(list, 'x')).toEqual(['x'])
    expect(coerceValue(text, ['x'])).toBe('x')
    expect(coerceValue(text, true)).toBe('')
  })
  it('decides what counts as filled', () => {
    expect(isValueFilled(text, '  ')).toBe(false)
    expect(isValueFilled(text, 'a')).toBe(true)
    expect(isValueFilled(box, false)).toBe(false)
    expect(isValueFilled(list, [])).toBe(false)
  })
})
