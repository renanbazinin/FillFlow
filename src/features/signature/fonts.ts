import '@fontsource/great-vibes'
import '@fontsource/dancing-script'
import '@fontsource/homemade-apple'
import '@fontsource/mr-dafoe'
import '@fontsource/caveat'
import gveretLevin from '@fontsource/gveret-levin/files/gveret-levin-hebrew-400-normal.woff2?url'
import playpenLight from '@fontsource/playpen-sans-hebrew/files/playpen-sans-hebrew-hebrew-300-normal.woff2?url'
import playpenBold from '@fontsource/playpen-sans-hebrew/files/playpen-sans-hebrew-hebrew-600-normal.woff2?url'
import amatic from '@fontsource/amatic-sc/files/amatic-sc-hebrew-400-normal.woff2?url'
import amaticBold from '@fontsource/amatic-sc/files/amatic-sc-hebrew-700-normal.woff2?url'

export type SignatureFontId = 'great-vibes' | 'dancing-script' | 'homemade-apple' | 'mr-dafoe' | 'caveat'

/**
 * A handwriting face for Hebrew: the Latin script fonts have no Hebrew letters, which would
 * otherwise all fall back to the same plain sans-serif. Each is registered as a family of its
 * own (one weight, Hebrew letters only) and downloaded only when Hebrew is typed.
 */
interface HebrewFace {
  family: string
  label: string
  url: string
  /** Relative size, like SignatureFont.scale, for text written in Hebrew. */
  scale: number
}

export interface SignatureFont {
  id: SignatureFontId
  label: string
  family: string
  /** Relative size so every style reads about equally big. */
  scale: number
  hebrew: HebrewFace
}

const hebrewFace = (family: string, label: string, url: string, scale: number): HebrewFace => ({ family: `FillFlow ${family}`, label, url, scale })

export const SIGNATURE_FONTS: SignatureFont[] = [
  { id: 'great-vibes', label: 'Great Vibes', family: 'Great Vibes', scale: 1.04, hebrew: hebrewFace('Gveret Levin', 'Gveret Levin', gveretLevin, 1) },
  { id: 'dancing-script', label: 'Dancing Script', family: 'Dancing Script', scale: 1, hebrew: hebrewFace('Playpen Bold', 'Playpen Sans', playpenBold, 0.92) },
  { id: 'homemade-apple', label: 'Homemade Apple', family: 'Homemade Apple', scale: 0.74, hebrew: hebrewFace('Amatic Bold', 'Amatic Bold', amaticBold, 1.3) },
  { id: 'mr-dafoe', label: 'Mr Dafoe', family: 'Mr Dafoe', scale: 0.98, hebrew: hebrewFace('Playpen Light', 'Playpen Sans Light', playpenLight, 0.95) },
  { id: 'caveat', label: 'Caveat', family: 'Caveat', scale: 1.12, hebrew: hebrewFace('Amatic', 'Amatic', amatic, 1.3) },
]

export const SIGNATURE_FONT_BY_ID = Object.fromEntries(SIGNATURE_FONTS.map((f) => [f.id, f])) as Record<SignatureFontId, SignatureFont>

export function isSignatureFontId(v: unknown): v is SignatureFontId {
  return typeof v === 'string' && v in SIGNATURE_FONT_BY_ID
}

/** Letters of the Hebrew script. */
const HEBREW = /\p{Script=Hebrew}/u

/** The name a style goes by for `text`: its Hebrew face's when the text is written in Hebrew. */
export function signatureFontLabel(font: SignatureFont, text: string): string {
  return HEBREW.test(text) ? font.hebrew.label : font.label
}

/** A style's relative size for `text` (see SignatureFont.scale). */
export function signatureFontScale(font: SignatureFont, text: string): number {
  return HEBREW.test(text) ? font.hebrew.scale : font.scale
}

let registered = false

/** Adds the Hebrew faces to the document (they load on first use). */
function registerHebrewFaces(): void {
  if (registered || typeof document === 'undefined' || !document.fonts || typeof FontFace === 'undefined') return
  registered = true
  for (const { hebrew } of SIGNATURE_FONTS) {
    document.fonts.add(new FontFace(hebrew.family, `url("${hebrew.url}") format("woff2")`, { display: 'swap', unicodeRange: 'U+0590-05FF, U+FB1D-FB4F' }))
  }
}

/**
 * CSS font-family for a style. Hebrew letters come from its Hebrew face; other characters the
 * font lacks (Arabic, CJK…) fall back glyph by glyph to the generic families, both in the DOM
 * and on canvas.
 */
export function signatureFontStack(font: SignatureFont): string {
  registerHebrewFaces()
  return `"${font.family}", "${font.hebrew.family}", "Segoe Script", "Brush Script MT", cursive, sans-serif`
}

/** Waits until the faces needed for `text` are ready (never rejects). */
export async function ensureSignatureFont(font: SignatureFont, text: string): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return
  registerHebrewFaces()
  try {
    await document.fonts.load(`64px "${font.family}", "${font.hebrew.family}"`, text || 'Signature')
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
