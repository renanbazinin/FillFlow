import type { Rect } from '../../../model/types'
import type { Size } from './geometry'

/**
 * Smart guides: while moving, the selection's edges and center snap to the edges/centers of
 * the other elements on the page and to the page's center lines.
 */

/** A candidate line: `pos` on the snapping axis, spanning `from`..`to` on the other axis. */
export interface SnapLine {
  pos: number
  from: number
  to: number
}

export interface SnapTargets {
  /** Vertical lines (x positions). */
  x: SnapLine[]
  /** Horizontal lines (y positions). */
  y: SnapLine[]
}

/** A guide to draw: a vertical (`axis: 'x'`) or horizontal line segment in view space. */
export interface Guide {
  axis: 'x' | 'y'
  pos: number
  from: number
  to: number
}

export interface SnapResult {
  dx: number
  dy: number
  guides: Guide[]
}

export function buildSnapTargets(others: readonly Rect[], page: Size): SnapTargets {
  const x: SnapLine[] = [{ pos: page.width / 2, from: 0, to: page.height }]
  const y: SnapLine[] = [{ pos: page.height / 2, from: 0, to: page.width }]
  for (const r of others) {
    const top = r.y
    const bottom = r.y + r.height
    const left = r.x
    const right = r.x + r.width
    for (const pos of [left, left + r.width / 2, right]) x.push({ pos, from: top, to: bottom })
    for (const pos of [top, top + r.height / 2, bottom]) y.push({ pos, from: left, to: right })
  }
  return { x, y }
}

const EPS = 1e-6

function bestOffset(edges: number[], lines: SnapLine[], threshold: number): number | null {
  let best: number | null = null
  for (const e of edges) {
    for (const l of lines) {
      const d = l.pos - e
      if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best) - EPS)) best = d
    }
  }
  return best
}

function guidesFor(axis: 'x' | 'y', edges: number[], lines: SnapLine[], spanFrom: number, spanTo: number): Guide[] {
  const byPos = new Map<number, Guide>()
  for (const l of lines) {
    if (!edges.some((e) => Math.abs(e - l.pos) < 1e-3)) continue
    const key = Math.round(l.pos * 1000) / 1000
    const g = byPos.get(key)
    if (g) {
      g.from = Math.min(g.from, l.from)
      g.to = Math.max(g.to, l.to)
    } else {
      byPos.set(key, { axis, pos: l.pos, from: Math.min(l.from, spanFrom), to: Math.max(l.to, spanTo) })
    }
  }
  return [...byPos.values()]
}

/**
 * Snaps a moving rect (already at its raw dragged position) to the targets within `threshold`
 * points. Returns the correction to apply and the guides to draw at the corrected position.
 */
export function snapMove(rect: Rect, targets: SnapTargets, threshold: number): SnapResult {
  const xEdges = [rect.x, rect.x + rect.width / 2, rect.x + rect.width]
  const yEdges = [rect.y, rect.y + rect.height / 2, rect.y + rect.height]
  const sx = bestOffset(xEdges, targets.x, threshold)
  const sy = bestOffset(yEdges, targets.y, threshold)
  const dx = sx ?? 0
  const dy = sy ?? 0
  const moved: Rect = { ...rect, x: rect.x + dx, y: rect.y + dy }
  const guides: Guide[] = []
  if (sx !== null) {
    const edges = [moved.x, moved.x + moved.width / 2, moved.x + moved.width]
    guides.push(...guidesFor('x', edges, targets.x, moved.y, moved.y + moved.height))
  }
  if (sy !== null) {
    const edges = [moved.y, moved.y + moved.height / 2, moved.y + moved.height]
    guides.push(...guidesFor('y', edges, targets.y, moved.x, moved.x + moved.width))
  }
  return { dx, dy, guides }
}
