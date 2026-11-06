import type { SignatureRole } from './library'

/**
 * Footprint of the signing surface (marked `data-signing-pad`), shared by the Draw and Upload tabs
 * so switching doesn't jump. On a short screen `--pad-room` caps its height (see fitPadInDialog),
 * and its width follows, so a drawing keeps its proportions whatever the screen.
 */
export const PAD_FRAME: Record<SignatureRole, string> = {
  signature: 'aspect-[3/1] min-h-[min(148px,var(--pad-room,148px))] w-full max-w-[calc(var(--pad-room,100vh)*3)] mx-auto',
  initials: 'aspect-[8/5] w-full max-w-[min(400px,calc(var(--pad-room,100vh)*1.6))] mx-auto',
}

/**
 * A screen too short for the Draw tab's controls under the pad (a phone held sideways): they move
 * up beside the tabs.
 */
export const SHORT_SCREEN = '(max-height: 500px)'

/**
 * Disabled look for a ghost button that stays focusable (pair with `aria-disabled`): a focused
 * button that disables itself drops focus to <body>, out of the dialog.
 */
export const SOFT_DISABLED = 'aria-disabled:pointer-events-none aria-disabled:opacity-40'
