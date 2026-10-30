/** Client-space box (CSS px). */
export interface ClientBox {
  left: number
  top: number
  right: number
  bottom: number
}

export interface ToolbarPlacement {
  x: number
  y: number
  side: 'top' | 'bottom' | 'inside'
}

/**
 * Where to put the floating toolbar for a selection: centered above it, flipped below when
 * there's no room, pinned inside the visible area when neither fits, and hidden (null) when
 * the selection is scrolled out of view.
 */
export function placeToolbar(
  anchor: ClientBox,
  bar: { width: number; height: number },
  bounds: ClientBox,
  gap = 10,
  margin = 8,
): ToolbarPlacement | null {
  if (anchor.bottom < bounds.top || anchor.top > bounds.bottom || anchor.right < bounds.left || anchor.left > bounds.right) return null
  const minY = bounds.top + margin
  const maxY = bounds.bottom - margin - bar.height
  let y = anchor.top - gap - bar.height
  let side: ToolbarPlacement['side'] = 'top'
  if (y < minY) {
    y = anchor.bottom + gap
    side = 'bottom'
    if (y > maxY) {
      y = Math.max(minY, Math.min(anchor.top - gap - bar.height, maxY))
      side = 'inside'
    }
  }
  const minX = bounds.left + margin
  const maxX = Math.max(minX, bounds.right - margin - bar.width)
  const x = Math.min(Math.max(anchor.left + (anchor.right - anchor.left) / 2 - bar.width / 2, minX), maxX)
  return { x, y, side }
}

export function intersectBoxes(a: ClientBox, b: ClientBox): ClientBox {
  return { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) }
}
