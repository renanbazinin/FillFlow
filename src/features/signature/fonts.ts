import '@fontsource/great-vibes'
import '@fontsource/dancing-script'
import '@fontsource/homemade-apple'
import '@fontsource/mr-dafoe'
import '@fontsource/caveat'

export type SignatureFontId = 'great-vibes' | 'dancing-script' | 'homemade-apple' | 'mr-dafoe' | 'caveat'

export interface SignatureFont {
  id: SignatureFontId
  label: string
  family: string
  /** Relative size so every style reads about equally big. */
  scale: number
}

export const SIGNATURE_FONTS: SignatureFont[] = [
  { id: 'great-vibes', label: 'Great Vibes', family: 'Great Vibes', scale: 1.04 },
  { id: 'dancing-script', label: 'Dancing Script', family: 'Dancing Script', scale: 1 },
  { id: 'homemade-apple', label: 'Homemade Apple', family: 'Homemade Apple', scale: 0.74 },
  { id: 'mr-dafoe', label: 'Mr Dafoe', family: 'Mr Dafoe', scale: 0.98 },
  { id: 'caveat', label: 'Caveat', family: 'Caveat', scale: 1.12 },
]

export const SIGNATURE_FONT_BY_ID = Object.fromEntries(SIGNATURE_FONTS.map((f) => [f.id, f])) as Record<SignatureFontId, SignatureFont>

export function isSignatureFontId(v: unknown): v is SignatureFontId {
  return typeof v === 'string' && v in SIGNATURE_FONT_BY_ID
}

/**
 * CSS font-family for a style. Characters the font lacks (Hebrew, Arabic, CJK…) fall back
 * glyph by glyph to the generic families, both in the DOM and on canvas.
 */
export function signatureFontStack(font: SignatureFont): string {
  return `"${font.family}", "Segoe Script", "Brush Script MT", cursive, sans-serif`
}

/** Waits until the faces needed for `text` are ready (never rejects). */
export async function ensureSignatureFont(font: SignatureFont, text: string): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return
  try {
    await document.fonts.load(`64px "${font.family}"`, text || 'Signature')
  } catch {
    /* fall back to whatever is available */
  }
}

let preloaded: Promise<void> | null = null

/** Starts loading every style (Latin subset) so the Type tab renders instantly. */
export function preloadSignatureFonts(): Promise<void> {
  preloaded ??= Promise.all(SIGNATURE_FONTS.map((f) => ensureSignatureFont(f, 'Signature'))).then(() => undefined)
  return preloaded
}
