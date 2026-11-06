import { toast } from 'sonner'

/**
 * The toaster of the messages that stay until acted on (App mounts it just under the top bar, where
 * nothing opens): with the passing ones at the bottom, they would cover the popovers that open above
 * the tool dock.
 */
export const STAYING_TOASTER = 'staying'

/**
 * Clears the passing toasts, which would cover what opens over them (a modal, a list over the tool
 * dock). The messages that stay until acted on are left up, and with `keepErrors`, errors too.
 */
export function dismissPassingToasts(opts: { keepErrors?: boolean } = {}): void {
  for (const t of toast.getToasts()) {
    if ('toasterId' in t && t.toasterId === STAYING_TOASTER) continue
    if (opts.keepErrors && 'type' in t && t.type === 'error') continue
    toast.dismiss(t.id)
  }
}
