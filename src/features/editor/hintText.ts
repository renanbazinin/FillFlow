import { getT } from '../../i18n'
import { TOOL_BY_ID } from '../../model/tools'
import type { ToolId } from '../../model/types'

/** A key that helps, and what it does: a key cap, then the words ("Enter" "to add"). */
export interface KeyHelp {
  /** The key's name on its key cap (the same in every language). */
  key: string
  /** What it does, after the key cap. */
  action: string
}

export interface ToolHintText {
  /** What to do next, e.g. "Click anywhere to type". */
  text: string
  /** The keys that help, in order ("Enter to add · Esc to finish"); none on a touch screen. */
  keys: KeyHelp[]
}

/** The tools that place something made or picked first: a signature, initials, an image. */
type AssetTool = 'signature' | 'initials' | 'image'

const isAssetTool = (tool: ToolId): tool is AssetTool => tool === 'signature' || tool === 'initials' || tool === 'image'

/**
 * The hint chip shown above the dock while a creation tool is active (null for select/pan), in
 * the interface language. `armed` = an asset is waiting to be placed (signature / initials / image
 * tools).
 */
export function toolHint(tool: ToolId, opts: { armed: boolean; touch: boolean }): ToolHintText | null {
  const def = TOOL_BY_ID[tool]
  if (!def || def.placement === 'none') return null
  const h = getT().editor.hint
  const placing = opts.armed && isAssetTool(tool) ? tool : null
  const text = placing ? (opts.touch ? h.placeTouch : h.place)[placing] : opts.touch ? def.touchHint : def.hint
  if (opts.touch) return { text, keys: [] }
  // Enter adds the tool's item in the middle of the view (useEditingShortcuts): not a drawing, and a
  // signature, initials or picture only once there's one to place.
  const enter = def.placement !== 'draw' && !isAssetTool(tool)
  const esc = { key: 'Esc', action: h.keys.finish }
  const keys = placing
    ? [{ key: 'Enter', action: h.keys.place }, { key: 'Esc', action: h.keys.cancel }]
    : enter
      ? [{ key: 'Enter', action: h.keys.add }, esc]
      : [esc]
  return { text, keys }
}
