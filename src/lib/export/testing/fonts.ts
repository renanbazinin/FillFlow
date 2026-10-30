import fontkit, { type Font as FkFont } from '@pdf-lib/fontkit'
import arimoRegular from '../../../assets/fonts/Arimo-Regular.ttf?inline'
import arimoBold from '../../../assets/fonts/Arimo-Bold.ttf?inline'
import tinosRegular from '../../../assets/fonts/Tinos-Regular.ttf?inline'
import tinosBold from '../../../assets/fonts/Tinos-Bold.ttf?inline'
import cousineRegular from '../../../assets/fonts/Cousine-Regular.ttf?inline'
import cousineBold from '../../../assets/fonts/Cousine-Bold.ttf?inline'
import type { FontId } from '../../../model/types'
import type { TextMeasurer } from '../../text/layout'
import { shapedLineWidth } from '../shaping'

/**
 * Test-only helpers: the element fonts as bytes (inlined by Vite, so no `node:fs`) and a
 * deterministic fontkit-based measurer that agrees with what the exporter draws.
 */

const DATA: Record<FontId, [string, string]> = {
  sans: [arimoRegular, arimoBold],
  serif: [tinosRegular, tinosBold],
  mono: [cousineRegular, cousineBold],
}

const bytesCache = new Map<string, Uint8Array>()
const fontCache = new Map<string, FkFont>()

function dataUrlToBytes(url: string): Uint8Array {
  const bin = atob(url.slice(url.indexOf(',') + 1))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function testFontBytes(fontId: FontId, bold: boolean): Uint8Array {
  const key = `${fontId}:${bold}`
  let b = bytesCache.get(key)
  if (!b) {
    b = dataUrlToBytes(DATA[fontId][bold ? 1 : 0])
    bytesCache.set(key, b)
  }
  return b
}

export function testFont(fontId: FontId, bold: boolean): FkFont {
  const key = `${fontId}:${bold}`
  let f = fontCache.get(key)
  if (!f) {
    f = fontkit.create(testFontBytes(fontId, bold))
    fontCache.set(key, f)
  }
  return f
}

export const loadTestFontBytes = async (fontId: FontId, bold: boolean) => testFontBytes(fontId, bold)

/** Measures like the browser would with these fonts (no kerning, no ligatures). */
export const fontkitMeasurer: TextMeasurer = (text, fontId, bold, fontSize) =>
  shapedLineWidth(testFont(fontId, bold), text, fontSize)
