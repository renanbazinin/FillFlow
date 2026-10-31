import { toast } from 'sonner'

/*
 * Behaviour shared by our modals (Dialog, Sheet and ConfirmHost). They open from app state, not
 * from a Radix Trigger, so Radix has nothing to hand focus back to when they close and focus would
 * drop to <body>. Run these as the content's onOpenAutoFocus / onCloseAutoFocus, after the
 * caller's own handlers.
 */

/** What had focus when a modal opened, keyed by the modal's content element. */
const openers = new WeakMap<EventTarget, HTMLElement>()

/** On open: remember the opener and clear passing toasts. */
export function onModalOpen(e: Event): void {
  const opener = focusOwner()
  if (e.target && opener) openers.set(e.target, opener)
  dismissPassingToasts()
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

/** Toasts float above modals and would cover them: clear the passing ones. Errors stay up. */
function dismissPassingToasts(): void {
  for (const t of toast.getToasts()) {
    if (!('type' in t && t.type === 'error')) toast.dismiss(t.id)
  }
}
