import { TOOL_BY_ID } from '../../model/tools'
import type { ToolId } from '../../model/types'

export interface ToolHintText {
  /** What to do next, e.g. "Click anywhere to type". */
  text: string
  /** How to get out, e.g. "Esc to finish"; null when there's nothing useful to say (touch). */
  exit: string | null
}

const PLACE_ASSET: Partial<Record<ToolId, string>> = {
  signature: 'Click to place your signature',
  initials: 'Click to place your initials',
  image: 'Click to place the image',
}

/**
 * The hint chip shown above the dock while a creation tool is active (null for select/pan).
 * `armed` = an asset is waiting to be placed (signature / initials / image tools).
 */
export function toolHint(tool: ToolId, opts: { armed: boolean; touch: boolean }): ToolHintText | null {
  const def = TOOL_BY_ID[tool]
  if (!def || def.placement === 'none') return null
  const placing = opts.armed && PLACE_ASSET[tool]
  let text = placing || def.hint
  if (opts.touch) text = text.replace(/^Click\b/, 'Tap').replace(/\bclick\b/g, 'tap')
  const exit = opts.touch ? null : placing ? 'Esc to cancel' : 'Esc to finish'
  return { text, exit }
}
