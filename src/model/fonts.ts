import type { FontId } from './types'
import arimoRegular from '../assets/fonts/Arimo-Regular.ttf?url'
import arimoBold from '../assets/fonts/Arimo-Bold.ttf?url'
import tinosRegular from '../assets/fonts/Tinos-Regular.ttf?url'
import tinosBold from '../assets/fonts/Tinos-Bold.ttf?url'
import cousineRegular from '../assets/fonts/Cousine-Regular.ttf?url'
import cousineBold from '../assets/fonts/Cousine-Bold.ttf?url'

/**
 * Fonts used for text the user places on the PDF.
 *
 * The SAME TrueType files are used on screen (via the FontFace API) and embedded into the
 * exported PDF (via pdf-lib + fontkit), so glyph advances match. Vertical metrics below are
 * the fonts' hhea/OS2 ascent & descent (identical across platforms for these fonts) and are
 * used by `lib/text/layout.ts` to place baselines identically in the editor and the export.
 *
 * All three cover Latin, Latin-ext, Greek, Cyrillic and Hebrew. (No Arabic/CJK.)
 */
export interface FontDef {
  id: FontId
  label: string
  /** Family name registered with `document.fonts` (internal, never a system font). */
  cssFamily: string
  /** CSS fallback stack used while the face loads or for missing glyphs. */
  cssFallback: string
  files: { regular: string; bold: string }
  unitsPerEm: number
  /** Positive, font units. */
  ascent: number
  /** Positive, font units. */
  descent: number
}

export const FONTS: Record<FontId, FontDef> = {
  sans: {
    id: 'sans',
    label: 'Sans',
    cssFamily: 'FillFlow Sans',
    cssFallback: 'Arial, Helvetica, sans-serif',
    files: { regular: arimoRegular, bold: arimoBold },
    unitsPerEm: 2048,
    ascent: 1854,
    descent: 434,
  },
  serif: {
    id: 'serif',
    label: 'Serif',
    cssFamily: 'FillFlow Serif',
    cssFallback: '"Times New Roman", Times, serif',
    files: { regular: tinosRegular, bold: tinosBold },
    unitsPerEm: 2048,
    ascent: 1825,
    descent: 443,
  },
  mono: {
    id: 'mono',
    label: 'Mono',
    cssFamily: 'FillFlow Mono',
    cssFallback: '"Courier New", Courier, monospace',
    files: { regular: cousineRegular, bold: cousineBold },
    unitsPerEm: 2048,
    ascent: 1705,
    descent: 615,
  },
}

export const FONT_IDS = Object.keys(FONTS) as FontId[]

/** CSS `font-family` value for an element font. */
export function cssFontFamily(fontId: FontId): string {
  const f = FONTS[fontId]
  return `"${f.cssFamily}", ${f.cssFallback}`
}

export function fontFileUrl(fontId: FontId, bold: boolean): string {
  return bold ? FONTS[fontId].files.bold : FONTS[fontId].files.regular
}

const faceLoads = new Map<string, Promise<void>>()

/**
 * Registers (once) and loads the FontFace for an element font. Resolves when the face is
 * usable for layout/measurement. Never rejects (falls back to system fonts on failure).
 */
export function loadFont(fontId: FontId, bold: boolean): Promise<void> {
  const key = `${fontId}:${bold ? 700 : 400}`
  let p = faceLoads.get(key)
  if (!p) {
    const def = FONTS[fontId]
    const face = new FontFace(def.cssFamily, `url(${fontFileUrl(fontId, bold)}) format("truetype")`, {
      weight: bold ? '700' : '400',
      style: 'normal',
      display: 'block',
      // Pin vertical metrics so every browser lays lines out exactly like the PDF export.
      ascentOverride: `${(def.ascent / def.unitsPerEm) * 100}%`,
      descentOverride: `${(def.descent / def.unitsPerEm) * 100}%`,
      lineGapOverride: '0%',
    })
    document.fonts.add(face)
    p = face.load().then(
      () => undefined,
      (err) => console.warn(`[fonts] failed to load ${key}`, err),
    )
    faceLoads.set(key, p)
  }
  return p
}

export function isFontLoaded(fontId: FontId, bold: boolean): boolean {
  if (typeof document === 'undefined') return false
  return document.fonts.check(`${bold ? 700 : 400} 12px "${FONTS[fontId].cssFamily}"`)
}

/** Loads every element font (used before export / when restoring a session). */
export function loadAllFonts(): Promise<void> {
  return Promise.all(FONT_IDS.flatMap((id) => [loadFont(id, false), loadFont(id, true)])).then(() => undefined)
}
