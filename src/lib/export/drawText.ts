import type { Font as FkFont } from '@pdf-lib/fontkit'
import {
  TextRenderingMode,
  beginText,
  concatTransformationMatrix,
  drawObject,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSqueeze,
  setFillingRgbColor,
  setFontAndSize,
  setGraphicsState,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  type PDFOperator,
} from 'pdf-lib'
import type { TextElement } from '../../model/types'
import { charCount, layoutTextBlock, type TextMeasurer } from '../text/layout'
import { parseColor } from './color'
import type { DrawContext } from './drawContext'
import { r } from './num'
import { firstStrongDirection, hasMissingGlyphs, paintableText, shapeLine, type Direction, type ShapedRun } from './shaping'
import { foldSpacesBeforePoints, type Placed } from './subsetFont'

/**
 * How the paragraph direction of a multi-line block is chosen:
 *  - 'line':  every line resolves its own direction from its first strong character
 *             (CSS `unicode-bidi: plaintext`, or `dir="auto"` on each line),
 *  - 'block': the whole block takes the direction of its first strong character
 *             (`dir="auto"` on the block element).
 */
export const BIDI_PARAGRAPHS: 'line' | 'block' = 'line'

function paragraphDirection(text: string): Direction | undefined {
  return BIDI_PARAGRAPHS === 'block' ? (firstStrongDirection(text) ?? 'ltr') : undefined
}

/**
 * Text elements. Lines come from the shared `layoutTextBlock` (same measurer as the editor),
 * so line breaks, alignment offsets and baselines are identical to the screen. Each line is
 * split into bidi runs placed at their measured offsets; glyphs are emitted with exact GPOS
 * positioning. Lines with characters the fonts lack are drawn as a picture of the browser's
 * rendering instead, and keep their text invisibly over it (so it can still be found and copied).
 */
export async function textOperators(el: TextElement, ctx: DrawContext): Promise<PDFOperator[]> {
  if (!paintableText(el.text).trim()) return []
  const layout = layoutTextBlock(el.text, el, el.align, ctx.measure)
  const { font: face } = await ctx.fonts.face(el.fontId, el.bold)
  const ops: PDFOperator[] = []

  const missing = ctx.rasterizeText ? layout.lines.filter((line) => hasMissingGlyphs(face, line.text)) : []
  const raster = missing.length > 0 && ctx.rasterizeText ? await ctx.rasterizeText(el, { ...layout, lines: missing }) : null
  if (raster) {
    const image = await ctx.images.embedPng(raster.png)
    const bottom = ctx.pageHeight - raster.y - raster.height
    ops.push(
      pushGraphicsState(),
      concatTransformationMatrix(r(raster.width), 0, 0, r(raster.height), r(raster.x), r(bottom)),
      drawObject(ctx.res.xObject(image.ref)),
      popGraphicsState(),
    )
  }
  const pictured = new Set(raster ? missing : [])

  const font = await ctx.fonts.subset(el.fontId, el.bold)
  const color = parseColor(el.color)
  const gs = color.a < 1 ? ctx.res.graphicsState({ fill: color.a }) : null
  if (gs) ops.push(pushGraphicsState(), setGraphicsState(gs))
  ops.push(beginText(), setFontAndSize(ctx.res.font(font.ref), r(el.fontSize)), setFillingRgbColor(color.r, color.g, color.b))
  const stretch = gapStretch(face, el, layout.lines)
  if (stretch !== 1) ops.push(setCharacterSqueeze(100 / stretch))
  let mode = TextRenderingMode.Fill

  const base = paragraphDirection(el.text)
  const { unitsPerEm } = font.font
  for (const line of layout.lines) {
    if (!paintableText(line.text).trim()) continue
    const lineMode = pictured.has(line) ? TextRenderingMode.Invisible : TextRenderingMode.Fill
    if (lineMode !== mode) ops.push(setTextRenderingMode((mode = lineMode)))
    const baseline = ctx.pageHeight - (el.y + line.baseline)
    let x = el.x + line.x
    const runs = shapeLine(face, line.text, base).map((run) => {
      const placed = { x, glyphs: placeGlyphs(run, el.fontSize, el.letterSpacing, unitsPerEm) }
      x += runWidth(line.text.slice(run.start, run.end), el, ctx.measure)
      return placed
    })
    // Spaces before a point go into the glyph before them, also across runs: a run that started
    // with them starts after them.
    const folded = foldSpacesBeforePoints(runs.flatMap((run) => run.glyphs))
    for (const run of runs) {
      for (let k = 0; k < run.glyphs.length && folded.has(run.glyphs[k]); k++) run.x += (run.glyphs[k].advance * el.fontSize) / unitsPerEm
      const glyphs = run.glyphs.filter((p) => !folded.has(p))
      if (glyphs.length) ops.push(setTextMatrix(stretch, 0, 0, 1, r(run.x), r(baseline)), showText(font.encodePlaced(glyphs)))
    }
  }
  // Text state outlives the text object: leave the defaults behind.
  if (mode !== TextRenderingMode.Fill) ops.push(setTextRenderingMode(TextRenderingMode.Fill))
  if (stretch !== 1) ops.push(setCharacterSqueeze(100))
  ops.push(endText())
  if (gs) ops.push(popGraphicsState())
  return ctx.res.tagged({ role: 'Span', text: el.text, lang: language(el.text) }, ops)
}

/** Language a tagged PDF gives text: Hebrew is said to be; other text keeps the document's. */
function language(text: string): string | undefined {
  return firstStrongDirection(text) === 'rtl' && /\p{Script=Hebrew}/u.test(text) ? 'he-IL' : undefined
}

/** Width of a run as the editor lays it out (measurer + letter spacing after every character). */
function runWidth(text: string, el: TextElement, measure: TextMeasurer): number {
  return measure(text, el.fontId, el.bold, el.fontSize) + el.letterSpacing * charCount(text)
}

/** Stretches whose n and 100 / n are both exact: powers of two, and the steps between them. */
const STRETCHES = Array.from({ length: 11 }, (_, i) => 2 ** i)
const STRETCH_STEPS = STRETCHES.flatMap((n) => [n * 1.25, n * 1.6])

/**
 * How much to stretch the text matrix, squeezing the glyphs back by as much (Tz), so pdf.js
 * (Firefox's viewer) reads the gaps of a line as they are meant; the page itself is unchanged.
 * pdf.js measures the gap a run of spaces leaves (their widths plus the letter spacing after each)
 * in text-matrix units against the font size: past 0.6 em, or under 0.1 em, it starts a new text
 * item, keeps items in content order, and reorders right-to-left text only within an item. So
 * Cousine's space (0.6001 em), a wide letter spacing or two spaces in a row copied Hebrew lines
 * word by word in reverse. Stretching by n divides the gaps pdf.js measures by n: it keeps every
 * gap between words of the element within 0.11–0.59 em, where it reads one space, or failing
 * that (five spaces in a row beside a single one), the shorter ones.
 */
function gapStretch(face: FkFont, el: TextElement, lines: readonly { text: string }[]): number {
  const em = (ch: string) => face.glyphForCodePoint(ch.codePointAt(0)!).advanceWidth / face.unitsPerEm + el.letterSpacing / el.fontSize
  const space = em(' ')
  const gaps: number[] = []
  for (const line of lines) {
    for (const [run] of paintableText(line.text).matchAll(/(?<=\S)\s+(?=\S)/gu)) gaps.push([...run].reduce((w, ch) => w + em(ch), 0))
  }
  const shortest = gaps.length ? Math.min(...gaps) : space
  const longest = gaps.length ? Math.max(...gaps) : space
  const fits = (n: number) => longest / n <= 0.59 && shortest / n >= 0.11
  return STRETCHES.find(fits) ?? STRETCH_STEPS.find(fits) ?? Math.max(1, ...[...STRETCHES, ...STRETCH_STEPS].filter((n) => shortest / n >= 0.11))
}

type GlyphRun = Pick<ShapedRun, 'glyphs' | 'positions' | 'clusters' | 'chars' | 'typed' | 'rtl'>

/**
 * A run's glyphs, placed exactly where the shaper places them without positioning them in the
 * content stream: text extractors (Chrome's PDFium, pdf.js, poppler, xpdf) read such moves as
 * gaps between words ("שָׁ לוֹם", "1 2 3"). Each grapheme cluster is drawn in place instead: its
 * glyphs are moved by their GPOS offsets inside the subset font (points, accents), and one of them
 * advances by the cluster's width plus the letter spacing after it, as CSS spaces whole clusters
 * (character spacing, Tc, would also space out zero-width marks, and it outlives the text object).
 */
function placeGlyphs(run: GlyphRun, size: number, letterSpacing: number, unitsPerEm: number): Placed[] {
  const spacing = (letterSpacing / size) * unitsPerEm
  const placed: Placed[] = []
  for (let start = 0; start < run.glyphs.length; ) {
    let end = start + 1
    while (end < run.glyphs.length && run.clusters[end] === run.clusters[start]) end++
    placed.push(...placeCluster(run, start, end, spacing))
    start = end
  }
  return placed
}

/**
 * Glyphs [start, end) of a run (one grapheme cluster), one per character typed. Extractors turn
 * right-to-left text back into logical order by reversing it one character at a time, so a
 * right-to-left cluster is written last character first. A character drawn by another one's glyph
 * (the dot of שׁ, composed with its letter) gets an empty glyph of its own.
 */
function placeCluster(run: GlyphRun, start: number, end: number, spacing: number): Placed[] {
  const { glyphs, positions, chars } = run
  // Where each glyph is drawn from the cluster's origin, and how far the cluster advances.
  const at: [number, number][] = []
  let width = 0
  for (let i = start; i < end; i++) {
    at.push([width + positions[i].xOffset, positions[i].yOffset])
    width += positions[i].xAdvance
  }
  width += spacing
  const sources = typedSources(run, start, end)
  if (!sources) {
    // Glyphs that don't account for the typed characters one by one stand for their own, as shaped.
    return glyphs.slice(start, end).map((glyph, n) => {
      const p = positions[start + n]
      return { glyph, chars: chars[start + n], dx: p.xOffset, dy: p.yOffset, advance: p.xAdvance + (start + n === end - 1 ? spacing : 0) }
    })
  }
  // The first character (the letter) advances; the others are drawn where they belong from there.
  const base = sources[0]
  const placed: Placed[] = []
  let x = 0
  for (const source of run.rtl ? [...sources].reverse() : sources) {
    const advance = source === base ? width : 0
    if (source.glyph === null) placed.push({ glyph: null, chars: source.char, dx: 0, dy: 0, advance })
    else {
      const [gx, gy] = at[source.glyph - start]
      placed.push({ glyph: glyphs[source.glyph], chars: source.char, dx: gx - x, dy: gy, advance })
    }
    x += advance
  }
  return placed
}

/**
 * The typed characters of a cluster (glyphs [start, end) of a run), in order, each with the glyph
 * that draws it (whose first character it is), or null for a character drawn by another one's
 * glyph. Null when the glyphs don't account for the typed characters exactly.
 */
function typedSources(run: GlyphRun, start: number, end: number): { char: string; glyph: number | null }[] | null {
  const left = new Map<number, string[]>()
  for (let i = start; i < end; i++) {
    if (!run.chars[i]) return null
    left.set(i, [...run.chars[i]])
  }
  const drawn = new Set<number>()
  const sources: { char: string; glyph: number | null }[] = []
  for (const char of run.typed[run.clusters[start]] ?? '') {
    const owner = [...left.keys()].find((i) => left.get(i)!.includes(char))
    if (owner === undefined) return null
    const rest = left.get(owner)!
    rest.splice(rest.indexOf(char), 1)
    const outline = !drawn.has(owner) && run.chars[owner].startsWith(char)
    if (outline) drawn.add(owner)
    sources.push({ char, glyph: outline ? owner : null })
  }
  if (drawn.size !== end - start || [...left.values()].some((rest) => rest.length)) return null
  return sources
}
