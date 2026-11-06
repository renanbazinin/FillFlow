import { describe, expect, it } from 'vitest'
import { firstStrongDirection } from './direction'

describe('firstStrongDirection', () => {
  it('goes by the first letter, as dir="auto" does', () => {
    expect(firstStrongDirection('שלום world')).toBe('rtl')
    expect(firstStrongDirection('Hello שלום')).toBe('ltr')
    expect(firstStrongDirection('مرحبا')).toBe('rtl')
    expect(firstStrongDirection('Привет')).toBe('ltr')
  })

  it('skips digits, spaces, punctuation and marks', () => {
    expect(firstStrongDirection('12, (')).toBeNull()
    expect(firstStrongDirection('')).toBeNull()
    expect(firstStrongDirection('054-1234567 ישראל')).toBe('rtl')
    expect(firstStrongDirection('₪1,234.50 (Total)')).toBe('ltr')
    // Arabic-Indic digits are numbers, not letters.
    expect(firstStrongDirection('١٢٣')).toBeNull()
    // Niqqud alone has no direction; the letter it sits on has.
    expect(firstStrongDirection('ָ')).toBeNull()
    expect(firstStrongDirection('שָׁלוֹם')).toBe('rtl')
  })

  it('follows explicit direction marks', () => {
    expect(firstStrongDirection('‏12')).toBe('rtl')
    expect(firstStrongDirection('‎שלום')).toBe('ltr')
  })
})
