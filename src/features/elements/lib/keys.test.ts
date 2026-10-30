import { describe, expect, it } from 'vitest'
import { bracketKey, shortcutLetter } from './keys'

describe('shortcutLetter', () => {
  it('uses the key for Latin layouts and the physical key otherwise', () => {
    expect(shortcutLetter({ key: 'z', code: 'KeyZ' })).toBe('z')
    expect(shortcutLetter({ key: 'Z', code: 'KeyZ' })).toBe('z')
    // Hebrew layout: the Z key types "ז".
    expect(shortcutLetter({ key: 'ז', code: 'KeyZ' })).toBe('z')
    // AZERTY: the physical Q key types "a" → follow the character.
    expect(shortcutLetter({ key: 'a', code: 'KeyQ' })).toBe('a')
    expect(shortcutLetter({ key: 'Enter', code: 'Enter' })).toBeNull()
    expect(shortcutLetter({ key: '1', code: 'Digit1' })).toBeNull()
  })
})

describe('bracketKey', () => {
  it('reads brackets by position', () => {
    expect(bracketKey({ key: '[', code: 'BracketLeft' })).toBe('[')
    expect(bracketKey({ key: ']', code: 'BracketLeft' })).toBe('[')
    expect(bracketKey({ key: ']', code: '' })).toBe(']')
    expect(bracketKey({ key: 'a', code: 'KeyA' })).toBeNull()
  })
})
