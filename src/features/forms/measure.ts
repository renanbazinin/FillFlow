import { useSyncExternalStore } from 'react'
import { FONTS, loadFont } from '../../model/fonts'

/**
 * Canvas measurement with the on-page field font (Arimo, registered as "FillFlow Sans"),
 * kerning off — matching how the exporter measures and draws field text.
 */

const MEASURE_PX = 100
let ctx: CanvasRenderingContext2D | null | undefined
const cache = new Map<string, number>()
let ready = false
let loading = false
const listeners = new Set<() => void>()

/** Loads the field fonts once (sans for text, mono for comb fields). */
export function ensureFormFonts(): void {
  if (loading) return
  loading = true
  void Promise.all([loadFont('sans', false), loadFont('mono', false)]).then(() => {
    ready = true
    cache.clear() // widths measured with a fallback face are stale
    listeners.forEach((l) => l())
  })
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** True once the field fonts are loaded (re-renders the caller when that happens). */
export function useFormFontsReady(): boolean {
  return useSyncExternalStore(subscribe, () => ready, () => false)
}

/** Advance width in points of `text` at `fontSize` in the field font. */
export function measureFieldText(text: string, fontSize: number): number {
  if (!text) return 0
  let w = cache.get(text)
  if (w === undefined) {
    if (ctx === undefined) ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
    if (!ctx) return [...text].length * fontSize * 0.55
    ctx.font = `400 ${MEASURE_PX}px "${FONTS.sans.cssFamily}", ${FONTS.sans.cssFallback}`
    ctx.fontKerning = 'none'
    w = ctx.measureText(text).width
    if (cache.size > 4000) cache.clear()
    cache.set(text, w)
  }
  return (w / MEASURE_PX) * fontSize
}
