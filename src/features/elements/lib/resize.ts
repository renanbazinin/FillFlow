import { getT } from '../../../i18n'
import { MIN_ELEMENT_SIZE } from '../../../model/elements'
import type { Element, ElementPatch, Point } from '../../../model/types'
import type { TextMeasurer } from '../../../lib/text/layout'
import {
  clampPoint,
  lineEndpoints,
  lineFromEndpoints,
  locksAspect,
  resizeRect,
  resizeTextElement,
  snapAngle45,
  type HandleId,
  type Size,
} from './geometry'

/** A resize handle or one of a line's two endpoints. */
export type GrabTarget = HandleId | 'p0' | 'p1'

/**
 * The patch for dragging `target` of `start` (the element as it was when the gesture began)
 * by `delta` points. Shift locks the aspect ratio of free shapes, or snaps a line to 45°.
 */
export function resizeElementPatch(start: Element, target: GrabTarget, delta: Point, shift: boolean, page: Size, measure?: TextMeasurer): ElementPatch {
  if (target === 'p0' || target === 'p1') {
    if (start.kind !== 'shape') return {}
    const [a, b] = lineEndpoints(start)
    const moving = target === 'p0' ? a : b
    const anchor = target === 'p0' ? b : a
    const raw = { x: moving.x + delta.x, y: moving.y + delta.y }
    const p = shift ? snapAngle45(anchor, raw, page) : clampPoint(raw, page)
    return target === 'p0' ? lineFromEndpoints(p, anchor) : lineFromEndpoints(anchor, p)
  }
  if (start.kind === 'text') return resizeTextElement(start, target, delta, page, measure)
  const r = resizeRect(start, target, delta, { keepAspect: locksAspect(start) || shift, min: MIN_ELEMENT_SIZE, page })
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** The little readout shown under an element while it's being resized (in the interface's language). */
export function sizeReadout(el: Element): string {
  const t = getT().elements
  if (el.kind === 'text') return t.points(round1(el.fontSize))
  if (el.kind === 'shape' && el.shape === 'line') {
    const len = Math.hypot(el.width, el.height)
    const deg = Math.round((Math.atan2(el.height, el.width) * 180) / Math.PI)
    const angle = el.flip ? deg : -deg
    return t.readout.line(Math.round(len), angle === 0 ? 0 : angle)
  }
  return t.readout.box(Math.round(el.width), Math.round(el.height))
}
