/** The signing pad never gets shorter than this (px) to fit; below it the dialog scrolls. */
export const PAD_MIN_HEIGHT = 96

export interface PadRoomMetrics {
  /** The dialog's height limit and its height now. */
  dialogMax: number
  dialog: number
  /** The dialog's scroll area: its visible height (padding included) and vertical padding. */
  scrollClient: number
  scrollPadding: number
  /** The dialog's tabs (the tab row and the open tab), and the signing pad in them. */
  tabs: number
  pad: number
}

/**
 * How tall the signing pad can be for the open tab to fit in the dialog: the most the scroll area
 * can show (the dialog at its tallest, less its header, footer and padding), less what the tabs
 * show besides the pad.
 */
export function padRoom(m: PadRoomMetrics): number {
  const visible = m.dialogMax - (m.dialog - m.scrollClient) - m.scrollPadding
  return Math.max(PAD_MIN_HEIGHT, Math.floor(visible - (m.tabs - m.pad)))
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return p
  return null
}

/**
 * Ref callback for the signature dialog's tabs: keeps the signing pad small enough for the open tab
 * to fit in the dialog. On a short screen (a phone held sideways) the pad would otherwise run under
 * the dialog's footer and push its own controls out of view, and a swipe on it draws rather than
 * scrolls. Sets `--pad-room` (read by PAD_FRAME) and keeps it up to date while mounted.
 */
export function fitPadInDialog(tabs: HTMLElement | null): (() => void) | undefined {
  const dialog = tabs?.closest<HTMLElement>('[role="dialog"]')
  const scroller = tabs && scrollParent(tabs)
  if (!tabs || !dialog || !scroller) return
  const fit = () => {
    const pad = tabs.querySelector<HTMLElement>('[data-signing-pad]')
    if (!pad) return // a tab without one (Type)
    // Layout sizes, not boxes on screen: the dialog may still be scaling in.
    const scroll = getComputedStyle(scroller)
    const room = padRoom({
      dialogMax: parseFloat(getComputedStyle(dialog).maxHeight) || innerHeight,
      dialog: dialog.offsetHeight,
      scrollClient: scroller.clientHeight,
      scrollPadding: parseFloat(scroll.paddingTop) + parseFloat(scroll.paddingBottom),
      tabs: tabs.offsetHeight,
      pad: pad.offsetHeight,
    })
    tabs.style.setProperty('--pad-room', `${room}px`)
  }
  fit() // before the dialog first shows
  // Again whenever what's in the tabs changes (another tab, an uploaded picture's settings…), before
  // it shows: a MutationObserver runs before the next paint.
  const mo = new MutationObserver(fit)
  mo.observe(tabs, { childList: true, subtree: true })
  // And when the screen changes size, once the dialog has followed (its description shows only on a
  // tall screen): animation frames run after that, still before the next paint.
  let frame = 0
  const onResize = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(fit)
  }
  addEventListener('resize', onResize)
  return () => {
    cancelAnimationFrame(frame)
    mo.disconnect()
    removeEventListener('resize', onResize)
  }
}
