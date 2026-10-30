import { loadFont } from '../../../model/fonts'
import type { Element, FontId } from '../../../model/types'
import { clearMeasureCache } from '../../../lib/text/layout'
import { useEditor } from '../../../store/editor'
import { useElementsUi } from './ui'

const requested = new Set<string>()
let relayoutQueued = false

/**
 * Makes sure an element font face is loaded. The first time a face becomes available, cached
 * fallback measurements are dropped and every text element is re-measured (no undo step).
 */
export function ensureFont(fontId: FontId, bold: boolean): void {
  const key = `${fontId}:${bold ? 1 : 0}`
  if (requested.has(key)) return
  requested.add(key)
  void loadFont(fontId, bold).then(queueRelayout)
}

export function ensureFontsFor(elements: readonly Element[]): void {
  for (const el of elements) if (el.kind === 'text') ensureFont(el.fontId, el.bold)
}

function queueRelayout() {
  if (relayoutQueued) return
  relayoutQueued = true
  setTimeout(() => {
    relayoutQueued = false
    clearMeasureCache()
    useEditor.getState().relayoutText()
    useElementsUi.setState((s) => ({ fontVersion: s.fontVersion + 1 }))
  }, 0)
}
