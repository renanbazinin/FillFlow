import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFStream,
  StandardFonts,
  adjustDimsForRotation,
  beginMarkedContent,
  beginText,
  clip,
  closePath,
  cmyk,
  componentsToColor,
  endMarkedContent,
  endPath,
  endText,
  fill,
  grayscale,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  rotateInPlace,
  setDashPattern,
  setFillingColor,
  setFontAndSize,
  setLineWidth,
  setStrokingColor,
  setTextMatrix,
  showText,
  stroke,
  type Color,
  type PDFDocument,
  type PDFFont,
  type PDFOperator,
  type PDFWidgetAnnotation,
} from 'pdf-lib'
import type { TextAlign } from '../../../model/types'
import { baseDirection, bidiParagraph, visualOrder, type Direction } from './bidi'
import {
  FIELD_LINE_HEIGHT,
  combLayout,
  listFontSize,
  multiLineBaseline,
  multiLineLayout,
  multiLineText,
  resolveAlign,
  singleLineBaseline,
  singleLineFontSize,
  singleLineText,
  textPadding,
} from './textLayout'

/**
 * Appearance streams for variable-text widgets (text fields, combo boxes, list boxes).
 *
 * We draw these ourselves instead of using pdf-lib's providers because pdf-lib can't lay out
 * right-to-left text (see bidi.ts), measures with kerning it never applies, and rewrites the
 * field's /DA. Text is laid out with the same rules as the on-page editor (textLayout.ts), in
 * the widget's upright frame for the page rotation, so what the user typed is what they get.
 */

export type Rotation = 0 | 90 | 180 | 270

/** Measuring + encoding helpers around one embedded font, with per-character caches. */
export interface FontTools {
  font: PDFFont
  /** Advance width of `text` at `size`, summing per-character advances (no kerning). */
  width(text: string, size: number): number
  /** Encodes visual-order text one code point at a time (so fontkit never reorders it). */
  encode(text: string): PDFHexString
}

function fontTools(font: PDFFont): FontTools {
  const widths = new Map<string, number>()
  const codes = new Map<string, string>()
  const charWidth = (ch: string) => {
    let w = widths.get(ch)
    if (w === undefined) {
      try {
        w = font.widthOfTextAtSize(ch, 1)
      } catch {
        w = 0
      }
      widths.set(ch, w)
    }
    return w
  }
  return {
    font,
    width(text, size) {
      let w = 0
      for (const ch of text) w += charWidth(ch)
      return w * size
    },
    encode(text) {
      let hex = ''
      for (const ch of text) {
        let code = codes.get(ch)
        if (code === undefined) {
          try {
            code = font.encodeText(ch).asString()
          } catch {
            code = ''
          }
          codes.set(ch, code)
        }
        hex += code
      }
      return PDFHexString.of(hex)
    },
  }
}

/** Options of a variable-text widget, read from the field (or our extracted FormField). */
export interface TextSpec {
  /** Points; 0 = auto. */
  fontSize: number
  align?: TextAlign
  multiline?: boolean
  comb?: boolean
  maxLength?: number
  password?: boolean
  /** Text color from /DA. */
  color?: Color
}

export interface ListOption {
  value: string
  label: string
}

const LIST_HIGHLIGHT = rgb(153 / 255, 193 / 255, 218 / 255)

/** Parses the text color of a /DA string ("0 0 1 rg /Helv 0 Tf"); last color operator wins. */
export function parseDaColor(da: string | undefined): Color | undefined {
  if (!da) return undefined
  const tokens = da.trim().split(/\s+/)
  let color: Color | undefined
  tokens.forEach((t, i) => {
    const n = (k: number) => Number(tokens[i - k])
    if (t === 'g' && i >= 1 && Number.isFinite(n(1))) color = grayscale(n(1))
    else if (t === 'rg' && i >= 3 && [n(3), n(2), n(1)].every(Number.isFinite)) color = rgb(n(3), n(2), n(1))
    else if (t === 'k' && i >= 4 && [n(4), n(3), n(2), n(1)].every(Number.isFinite)) color = cmyk(n(4), n(3), n(2), n(1))
  })
  return color
}

/** Parses the font size of a /DA string ("/Helv 9 Tf" → 9; 0 = auto). */
export function parseDaFontSize(da: string | undefined): number {
  const m = da && /\/[^\s/]+\s+(-?\d*\.?\d+)\s+Tf/.exec(da)
  const n = m ? Number(m[1]) : 0
  return Number.isFinite(n) && n > 0 ? n : 0
}

interface BorderInfo {
  width: number
  color?: Color
  background?: Color
  style: 'S' | 'D' | 'B' | 'I' | 'U'
  dash: number[]
}

/** Border width that's actually drawn (0 without a border color) — shared with the screen padding. */
export function widgetBorder(widget: PDFWidgetAnnotation): BorderInfo {
  const mk = widget.getAppearanceCharacteristics()
  const color = componentsToColor(mk?.getBorderColor())
  const background = componentsToColor(mk?.getBackgroundColor())
  const bs = widget.dict.lookup(PDFName.of('BS'))
  let style: BorderInfo['style'] = 'S'
  let dash = [3]
  let width = 1
  if (bs instanceof PDFDict) {
    const w = bs.lookup(PDFName.of('W'))
    if (w instanceof PDFNumber) width = w.asNumber()
    const s = bs.lookup(PDFName.of('S'))
    if (s instanceof PDFName) {
      const v = s.decodeText()
      if (v === 'D' || v === 'B' || v === 'I' || v === 'U') style = v
    }
    const d = bs.lookup(PDFName.of('D'))
    if (d instanceof PDFArray) {
      const nums = d.asArray().map((o) => (o instanceof PDFNumber ? o.asNumber() : NaN)).filter((n) => Number.isFinite(n) && n >= 0)
      if (nums.length && nums.some((n) => n > 0)) dash = nums
    }
  }
  return { width: color ? Math.max(0, width) : 0, color, background, style, dash }
}

function rectPath(x: number, y: number, w: number, h: number): PDFOperator[] {
  return [moveTo(x, y), lineTo(x, y + h), lineTo(x + w, y + h), lineTo(x + w, y), closePath()]
}

function backgroundAndBorder(b: BorderInfo, w: number, h: number): PDFOperator[] {
  const ops: PDFOperator[] = []
  if (b.background) ops.push(setFillingColor(b.background), ...rectPath(0, 0, w, h), fill())
  if (b.color && b.width > 0) {
    const half = b.width / 2
    ops.push(pushGraphicsState(), setStrokingColor(b.color), setLineWidth(b.width))
    if (b.style === 'U') {
      ops.push(moveTo(0, half), lineTo(w, half), stroke())
    } else {
      if (b.style === 'D') ops.push(setDashPattern(b.dash, 0))
      ops.push(...rectPath(half, half, w - b.width, h - b.width), stroke())
    }
    ops.push(popGraphicsState())
  }
  return ops
}

interface Run {
  text: string
  x: number
  /** Baseline, from the bottom of the frame. */
  y: number
}

/** Draws variable text runs inside /Tx BMC … EMC, clipped to the area inside the border. */
function textBlock(tools: FontTools, size: number, color: Color, runs: Run[], w: number, h: number, inset: number, extra: PDFOperator[] = []): PDFOperator[] {
  const ops: PDFOperator[] = [
    beginMarkedContent('Tx'),
    pushGraphicsState(),
    ...rectPath(inset, inset, Math.max(0, w - inset * 2), Math.max(0, h - inset * 2)),
    clip(),
    endPath(),
    ...extra,
  ]
  const drawn = runs.filter((r) => r.text)
  if (drawn.length) {
    ops.push(beginText(), setFontAndSize(tools.font.name, size), setFillingColor(color))
    for (const r of drawn) ops.push(setTextMatrix(1, 0, 0, 1, r.x, r.y), showText(tools.encode(r.text)))
    ops.push(endText())
  }
  ops.push(popGraphicsState(), endMarkedContent())
  return ops
}

function alignedX(align: 'left' | 'center' | 'right', textWidth: number, w: number, pad: number): number {
  if (align === 'center') return (w - textWidth) / 2
  if (align === 'right') return w - pad - textWidth
  return pad
}

/** Fonts used for appearances, embedded lazily: Helvetica/Courier for WinAnsi text, else Unicode. */
export class AppearanceFonts {
  private helv?: FontTools
  private cour?: FontTools
  private unicode?: Promise<FontTools>
  private winAnsi = new Map<string, boolean>()
  private doc: PDFDocument
  private getUnicodeFont: () => Promise<PDFFont>

  constructor(doc: PDFDocument, getUnicodeFont: () => Promise<PDFFont>) {
    this.doc = doc
    this.getUnicodeFont = getUnicodeFont
  }

  private standard(mono: boolean): FontTools {
    if (mono) return (this.cour ??= fontTools(this.doc.embedStandardFont(StandardFonts.Courier)))
    return (this.helv ??= fontTools(this.doc.embedStandardFont(StandardFonts.Helvetica)))
  }

  /** Whether every drawn character can be encoded by a standard (WinAnsi) font. */
  isWinAnsi(text: string): boolean {
    const helv = this.standard(false)
    for (const ch of text) {
      if (ch < ' ') continue // line breaks / controls are never drawn
      let ok = this.winAnsi.get(ch)
      if (ok === undefined) {
        try {
          helv.font.encodeText(ch)
          ok = true
        } catch {
          ok = false
        }
        this.winAnsi.set(ch, ok)
      }
      if (!ok) return false
    }
    return true
  }

  async for(texts: string[], mono = false): Promise<FontTools> {
    if (texts.every((t) => this.isWinAnsi(t))) return this.standard(mono)
    return (this.unicode ??= this.getUnicodeFont().then(fontTools))
  }
}

/**
 * Rotation of a widget's text frame (its /MK /R). An explicit /MK /R wins. Without one, text on
 * a rotated page reads upright when the box is wide as the viewer sees it, and keeps the page's
 * own direction when the box is tall — the same rule as the editor (visualTextRotation).
 */
export function textRotation(widget: PDFWidgetAnnotation, pageRotation: Rotation): Rotation {
  const r = widget.getAppearanceCharacteristics()?.getRotation() ?? 0
  const turn = ((((Math.round(r / 90) * 90) % 360) + 360) % 360) as Rotation
  if (turn || !pageRotation) return turn
  if (pageRotation === 180) return 180
  const { width, height } = widget.getRectangle()
  // On a quarter-turned page the viewer sees the box with its sides swapped.
  return Math.abs(height) >= Math.abs(width) ? pageRotation : 0
}

/** Writes `ops` (drawn in the upright frame) as the widget's normal appearance. */
function setAppearance(doc: PDFDocument, widget: PDFWidgetAnnotation, rotation: Rotation, fonts: FontTools[], draw: (w: number, h: number) => PDFOperator[]) {
  const r = widget.getRectangle()
  const width = Math.abs(r.width)
  const height = Math.abs(r.height)
  const frame = adjustDimsForRotation({ width, height }, rotation)
  const ops = [...rotateInPlace({ width, height, rotation }), ...draw(frame.width, frame.height)]
  const Font: Record<string, PDFFont['ref']> = {}
  for (const t of fonts) Font[t.font.name] = t.font.ref
  const stream = doc.context.formXObject(ops, {
    Resources: { Font },
    BBox: [0, 0, width, height],
    Matrix: [1, 0, 0, 1, 0, 0],
  })
  widget.setNormalAppearance(doc.context.register(stream))
  widget.removeRolloverAppearance()
  widget.removeDownAppearance()
  // Keep /MK /R in sync so viewers that regenerate appearances also draw upright text.
  const mk = widget.getAppearanceCharacteristics()
  if ((mk?.getRotation() ?? 0) % 360 !== rotation) {
    if (mk || rotation) widget.getOrCreateAppearanceCharacteristics().setRotation(rotation)
  }
}

const BLACK = grayscale(0)

/** Text field appearance: single line, multi-line, comb or password. */
export async function writeTextAppearance(
  doc: PDFDocument,
  fonts: AppearanceFonts,
  widget: PDFWidgetAnnotation,
  rotation: Rotation,
  value: string,
  spec: TextSpec,
): Promise<void> {
  const border = widgetBorder(widget)
  const pad = textPadding(border.width)
  const color = spec.color ?? BLACK

  if (spec.comb && spec.maxLength) {
    const text = singleLineText(value).slice(0, spec.maxLength)
    const visual = visualOrder(text, 'ltr')
    const cells = visual.match(/\P{M}\p{M}*/gu) ?? []
    const tools = await fonts.for([visual], true)
    setAppearance(doc, widget, rotation, [tools], (w, h) => {
      const { fontSize, cellWidth } = combLayout({ width: w, height: h, fontSize: spec.fontSize, maxLength: spec.maxLength! })
      const y = h - singleLineBaseline(h, fontSize)
      const runs = cells.map((c, i) => ({ text: c, x: i * cellWidth + (cellWidth - tools.width(c, fontSize)) / 2, y }))
      return [...backgroundAndBorder(border, w, h), ...textBlock(tools, fontSize, color, runs, w, h, border.width)]
    })
    return
  }

  if (spec.multiline && !spec.password) {
    const text = multiLineText(value)
    const tools = await fonts.for([text])
    setAppearance(doc, widget, rotation, [tools], (w, h) => {
      const { fontSize, lines } = multiLineLayout(text, { width: w, height: h, fontSize: spec.fontSize, padding: pad }, tools.width)
      // Like a <textarea dir="auto"> (unicode-bidi: plaintext): every paragraph takes the
      // direction of its own first strong character, and "start" alignment follows it.
      const paragraphs = text.split('\n')
      const dirs: Direction[] = paragraphs.map((p) => baseDirection(p))
      const bidi = paragraphs.map((p, i) => bidiParagraph(p, dirs[i]))
      const runs: Run[] = []
      lines.forEach((line, i) => {
        const p = paragraphs[line.paragraph]
        let end = line.end
        while (end > line.start && /\s/.test(p[end - 1])) end--
        const visual = bidi[line.paragraph].line(line.start, end)
        const y = h - multiLineBaseline(i, fontSize, pad)
        if (y < -fontSize) return
        const align = resolveAlign(spec.align, dirs[line.paragraph])
        runs.push({ text: visual, x: alignedX(align, tools.width(visual, fontSize), w, pad), y })
      })
      return [...backgroundAndBorder(border, w, h), ...textBlock(tools, fontSize, color, runs, w, h, border.width)]
    })
    return
  }

  const raw = singleLineText(value)
  const text = spec.password ? '*'.repeat([...raw].length) : raw
  const dir = baseDirection(text)
  const visual = visualOrder(text, dir)
  const tools = await fonts.for([visual])
  setAppearance(doc, widget, rotation, [tools], (w, h) => {
    const fontSize = singleLineFontSize(text, { width: w, height: h, fontSize: spec.fontSize, padding: pad }, tools.width)
    const x = alignedX(resolveAlign(spec.align, dir), tools.width(visual, fontSize), w, pad)
    const runs = [{ text: visual, x, y: h - singleLineBaseline(h, fontSize) }]
    return [...backgroundAndBorder(border, w, h), ...textBlock(tools, fontSize, color, runs, w, h, border.width)]
  })
}

/** Combo box appearance: the selected option's display text (or the typed value). */
export async function writeDropdownAppearance(
  doc: PDFDocument,
  fonts: AppearanceFonts,
  widget: PDFWidgetAnnotation,
  rotation: Rotation,
  text: string,
  spec: TextSpec,
): Promise<void> {
  await writeTextAppearance(doc, fonts, widget, rotation, text, { ...spec, multiline: false, comb: false, password: false })
}

/** List box appearance: options from the top index, selected rows highlighted. Returns the top index used. */
export async function writeListAppearance(
  doc: PDFDocument,
  fonts: AppearanceFonts,
  widget: PDFWidgetAnnotation,
  rotation: Rotation,
  options: ListOption[],
  selected: ReadonlySet<string>,
  topIndex: number,
  spec: TextSpec,
): Promise<number> {
  const border = widgetBorder(widget)
  const pad = textPadding(border.width)
  const color = spec.color ?? BLACK
  const labels = options.map((o) => singleLineText(o.label))
  const tools = await fonts.for(labels)
  let top = Math.max(0, Math.min(topIndex, options.length - 1))
  setAppearance(doc, widget, rotation, [tools], (w, h) => {
    const fontSize = listFontSize({ height: h, fontSize: spec.fontSize })
    const rowH = fontSize * FIELD_LINE_HEIGHT
    const visible = Math.max(1, Math.floor((h - pad * 2) / rowH + 0.01))
    const first = options.findIndex((o) => selected.has(o.value))
    if (first >= 0 && (first < top || first >= top + visible)) top = Math.max(0, Math.min(first, options.length - visible))
    const highlights: PDFOperator[] = []
    const runs: Run[] = []
    for (let i = top, row = 0; i < options.length && row <= visible; i++, row++) {
      const rowTop = pad + row * rowH
      if (selected.has(options[i].value)) {
        highlights.push(setFillingColor(LIST_HIGHLIGHT), ...rectPath(border.width, h - rowTop - rowH, w - border.width * 2, rowH), fill())
      }
      const dir = baseDirection(labels[i])
      const visual = visualOrder(labels[i], dir)
      runs.push({ text: visual, x: alignedX(resolveAlign(undefined, dir), tools.width(visual, fontSize), w, pad), y: h - multiLineBaseline(row, fontSize, pad) })
    }
    return [...backgroundAndBorder(border, w, h), ...textBlock(tools, fontSize, color, runs, w, h, border.width, highlights)]
  })
  return top
}

/** Whether a widget has a usable normal appearance stream. */
export function hasNormalStream(widget: PDFWidgetAnnotation): boolean {
  return widget.getAppearances()?.normal instanceof PDFStream
}
