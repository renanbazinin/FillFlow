import { describe, expect, it } from 'vitest'
import { charCount, graphemes, layoutTextBlock, type TextMeasurer, type TextStyle } from './layout'

// Every UTF-16 unit is half an em wide.
const measure: TextMeasurer = (text, _f, _b, size) => text.length * size * 0.5
const style: TextStyle = { fontId: 'sans', bold: false, fontSize: 10, lineHeight: 1.2, letterSpacing: 0 }

/** "שָׁלוֹם": shin + qamats + shin dot, lamed, vav + holam, final mem (canonical order). */
const SHALOM = '\u05E9\u05B8\u05C1\u05DC\u05D5\u05B9\u05DD'

describe('charCount', () => {
  it('counts grapheme clusters, so marks share their letter’s spacing', () => {
    expect(charCount('abc')).toBe(3)
    expect(charCount(SHALOM)).toBe(4)
    // "é" written as e + combining acute (as pasted from macOS).
    expect(charCount('e\u0301te')).toBe(3)
    expect(charCount('\u{1F44D}\u{1F3FD} ok')).toBe(4)
    expect(charCount('')).toBe(0)
  })

  it('skips invisible characters, as browsers do', () => {
    expect(charCount('a\u200Fb')).toBe(2)
    expect(charCount('\u202B\u05E9\u05DC\u05D5\u05DD\u202C')).toBe(4)
    expect(charCount('a\u200Db\u00AD')).toBe(2)
  })

  it('splits text into grapheme clusters', () => {
    expect(graphemes(SHALOM.slice(0, 4))).toEqual(['\u05E9\u05B8\u05C1', '\u05DC'])
    expect(graphemes('e\u0301t')).toEqual(['e\u0301', 't'])
  })
})

describe('layoutTextBlock', () => {
  it('adds letter spacing once per grapheme cluster', () => {
    const spaced = { ...style, letterSpacing: 2 }
    const plain = layoutTextBlock('e\u0301te', style, 'left', measure)
    const layout = layoutTextBlock('e\u0301te', spaced, 'left', measure)
    expect(layout.width).toBeCloseTo(plain.width + 3 * 2)
    // Right alignment uses the same widths.
    const right = layoutTextBlock('e\u0301te\nab', spaced, 'right', measure)
    expect(right.lines[1].x).toBeCloseTo(right.width - (10 + 2 * 2))
  })
})
