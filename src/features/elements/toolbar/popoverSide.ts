import { createContext, useContext, useMemo, useState, type RefObject } from 'react'
import { fitsAboveOrBelow, type ClientBox, type PopoverSide } from './position'

export interface ToolbarPopoverPlacement {
  /** Away from the selection (see `popoverSide`). */
  side: PopoverSide
  /** The selection's box on screen now; null while the bar sits over it. */
  selection: () => ClientBox | null
}

/** Set by the selection toolbar from where it sits. */
export const PopoverPlacementContext = createContext<ToolbarPopoverPlacement>({ side: 'bottom', selection: () => null })

/** The side the selection toolbar's menus open on: away from the selection. */
export function usePopoverSide(): PopoverSide {
  return useContext(PopoverPlacementContext).side
}

/** PopoverContent's distance from its anchor (its default `sideOffset`). */
const POPOVER_OFFSET = 8

/** For the popover's content: no taller than the room left on screen (Radix measures it), scrolling past that. */
export const POPOVER_FIT = 'max-h-(--radix-popover-content-available-height) overflow-y-auto overscroll-contain scrollbar-thin'

/**
 * Where a popover may go on screen, top to bottom: the visual viewport less the room
 * PopoverContent keeps from its edges (8px, or the safe area where that is wider).
 */
function screenSpan(): { top: number; bottom: number } {
  const vv = window.visualViewport
  const top = vv?.offsetTop ?? 0
  const height = vv?.height ?? window.innerHeight
  const style = getComputedStyle(document.documentElement)
  const room = (side: string) => Math.max(8, parseFloat(style.getPropertyValue(`--ff-safe-${side}`)) || 0)
  return { top: top + room('top'), bottom: top + height - room('bottom') }
}

/** A popover's whole height, also while it's cut to the room left on screen (and scrolls). */
const wholeHeight = (el: HTMLElement) => el.scrollHeight + el.offsetHeight - el.clientHeight

/**
 * A toolbar popover that opens away from the selection: spread `root` on its Popover, pass
 * `virtualRef` to a PopoverAnchor and `side` to its content (`trigger` and `content` are refs on
 * its button and its content). The anchor is its button stretched over the selection, so the
 * popover opens next to the button, away from the selection, and where there's no room for it
 * there, past the selection rather than over it. Where it fits past neither side, the anchor is the
 * button alone: the popover then opens over the selection, but on screen.
 */
export function useAwayPopover(trigger: RefObject<HTMLElement | null>, content: RefObject<HTMLElement | null>) {
  const { side, selection } = useContext(PopoverPlacementContext)
  const [open, setOpen] = useState(false)
  const virtualRef = useMemo(
    () => ({
      current: {
        getBoundingClientRect(): DOMRect {
          const t = trigger.current?.getBoundingClientRect() ?? new DOMRect()
          const sel = selection()
          if (!sel) return t
          const span = { top: Math.min(t.top, sel.top), bottom: Math.max(t.bottom, sel.bottom) }
          const el = content.current
          if (el && !fitsAboveOrBelow(span, wholeHeight(el) + POPOVER_OFFSET, screenSpan())) return t
          return new DOMRect(t.left, span.top, t.width, span.bottom - span.top)
        },
        // Where the popover looks for scrolling and movement to follow.
        get contextElement() {
          return trigger.current ?? undefined
        },
      },
    }),
    // A new anchor each time the popover opens: Radix takes a virtual anchor only when it changes,
    // and the button takes its place until then (it is the anchor until a custom one mounts, and
    // again when strict mode mounts it twice), which would leave it on a button no longer there.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `open` renews it
    [trigger, content, selection, open],
  )
  return { root: { open, onOpenChange: setOpen }, side, virtualRef }
}
