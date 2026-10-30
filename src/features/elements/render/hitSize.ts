let coarse: boolean | null = null

/** Whether the primary pointer is a finger (bigger hit areas). */
export function isCoarsePointer(): boolean {
  if (coarse === null) coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  return coarse
}

/** Minimum size (CSS px) of an element's hit area. */
export function minHitPx(): number {
  return isCoarsePointer() ? 28 : 14
}
