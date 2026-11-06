import { describe, expect, it } from 'vitest'
import { SIGNATURE_FONTS, SIGNATURE_FONT_BY_ID, signatureFontLabel, signatureFontScale, signatureFontStack } from './fonts'

describe('signature fonts', () => {
  it('give every style a Hebrew handwriting face of its own', () => {
    const hebrew = SIGNATURE_FONTS.map((f) => f.hebrew.family)
    expect(new Set(hebrew).size).toBe(SIGNATURE_FONTS.length)
    for (const f of SIGNATURE_FONTS) {
      // Latin letters from the style's own font, Hebrew ones from its Hebrew face, then fallbacks.
      expect(signatureFontStack(f)).toMatch(new RegExp(`^"${f.family}", "${f.hebrew.family}", `))
      expect(f.hebrew.url).toBeTruthy()
    }
  })

  it('name and size a style by the face that writes the text', () => {
    const f = SIGNATURE_FONT_BY_ID['great-vibes']
    expect(signatureFontLabel(f, 'Jane Cooper')).toBe('Great Vibes')
    expect(signatureFontLabel(f, 'ישראל כהן')).toBe('Gveret Levin')
    expect(signatureFontScale(f, 'Jane Cooper')).toBe(f.scale)
    expect(signatureFontScale(f, 'י״כ')).toBe(f.hebrew.scale)
  })
})
