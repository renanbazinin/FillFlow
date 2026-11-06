import { useEffect, useState, type RefObject } from 'react'

/** A control wide (px): wherever the strip cuts, a control can be seen fading out. */
const FADE = 40

/**
 * Edge fades (a mask image) for a strip that scrolls sideways, only where it can scroll further,
 * so controls cut off at an edge read as "more this way". Follows the strip's size and its first
 * child's, where the content lives.
 */
export function useScrollFades(ref: RefObject<HTMLElement | null>, enabled = true): string | undefined {
  const [edges, setEdges] = useState({ start: false, end: false })
  useEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    const update = () => {
      const start = el.scrollLeft > 2
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
      setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
    }
    el.addEventListener('scroll', update, { passive: true })
    // Also fires once right after observe(), which sets the initial state.
    const ro = new ResizeObserver(update)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [ref, enabled])
  if (!enabled || (!edges.start && !edges.end)) return undefined
  const a = edges.start ? `transparent 0, #000 ${FADE}px` : '#000 0'
  const b = edges.end ? `#000 calc(100% - ${FADE}px), transparent 100%` : '#000 100%'
  return `linear-gradient(to right, ${a}, ${b})`
}
