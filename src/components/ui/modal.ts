import { dismissPassingToasts } from './toasts'

/*
 * Behaviour shared by our modals (Dialog, Sheet and ConfirmHost). They open from app state, not
 * from a Radix Trigger, so Radix has nothing to hand focus back to when they close and focus would
 * drop to <body>. Run these as the content's onOpenAutoFocus / onCloseAutoFocus, after the
 * caller's own handlers.
 */

/**
 * Matches an open overlay that owns the keyboard: a dialog (popovers and sheets are dialogs too),
 * an alert dialog or a menu. App-wide keys, paste and drops leave the page alone while one is up.
 */
export const OPEN_OVERLAY = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]'

/** What had focus when a modal opened, keyed by the modal's content element. */
const openers = new WeakMap<EventTarget, HTMLElement>()

/**
 * On open: remember the opener, and clear the passing toasts, which float above modals and would
 * cover them (errors stay up, as do the messages that stay until acted on).
 */
export function onModalOpen(e: Event): void {
  const opener = focusOwner()
  if (e.target && opener) openers.set(e.target, opener)
  dismissPassingToasts({ keepErrors: true })
}

/** What has focus; for a menu item (it goes away with its menu), the button that opened the menu. */
function focusOwner(): HTMLElement | null {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || active === document.body) return null
  const menu = active.closest('[role="menu"]')
  const trigger = menu && document.getElementById(menu.getAttribute('aria-labelledby') ?? '')
  return trigger ?? active
}

/**
 * On close: give focus back to the opener, unless the caller prevented that or something else has
 * taken focus meanwhile. (After a click or tap the opener isn't :focus-visible, so no ring shows.)
 */
export function onModalClose(e: Event): void {
  const opener = e.target ? openers.get(e.target) : undefined
  if (e.target) openers.delete(e.target)
  if (e.defaultPrevented) return
  // Radix would focus its (missing) Trigger instead.
  e.preventDefault()
  const current = document.activeElement
  if (opener?.isConnected && (!current || current === document.body)) opener.focus({ preventScroll: true })
}

/** A press on a toast (they float above modals) is meant for the toast, not to dismiss the modal. */
export function isToastTarget(e: Event): boolean {
  return e.target instanceof Element && e.target.closest('[data-sonner-toast]') !== null
}
