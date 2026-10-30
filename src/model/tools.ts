import {
  CalendarDays,
  Check,
  Circle,
  Dot,
  Hand,
  Highlighter,
  ImagePlus,
  Minus,
  MousePointer2,
  PenLine,
  Pencil,
  Signature,
  Square,
  Eraser,
  Type,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { ToolId } from './types'

export type ToolGroup = 'navigate' | 'fill' | 'sign' | 'draw'

export interface ToolDef {
  id: ToolId
  label: string
  /** One-line help shown in tooltips. */
  hint: string
  /** Single-key shortcut (case-insensitive), shown in tooltips. */
  shortcut?: string
  icon: LucideIcon
  group: ToolGroup
  /**
   * How the tool creates content:
   *  - 'click': one click/tap places an element at the pointer,
   *  - 'drag':  press-drag draws a box/line (a plain click makes a default-sized one),
   *  - 'draw':  freehand strokes,
   *  - 'none':  select / pan.
   */
  placement: 'click' | 'drag' | 'draw' | 'none'
}

export const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', hint: 'Select, move and resize items', shortcut: 'V', icon: MousePointer2, group: 'navigate', placement: 'none' },
  { id: 'hand', label: 'Pan', hint: 'Drag to scroll the document (or hold Space)', shortcut: 'H', icon: Hand, group: 'navigate', placement: 'none' },
  { id: 'text', label: 'Text', hint: 'Click anywhere to type', shortcut: 'T', icon: Type, group: 'fill', placement: 'click' },
  { id: 'check', label: 'Checkmark', hint: 'Click to add a ✓', shortcut: 'C', icon: Check, group: 'fill', placement: 'click' },
  { id: 'cross', label: 'Cross', hint: 'Click to add a ✗', shortcut: 'X', icon: X, group: 'fill', placement: 'click' },
  { id: 'dot', label: 'Dot', hint: 'Click to add a •', shortcut: 'O', icon: Dot, group: 'fill', placement: 'click' },
  { id: 'date', label: 'Date', hint: "Click to insert today's date", shortcut: 'D', icon: CalendarDays, group: 'fill', placement: 'click' },
  { id: 'signature', label: 'Signature', hint: 'Draw, type or upload your signature', shortcut: 'S', icon: Signature, group: 'sign', placement: 'click' },
  { id: 'initials', label: 'Initials', hint: 'Add your initials', shortcut: 'I', icon: PenLine, group: 'sign', placement: 'click' },
  { id: 'image', label: 'Image', hint: 'Insert a picture or stamp', shortcut: 'G', icon: ImagePlus, group: 'sign', placement: 'click' },
  { id: 'ink', label: 'Draw', hint: 'Freehand pen', shortcut: 'P', icon: Pencil, group: 'draw', placement: 'draw' },
  { id: 'highlight', label: 'Highlight', hint: 'Drag over text to highlight it', shortcut: 'M', icon: Highlighter, group: 'draw', placement: 'drag' },
  { id: 'whiteout', label: 'Whiteout', hint: 'Drag to cover content with white', shortcut: 'W', icon: Eraser, group: 'draw', placement: 'drag' },
  { id: 'rect', label: 'Rectangle', hint: 'Drag to draw a box', shortcut: 'R', icon: Square, group: 'draw', placement: 'drag' },
  { id: 'ellipse', label: 'Ellipse', hint: 'Drag to circle something', shortcut: 'E', icon: Circle, group: 'draw', placement: 'drag' },
  { id: 'line', label: 'Line', hint: 'Drag to draw a line (Shift snaps to 45°)', shortcut: 'L', icon: Minus, group: 'draw', placement: 'drag' },
]

export const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t])) as Record<ToolId, ToolDef>

export function toolForShortcut(key: string): ToolDef | undefined {
  const k = key.toUpperCase()
  return TOOLS.find((t) => t.shortcut === k)
}
