import type { SignatureRole } from './library'

/** Footprint of the signing surface, shared by the Draw and Upload tabs so switching doesn't jump. */
export const PAD_FRAME: Record<SignatureRole, string> = {
  signature: 'aspect-[3/1] min-h-[148px] w-full',
  initials: 'aspect-[8/5] w-full max-w-[400px] mx-auto',
}
