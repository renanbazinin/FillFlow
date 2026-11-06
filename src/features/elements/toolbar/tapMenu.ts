import { useRef, useState, type MouseEvent, type PointerEvent } from 'react'

/**
 * Open state for a toolbar menu that a finger opens with a tap. Radix opens menus as soon as the
 * button is pressed, so a swipe meant to scroll the toolbar would open the menu instead. Mouse and
 * keyboard keep opening it on press. Spread `root` on the menu and `trigger` on its trigger.
 */
export function useTapMenu() {
  const [open, setOpen] = useState(false)
  const touch = useRef(false)
  return {
    root: { open, onOpenChange: setOpen },
    trigger: {
      onPointerDown(e: PointerEvent) {
        touch.current = e.pointerType === 'touch'
        // Radix leaves a press whose default was prevented alone.
        if (touch.current) e.preventDefault()
      },
      onClick(e: MouseEvent) {
        // A press of Enter or Space (no click count) was handled on keydown, even after a swipe.
        if (!touch.current || e.detail === 0) return
        touch.current = false
        setOpen((o) => !o)
      },
    },
  }
}
