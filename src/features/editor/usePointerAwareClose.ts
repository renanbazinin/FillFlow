import { useRef } from 'react'

/**
 * Radix menus and popovers hand focus back to their trigger when they close, which also pops
 * the trigger's tooltip. That's right after keyboard use, but noise after a click or tap. Spread
 * the returned handlers on the menu/popover content to skip the refocus for pointer selections.
 */
export function usePointerAwareClose() {
  const byPointer = useRef(false)
  return {
    onPointerDownCapture: () => {
      byPointer.current = true
    },
    onKeyDownCapture: () => {
      byPointer.current = false
    },
    onCloseAutoFocus: (e: Event) => {
      if (byPointer.current) e.preventDefault()
      byPointer.current = false
    },
  }
}
