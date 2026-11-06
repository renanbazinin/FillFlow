import { describe, expect, it } from 'vitest'
import { initialsFrom, textDirection } from './text'

describe('initialsFrom', () => {
  it('takes the first letter of each word', () => {
    expect(initialsFrom('John Smith')).toBe('JS')
    expect(initialsFrom('  ada   lovelace ')).toBe('AL')
    expect(initialsFrom('Madonna')).toBe('M')
  })

  it('treats hyphenated parts as words and caps the length', () => {
    expect(initialsFrom('Jean-Luc Picard')).toBe('JLP')
    expect(initialsFrom('John Ronald Reuel Tolkien')).toBe('JRR')
    expect(initialsFrom('John Ronald Reuel Tolkien', 4)).toBe('JRRT')
  })

  it('skips punctuation and digits', () => {
    expect(initialsFrom('(Dr.) 2nd Alice Brown')).toBe('DNA')
    expect(initialsFrom('')).toBe('')
    expect(initialsFrom('123 ...')).toBe('')
  })

  it('works for Hebrew and other scripts', () => {
    expect(initialsFrom('ישראל ישראלי')).toBe('יי')
    expect(initialsFrom('Ольга Петрова')).toBe('ОП')
    expect(initialsFrom('émile zola')).toBe('ÉZ')
  })
})

describe('textDirection', () => {
  it('uses the first strong character', () => {
    expect(textDirection('John')).toBe('ltr')
    expect(textDirection('שלום')).toBe('rtl')
    expect(textDirection('123 שלום abc')).toBe('rtl')
    expect(textDirection('  abc שלום')).toBe('ltr')
    expect(textDirection('مرحبا')).toBe('rtl')
    expect(textDirection('')).toBe('ltr')
  })
})
