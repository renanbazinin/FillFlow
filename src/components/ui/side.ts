/** A side of an anchor: physical, or 'start' / 'end' (left / right, mirrored in a right-to-left interface). */
export type Side = 'top' | 'bottom' | 'left' | 'right' | 'start' | 'end'

/** The physical side for a logical one in the given reading direction. */
export function physicalSide(side: Side, dir: 'ltr' | 'rtl'): 'top' | 'bottom' | 'left' | 'right' {
  if (side === 'start') return dir === 'rtl' ? 'right' : 'left'
  if (side === 'end') return dir === 'rtl' ? 'left' : 'right'
  return side
}
