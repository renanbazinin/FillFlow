import { describe, expect, it } from 'vitest'
import type { TextMeasurer, TextStyle } from '../../../lib/text/layout'
import { caretIndexAt } from './caret'

// Every UTF-16 unit is 6pt wide at 12pt.
const measure: TextMeasurer = (text, _f, _b, size) => text.length * size * 0.5
const style: TextStyle = { fontId: 'sans', bold: false, fontSize: 12, lineHeight: 1.25, letterSpacing: 0 }
const line = 15 // 12 * 1.25

describe('caretIndexAt', () => {
  it('finds the nearest character boundary on the clicked line', () => {
    expect(caretIndexAt('hello', style, 'left', { x: 0, y: 5 }, measure)).toBe(0)
    expect(caretIndexAt('hello', style, 'left', { x: 2, y: 5 }, measure)).toBe(0)
    expect(caretIndexAt('hello', style, 'left', { x: 4, y: 5 }, measure)).toBe(1)
    expect(caretIndexAt('hello', style, 'left', { x: 17, y: 5 }, measure)).toBe(3)
    expect(caretIndexAt('hello', style, 'left', { x: 999, y: 5 }, measure)).toBe(5)
  })

  it('accounts for line offsets, alignment and letter spacing', () => {
    // Second line starts at index 6.
    expect(caretIndexAt('hello\nab', style, 'left', { x: 7, y: line + 2 }, measure)).toBe(7)
    // Right aligned: "ab" (12pt) sits at x = 18 in a 30pt block.
    expect(caretIndexAt('hello\nab', style, 'right', { x: 19, y: line + 2 }, measure)).toBe(6)
    expect(caretIndexAt('hello\nab', style, 'right', { x: 26, y: line + 2 }, measure)).toBe(7)
    expect(caretIndexAt('hello\nab', style, 'right', { x: 28, y: line + 2 }, measure)).toBe(8)
    const spaced = { ...style, letterSpacing: 4 }
    // Characters advance 10pt each.
    expect(caretIndexAt('abc', spaced, 'left', { x: 16, y: 1 }, measure)).toBe(2)
  })

  it('clamps rows and, without a DOM to lay them out, puts the caret at the end of RTL lines', () => {
    expect(caretIndexAt('ab\ncd', style, 'left', { x: 0, y: 500 }, measure)).toBe(3)
    expect(caretIndexAt('ab\ncd', style, 'left', { x: 0, y: -50 }, measure)).toBe(0)
    expect(caretIndexAt('שלום\nab', style, 'left', { x: 1, y: 2 }, measure)).toBe(4)
    expect(caretIndexAt('', style, 'left', { x: 10, y: 2 }, measure)).toBe(0)
  })

  it('never puts the caret between a letter and its combining marks', () => {
    // "e" + combining acute is one 12pt cluster; letter spacing comes once per cluster.
    expect(caretIndexAt('e\u0301te', style, 'left', { x: 8, y: 2 }, measure)).toBe(2)
    expect(caretIndexAt('e\u0301te', { ...style, letterSpacing: 4 }, 'left', { x: 23, y: 2 }, measure)).toBe(3)
  })

  it('never splits surrogate pairs', () => {
    // '😀' is two UTF-16 units → 12pt wide with this measurer.
    expect(caretIndexAt('a😀b', style, 'left', { x: 13, y: 2 }, measure)).toBe(3)
    expect(caretIndexAt('a😀b', style, 'left', { x: 8, y: 2 }, measure)).toBe(1)
  })
})
