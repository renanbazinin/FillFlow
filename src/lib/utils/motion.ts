/** True when the user asked their system to minimize motion. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Behavior for scripted scrolls. An explicit 'smooth' overrides the stylesheet's reduced-motion
 * `scroll-behavior: auto`, so ask for it only when motion is welcome.
 */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth'
}
