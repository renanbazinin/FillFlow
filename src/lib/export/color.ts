export interface ParsedColor {
  r: number
  g: number
  b: number
  /** 0..1 */
  a: number
}

const BLACK: ParsedColor = { r: 0, g: 0, b: 0, a: 1 }

/** Parses `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` into 0..1 components (black on failure). */
export function parseColor(hex: string | null | undefined): ParsedColor {
  if (!hex) return BLACK
  let h = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-f]+$/i.test(h)) return BLACK
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
  if (h.length !== 6 && h.length !== 8) return BLACK
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255
  return { r: round(n(0)), g: round(n(2)), b: round(n(4)), a: h.length === 8 ? round(n(6)) : 1 }
}

function round(v: number): number {
  return Math.round(v * 10000) / 10000
}
