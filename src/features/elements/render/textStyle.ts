import { useMemo, type CSSProperties } from 'react'
import { cssFontFamily, isFontLoaded } from '../../../model/fonts'
import type { FontId, TextAlign, TextElement } from '../../../model/types'
import { baselineOffset, layoutTextBlock, type TextBlockLayout, type TextStyle } from '../../../lib/text/layout'
import { useElementsUi } from '../state/ui'

/**
 * CSS for text that must match the PDF export glyph for glyph: the element font, no kerning,
 * no ligatures, no OpenType features inherited from the app UI.
 */
export function textCss(el: Pick<TextElement, 'fontId' | 'fontSize' | 'lineHeight' | 'letterSpacing' | 'bold' | 'color'>, scale: number): CSSProperties {
  return {
    fontFamily: cssFontFamily(el.fontId),
    fontSize: `${el.fontSize * scale}px`,
    lineHeight: `${el.fontSize * el.lineHeight * scale}px`,
    letterSpacing: `${el.letterSpacing * scale}px`,
    fontWeight: el.bold ? 700 : 400,
    fontStyle: 'normal',
    fontKerning: 'none',
    fontVariantLigatures: 'none',
    fontFeatureSettings: 'normal',
    fontSynthesis: 'none',
    textTransform: 'none',
    wordSpacing: 0,
    color: el.color,
    whiteSpace: 'pre',
  }
}

/** `fontVersion` only invalidates measurements that were taken with a fallback font. */
function layoutAt(text: string, style: TextStyle, align: TextAlign, fontVersion: number): TextBlockLayout {
  void fontVersion
  return layoutTextBlock(text, style, align)
}

/** Shared layout for a text element, recomputed when its text/style changes or a font loads. */
export function useTextLayout(el: TextElement): TextBlockLayout {
  const fontVersion = useElementsUi((s) => s.fontVersion)
  const { text, fontId, bold, fontSize, lineHeight, letterSpacing, align } = el
  return useMemo(
    () => layoutAt(text, { fontId, bold, fontSize, lineHeight, letterSpacing }, align, fontVersion),
    [text, fontId, bold, fontSize, lineHeight, letterSpacing, align, fontVersion],
  )
}

// --- Baseline correction ----------------------------------------------------------------------

const domBaselines = new Map<string, number>()
let probe: { host: HTMLDivElement; line: HTMLDivElement; mark: HTMLSpanElement } | null = null

/**
 * Where the browser puts the baseline inside a line box of the given font and line height,
 * in CSS px from the box top. Browsers round the font's ascent/descent (and the half-leading)
 * to whole pixels, so this can be up to ~1px off the exact value the PDF export uses.
 */
function domBaseline(fontId: FontId, bold: boolean, fontPx: number, linePx: number): number | null {
  if (typeof document === 'undefined' || !document.body) return null
  const key = `${fontId}:${bold ? 1 : 0}:${fontPx}:${linePx}`
  const known = domBaselines.get(key)
  if (known !== undefined) return known
  if (!probe) {
    const host = document.createElement('div')
    host.setAttribute('aria-hidden', 'true')
    host.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;pointer-events:none;contain:layout'
    const line = document.createElement('div')
    line.style.cssText = 'position:absolute;left:0;top:0;white-space:pre;font-kerning:none;font-style:normal'
    line.textContent = 'x'
    // A zero-height inline-block sits exactly on the baseline.
    const mark = document.createElement('span')
    mark.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'
    line.appendChild(mark)
    host.appendChild(line)
    probe = { host, line, mark }
  }
  if (!probe.host.isConnected) document.body.appendChild(probe.host)
  const { line, mark } = probe
  line.style.fontFamily = cssFontFamily(fontId)
  line.style.fontWeight = bold ? '700' : '400'
  line.style.fontSize = `${fontPx}px`
  line.style.lineHeight = `${linePx}px`
  line.style.height = `${linePx}px`
  const offset = mark.getBoundingClientRect().top - line.getBoundingClientRect().top
  // Only remember measurements taken with the real face (not a fallback still loading).
  if (isFontLoaded(fontId, bold)) {
    if (domBaselines.size > 2000) domBaselines.clear() // pinch-zooming visits many scales
    domBaselines.set(key, offset)
  }
  return offset
}

/**
 * Vertical shift (CSS px) that moves the browser's baseline onto the exact baseline of the
 * shared text layout (which the PDF export follows). `k` is the scale-down factor of the iOS
 * inline editor, which lays text out at 1/k size and scales it by k.
 */
export function baselineShift(
  el: Pick<TextElement, 'fontId' | 'bold' | 'fontSize' | 'lineHeight'>,
  scale: number,
  k = 1,
): number {
  const fontPx = (el.fontSize * scale) / k
  const linePx = (el.fontSize * el.lineHeight * scale) / k
  const actual = domBaseline(el.fontId, el.bold, fontPx, linePx)
  if (actual === null) return 0
  return baselineOffset(el.fontId, el.fontSize, el.lineHeight) * scale - actual * k
}

/** `baselineShift` for an element, re-measured when a font finishes loading. */
export function useBaselineShift(el: TextElement, scale: number, k = 1): number {
  const fontVersion = useElementsUi((s) => s.fontVersion)
  const { fontId, bold, fontSize, lineHeight } = el
  return useMemo(() => {
    void fontVersion
    return baselineShift({ fontId, bold, fontSize, lineHeight }, scale, k)
  }, [fontId, bold, fontSize, lineHeight, scale, k, fontVersion])
}
