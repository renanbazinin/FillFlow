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

  it('falls back to the physical key on layouts that type no Latin letters', () => {
    // Hebrew: letters, and the punctuation it types on the Q and W keys (W is Whiteout).
    expect(shortcutLetter({ key: 'ש', code: 'KeyA' })).toBe('a')
    expect(shortcutLetter({ key: "'", code: 'KeyW' })).toBe('w')
    expect(shortcutLetter({ key: '/', code: 'KeyQ' })).toBe('q')
    expect(shortcutLetter({ key: '׳', code: 'KeyW' })).toBe('w')
    // Russian, Greek, Arabic (one key types two letters), Thai (a vowel mark).
    expect(shortcutLetter({ key: 'я', code: 'KeyZ' })).toBe('z')
    expect(shortcutLetter({ key: 'ζ', code: 'KeyZ' })).toBe('z')
    expect(shortcutLetter({ key: 'لا', code: 'KeyB' })).toBe('b')
    expect(shortcutLetter({ key: 'ั', code: 'KeyY' })).toBe('y')
  })

  it('ignores punctuation and accented letters that Latin layouts put on letter keys', () => {
    // Dvorak: "," "." ";" and "'" sit on the W, E, Z and Q keys.
    expect(shortcutLetter({ key: ',', code: 'KeyW' })).toBeNull()
    expect(shortcutLetter({ key: '.', code: 'KeyE' })).toBeNull()
    expect(shortcutLetter({ key: ';', code: 'KeyZ' })).toBeNull()
    expect(shortcutLetter({ key: "'", code: 'KeyQ' })).toBeNull()
    // AZERTY ",", Colemak ";", Bépo "," and "à", Turkish F "ö", "ğ" and "ı".
    expect(shortcutLetter({ key: ',', code: 'KeyM' })).toBeNull()
    expect(shortcutLetter({ key: ';', code: 'KeyP' })).toBeNull()
    expect(shortcutLetter({ key: ',', code: 'KeyG' })).toBeNull()
    expect(shortcutLetter({ key: 'à', code: 'KeyZ' })).toBeNull()
    expect(shortcutLetter({ key: 'ö', code: 'KeyX' })).toBeNull()
    expect(shortcutLetter({ key: 'ğ', code: 'KeyE' })).toBeNull()
    expect(shortcutLetter({ key: 'ı', code: 'KeyR' })).toBeNull()
    // Dead keys and keys the browser can't name.
    expect(shortcutLetter({ key: 'Dead', code: 'KeyE' })).toBeNull()
    expect(shortcutLetter({ key: 'Unidentified', code: 'KeyE' })).toBeNull()
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
