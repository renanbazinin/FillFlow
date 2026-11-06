let ios: boolean | null = null

/** iPhone/iPad (including iPadOS that reports itself as a Mac). */
export function isIOS(): boolean {
  if (ios === null) {
    ios =
      typeof navigator !== 'undefined' &&
      (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
  }
  return ios
}
