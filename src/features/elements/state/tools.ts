import type { ToolId } from '../../../model/types'
import { useEditor } from '../../../store/editor'
import { finishActiveTextEdit } from './textEdit'

/**
 * Switches tools from a shortcut or a shortcut-like button. The signature, initials and image
 * docks listen for the store's tool switching to them (with nothing armed) and open their
 * picker, so this only has to set the tool. Re-selecting the active tool is a no-op, which
 * keeps an armed signature (and a double-click tool lock) intact.
 */
export function activateTool(tool: ToolId): void {
  const s = useEditor.getState()
  if (s.tool === tool) return
  finishActiveTextEdit()
  useEditor.getState().setTool(tool)
}
