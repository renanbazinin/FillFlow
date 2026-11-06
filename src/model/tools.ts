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
import { getT } from '../i18n'
import type { ToolId } from './types'

export type ToolGroup = 'navigate' | 'fill' | 'sign' | 'draw'

export interface ToolDef {
  id: ToolId
  /** The tool's name in the interface language (read when shown: it follows the language). */
  readonly label: string
  /** One-line help shown in tooltips. */
  readonly hint: string
  /** The same help on a touch screen ("Tap…"). */
  readonly touchHint: string
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

/** A tool whose words (src/i18n/<language>/tools.ts) are read in the current language each time. */
function tool(def: Omit<ToolDef, 'label' | 'hint' | 'touchHint'>): ToolDef {
  return {
    ...def,
    get label() {
      return getT().tools[def.id].label
    },
    get hint() {
      return getT().tools[def.id].hint
    },
    get touchHint() {
      return getT().tools[def.id].touchHint
    },
  }
}

export const TOOLS: ToolDef[] = [
  tool({ id: 'select', shortcut: 'V', icon: MousePointer2, group: 'navigate', placement: 'none' }),
  tool({ id: 'hand', shortcut: 'H', icon: Hand, group: 'navigate', placement: 'none' }),
  tool({ id: 'text', shortcut: 'T', icon: Type, group: 'fill', placement: 'click' }),
  tool({ id: 'check', shortcut: 'C', icon: Check, group: 'fill', placement: 'click' }),
  tool({ id: 'cross', shortcut: 'X', icon: X, group: 'fill', placement: 'click' }),
  tool({ id: 'dot', shortcut: 'O', icon: Dot, group: 'fill', placement: 'click' }),
  tool({ id: 'date', shortcut: 'D', icon: CalendarDays, group: 'fill', placement: 'click' }),
  tool({ id: 'signature', shortcut: 'S', icon: Signature, group: 'sign', placement: 'click' }),
  tool({ id: 'initials', shortcut: 'I', icon: PenLine, group: 'sign', placement: 'click' }),
  tool({ id: 'image', shortcut: 'G', icon: ImagePlus, group: 'sign', placement: 'click' }),
  tool({ id: 'ink', shortcut: 'P', icon: Pencil, group: 'draw', placement: 'draw' }),
  tool({ id: 'highlight', shortcut: 'M', icon: Highlighter, group: 'draw', placement: 'drag' }),
  tool({ id: 'whiteout', shortcut: 'W', icon: Eraser, group: 'draw', placement: 'drag' }),
  tool({ id: 'rect', shortcut: 'R', icon: Square, group: 'draw', placement: 'drag' }),
  tool({ id: 'ellipse', shortcut: 'E', icon: Circle, group: 'draw', placement: 'drag' }),
  tool({ id: 'line', shortcut: 'L', icon: Minus, group: 'draw', placement: 'drag' }),
]

export const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t])) as Record<ToolId, ToolDef>

export function toolForShortcut(key: string): ToolDef | undefined {
  const k = key.toUpperCase()
  return TOOLS.find((t) => t.shortcut === k)
}
