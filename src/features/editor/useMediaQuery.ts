import { useCallback, useSyncExternalStore } from 'react'

/** Live `matchMedia` result. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** Layout breakpoints shared by the editor shell (keep in sync with the Tailwind classes). */
export const LEFT_PANEL_INLINE = '(min-width: 1024px)'
export const RIGHT_PANEL_INLINE = '(min-width: 1280px)'
export const COMPACT_LAYOUT = '(max-width: 639.98px)'
/** The top bar hides its zoom group (`max-md`); the overflow menu offers zoom instead. */
export const ZOOM_IN_MENU = '(max-width: 767.98px)'
