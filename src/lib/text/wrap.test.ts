import { describe, expect, it } from 'vitest'
import type { TextMeasurer, TextStyle } from './layout'
import { wrapText } from './wrap'

// Every UTF-16 unit is half an em wide: 5pt at 10pt.
const measure: TextMeasurer = (text, _f, _b, size) => text.length * size * 0.5
const style: TextStyle = { fontId: 'sans', bold: false, fontSize: 10, lineHeight: 1.2, letterSpacing: 0 }

describe('wrapText', () => {
  it('breaks lines too wide between words, where the spaces were, and leaves lines that fit', () => {
    // 50pt holds 10 characters.
    expect(wrapText('one two three four five', style, 50, measure)).toBe('one two\nthree four\nfive')
    expect(wrapText('short\none two three four five', style, 50, measure)).toBe('short\none two\nthree four\nfive')
    expect(wrapText('fits fine', style, 50, measure)).toBe('fits fine')
    // Several spaces at a break all go; the indent of the first line stays.
    expect(wrapText('  one two    three', style, 50, measure)).toBe('  one two\nthree')
  })

  it('breaks a word wider than a line between characters, never inside one', () => {
    expect(wrapText('abcdefghijklmnopqrstuvwxyz', style, 50, measure)).toBe('abcdefghij\nklmnopqrst\nuvwxyz')
    // "שָׁ" is one character (shin with its qamats and shin dot), 3 units wide here.
    const shin = 'שָׁ'
    expect(wrapText(shin.repeat(4), style, 50, measure)).toBe(`${shin.repeat(3)}\n${shin}`)
  })

  it('breaks right-to-left text in reading order', () => {
    expect(wrapText('רחוב הרצל 12, תל אביב-יפו', style, 50, measure)).toBe('רחוב הרצל\n12, תל\nאביב-יפו')
  })

  it('counts letter spacing as the layout does', () => {
    // 10pt per character with 5pt of spacing.
    expect(wrapText('aa bb cc', { ...style, letterSpacing: 5 }, 50, measure)).toBe('aa bb\ncc')
  })
})
