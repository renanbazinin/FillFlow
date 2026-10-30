import type { Point, Rect } from '../../../model/types'
import type { BoxTool } from '../lib/placement'

/** Live preview while dragging out a shape. */
export type Draft = { kind: 'box'; tool: BoxTool; rect: Rect } | { kind: 'line'; a: Point; b: Point }
