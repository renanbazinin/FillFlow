/** Rounds to 1/10000 pt: far below anything visible, and keeps content streams compact. */
export function r(v: number): number {
  const n = Math.round(v * 10000) / 10000
  return n === 0 ? 0 : n
}
