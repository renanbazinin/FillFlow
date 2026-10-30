import { useSyncExternalStore } from 'react'
import type { ToolId } from '../../model/types'
import { useEditor } from '../../store/editor'

export const SHAPE_TOOLS = ['rect', 'ellipse', 'line'] as const
export type ShapeTool = (typeof SHAPE_TOOLS)[number]

export function isShapeTool(tool: ToolId): tool is ShapeTool {
  return (SHAPE_TOOLS as readonly ToolId[]).includes(tool)
}

// The last shape used (picked in the dock or via its keyboard shortcut) is what the dock shows.
let lastShape: ShapeTool = 'rect'
const listeners = new Set<() => void>()

useEditor.subscribe(
  (s) => s.tool,
  (tool) => {
    if (isShapeTool(tool) && tool !== lastShape) {
      lastShape = tool
      listeners.forEach((l) => l())
    }
  },
)

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function useLastShape(): ShapeTool {
  return useSyncExternalStore(subscribe, () => lastShape, () => lastShape)
}
