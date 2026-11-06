import {
  LineCapStyle,
  LineJoinStyle,
  PDFOperator,
  appendBezierCurve,
  closePath,
  concatTransformationMatrix,
  drawObject,
  drawSvgPath,
  fill,
  fillAndStroke,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  setFillingRgbColor,
  setGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  stroke,
} from 'pdf-lib'
import { HIGHLIGHT_COLOR, MARK_PATHS, MARK_VIEWBOX, elementLabel } from '../../model/elements'
import type { ImageElement, InkElement, MarkElement, ShapeElement } from '../../model/types'
import { parseColor } from './color'
import type { DrawContext } from './drawContext'
import { imageMatrix } from './images'
import { r } from './num'
import type { ContentTag } from './pageResources'

/** Bézier circle constant. */
const KAPPA = 0.5522847498307936

/** Marks and pictures, in a tagged PDF: described by the names the app gives them ("Checkmark", "Signature"…). */
const figure = (el: MarkElement | ImageElement): ContentTag => ({ role: 'Figure', alt: elementLabel(el), lang: 'en' })

/** Shapes, highlights, whiteout and drawings, which screen readers skip. */
const ARTIFACT: ContentTag = { role: 'Artifact' }

/** Marks: the same 24×24 outlines the editor's SVG uses (viewBox meet: centred, uniform scale). */
export function markOperators(el: MarkElement, ctx: DrawContext): PDFOperator[] {
  const size = Math.min(el.width, el.height)
  if (size <= 0) return []
  const s = size / MARK_VIEWBOX
  const left = el.x + (el.width - size) / 2
  const top = el.y + (el.height - size) / 2
  const c = parseColor(el.color)
  const gs = c.a < 1 ? ctx.res.graphicsState({ fill: c.a }) : null
  // drawSvgPath maps SVG (x, y-down) to (x0 + x·s, y0 − y·s): anchor it at the box's top-left.
  const ops = drawSvgPath(MARK_PATHS[el.shape], {
    x: r(left),
    y: r(ctx.pageHeight - top),
    scale: s,
    color: rgb(c.r, c.g, c.b),
    borderColor: undefined,
    borderWidth: 0,
    graphicsState: gs ?? undefined,
  })
  return ctx.res.tagged(figure(el), ops)
}

export async function imageOperators(el: ImageElement, ctx: DrawContext): Promise<PDFOperator[]> {
  const asset = ctx.assets[el.assetId]
  if (!asset || el.width <= 0 || el.height <= 0 || el.opacity <= 0) {
    if (!asset) console.warn(`[export] image ${el.id} references a missing asset`)
    return []
  }
  const embedded = await ctx.images.get(asset)
  if (!embedded) return []
  const gs = el.opacity < 1 ? ctx.res.graphicsState({ fill: el.opacity, stroke: el.opacity }) : null
  const m = imageMatrix(embedded.orientation, el.x, ctx.pageHeight - el.y - el.height, el.width, el.height)
  return ctx.res.tagged(figure(el), [
    pushGraphicsState(),
    ...(gs ? [setGraphicsState(gs)] : []),
    concatTransformationMatrix(...(m.map(r) as [number, number, number, number, number, number])),
    drawObject(ctx.res.xObject(embedded.image.ref)),
    popGraphicsState(),
  ])
}

function isHighlight(el: ShapeElement): boolean {
  return el.strokeColor === null && el.fillColor !== null && el.fillColor.toLowerCase() === HIGHLIGHT_COLOR.toLowerCase()
}

/** Path + paint operators for a shape, without any graphics-state wrapper. */
function shapePaint(el: ShapeElement, H: number): PDFOperator[] | null {
  const strokeC = el.strokeColor && el.strokeWidth > 0 ? parseColor(el.strokeColor) : null
  const fillC = el.shape !== 'line' && el.fillColor ? parseColor(el.fillColor) : null
  if (!strokeC && !fillC) return null
  if (el.shape !== 'line' && (el.width <= 0 || el.height <= 0)) return null
  // A rect/ellipse border wider than half the box is drawn at half its smaller side (as on
  // screen): the shape is then solid, and the stroke never spills out of the box.
  const sw = !strokeC ? 0 : el.shape === 'line' ? el.strokeWidth : Math.min(el.strokeWidth, el.width / 2, el.height / 2)
  const ops: PDFOperator[] = []
  if (fillC) ops.push(setFillingRgbColor(fillC.r, fillC.g, fillC.b))
  if (strokeC) ops.push(setStrokingRgbColor(strokeC.r, strokeC.g, strokeC.b), setLineWidth(r(sw)))

  if (el.shape === 'line') {
    if (!strokeC) return null
    const [x1, y1, x2, y2] = el.flip ? [el.x, el.y + el.height, el.x + el.width, el.y] : [el.x, el.y, el.x + el.width, el.y + el.height]
    ops.push(setLineCap(LineCapStyle.Round), moveTo(r(x1), r(H - y1)), lineTo(r(x2), r(H - y2)), stroke())
    return ops
  }

  // Inset by half the stroke so the whole stroke stays inside the element box.
  const x = el.x + sw / 2
  const w = Math.max(0, el.width - sw)
  const h = Math.max(0, el.height - sw)
  const bottom = H - (el.y + sw / 2) - h
  if (el.shape === 'rect') {
    ops.push(rectangle(r(x), r(bottom), r(w), r(h)))
  } else {
    ops.push(...ellipsePath(x + w / 2, bottom + h / 2, w / 2, h / 2))
  }
  ops.push(fillC && strokeC ? fillAndStroke() : fillC ? fill() : stroke())
  return ops
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): PDFOperator[] {
  const ox = rx * KAPPA
  const oy = ry * KAPPA
  return [
    moveTo(r(cx - rx), r(cy)),
    appendBezierCurve(r(cx - rx), r(cy + oy), r(cx - ox), r(cy + ry), r(cx), r(cy + ry)),
    appendBezierCurve(r(cx + ox), r(cy + ry), r(cx + rx), r(cy + oy), r(cx + rx), r(cy)),
    appendBezierCurve(r(cx + rx), r(cy - oy), r(cx + ox), r(cy - ry), r(cx), r(cy - ry)),
    appendBezierCurve(r(cx - ox), r(cy - ry), r(cx - rx), r(cy - oy), r(cx - rx), r(cy)),
    closePath(),
  ]
}

/**
 * Shapes follow the model's convention (inset stroke; corner-to-corner lines with round caps;
 * highlights multiply). Opacity applies to the shape as a whole like CSS `opacity`: when a
 * translucent shape has both fill and stroke it is painted through a transparency group so
 * the overlap isn't darker.
 */
export function shapeOperators(el: ShapeElement, ctx: DrawContext): PDFOperator[] {
  const H = ctx.pageHeight
  const paint = shapePaint(el, H)
  if (!paint || el.opacity <= 0) return []
  const alpha = Math.min(1, el.opacity)
  const blend = isHighlight(el) ? ('Multiply' as const) : undefined
  const both = el.shape !== 'line' && !!el.fillColor && !!el.strokeColor && el.strokeWidth > 0

  if (alpha < 1 && both) {
    const pad = el.strokeWidth
    const bbox = [el.x - pad, H - el.y - el.height - pad, el.x + el.width + pad, H - el.y + pad].map(r)
    const group = ctx.doc.context.formXObject(paint, {
      BBox: bbox,
      Resources: {},
      Group: { Type: 'Group', S: 'Transparency' },
    })
    const gs = ctx.res.graphicsState({ fill: alpha, stroke: alpha, blend })
    return ctx.res.tagged(ARTIFACT, [
      pushGraphicsState(),
      ...(gs ? [setGraphicsState(gs)] : []),
      drawObject(ctx.res.xObject(ctx.doc.context.register(group))),
      popGraphicsState(),
    ])
  }

  const gs = ctx.res.graphicsState({ fill: alpha, stroke: alpha, blend })
  return ctx.res.tagged(ARTIFACT, [pushGraphicsState(), ...(gs ? [setGraphicsState(gs)] : []), ...paint, popGraphicsState()])
}

/** Freehand ink: straight segments through the points, round caps and joins; lone points are dots. */
export function inkOperators(el: InkElement, ctx: DrawContext): PDFOperator[] {
  const H = ctx.pageHeight
  const c = parseColor(el.color)
  const sw = el.strokeWidth
  if (sw <= 0) return []
  const paths: PDFOperator[] = []
  const dots: PDFOperator[] = []
  for (const s of el.strokes) {
    const pts: [number, number][] = []
    for (let i = 0; i + 1 < s.length; i += 2) pts.push([el.x + s[i] * el.width, H - (el.y + s[i + 1] * el.height)])
    if (!pts.length) continue
    const degenerate = pts.every(([x, y]) => Math.abs(x - pts[0][0]) < 1e-6 && Math.abs(y - pts[0][1]) < 1e-6)
    if (degenerate) {
      dots.push(...ellipsePath(pts[0][0], pts[0][1], sw / 2, sw / 2))
      continue
    }
    paths.push(moveTo(r(pts[0][0]), r(pts[0][1])))
    for (let i = 1; i < pts.length; i++) paths.push(lineTo(r(pts[i][0]), r(pts[i][1])))
  }
  if (!paths.length && !dots.length) return []
  const gs = c.a < 1 ? ctx.res.graphicsState({ fill: c.a, stroke: c.a }) : null
  const ops: PDFOperator[] = [pushGraphicsState()]
  if (gs) ops.push(setGraphicsState(gs))
  if (paths.length) {
    ops.push(
      setStrokingRgbColor(c.r, c.g, c.b),
      setLineWidth(r(sw)),
      setLineCap(LineCapStyle.Round),
      setLineJoin(LineJoinStyle.Round),
      ...paths,
      stroke(),
    )
  }
  if (dots.length) ops.push(setFillingRgbColor(c.r, c.g, c.b), ...dots, fill())
  ops.push(popGraphicsState())
  return ctx.res.tagged(ARTIFACT, ops)
}
