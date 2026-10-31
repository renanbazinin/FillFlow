import type { SignatureRole } from './library'

/** Footprint of the signing surface, shared by the Draw and Upload tabs so switching doesn't jump. */
export const PAD_FRAME: Record<SignatureRole, string> = {
  signature: 'aspect-[3/1] min-h-[148px] w-full',
  initials: 'aspect-[8/5] w-full max-w-[400px] mx-auto',
}

/**
 * Disabled look for a ghost button that stays focusable (pair with `aria-disabled`): a focused
 * button that disables itself drops focus to <body>, out of the dialog.
 */
export const SOFT_DISABLED = 'aria-disabled:pointer-events-none aria-disabled:opacity-40'
