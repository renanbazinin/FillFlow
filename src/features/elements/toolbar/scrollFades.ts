import { useEffect, useState, type RefObject } from 'react'
import { useDir, type Direction } from '../../../i18n'

/** A control wide (px): wherever the strip cuts, a control can be seen fading out. */
const FADE = 40

/** Which ends of a strip that scrolls sideways have more to show. */
export interface ScrollEdges {
  start: boolean
  end: boolean
}

/**
 * Where a strip that scrolls sideways can scroll further, from its `scrollLeft`: left to right it
 * is 0 at the start and grows toward the end; right to left it is 0 at the start (the right edge)
 * and negative toward the end.
 */
export function scrollEdges(scrollLeft: number, clientWidth: number, scrollWidth: number): ScrollEdges {
  const scrolled = Math.abs(scrollLeft)
  return { start: scrolled > 2, end: scrolled + clientWidth < scrollWidth - 2 }
}

/**
 * The mask image fading the strip's ends that have more to show: the start is the left end, or the
 * right one in a right-to-left interface. None when it shows everything.
 */
export function fadeMask(edges: ScrollEdges, dir: Direction): string | undefined {
  if (!edges.start && !edges.end) return undefined
  const a = edges.start ? `transparent 0, #000 ${FADE}px` : '#000 0'
  const b = edges.end ? `#000 calc(100% - ${FADE}px), transparent 100%` : '#000 100%'
  return `linear-gradient(to ${dir === 'rtl' ? 'left' : 'right'}, ${a}, ${b})`
}

/**
 * Edge fades (a mask image) for a strip that scrolls sideways, only where it can scroll further,
 * so controls cut off at an edge read as "more this way". Follows the strip's size and its first
 * child's, where the content lives. The strip is interface: it reads the interface's way.
 */
export function useScrollFades(ref: RefObject<HTMLElement | null>, enabled = true): string | undefined {
  const dir = useDir()
  const [edges, setEdges] = useState<ScrollEdges>({ start: false, end: false })
  useEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    const update = () => {
      const next = scrollEdges(el.scrollLeft, el.clientWidth, el.scrollWidth)
      setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next))
    }
    el.addEventListener('scroll', update, { passive: true })
    // Also fires once right after observe(), which sets the initial state (again when the
    // language, and with it the way the strip reads and scrolls, changes).
    const ro = new ResizeObserver(update)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [ref, enabled, dir])
  return enabled ? fadeMask(edges, dir) : undefined
}
