/** Calls `onChange` whenever window.devicePixelRatio changes (browser zoom, moving to another monitor). */
export function watchDevicePixelRatio(onChange: (dpr: number) => void): () => void {
  if (typeof window === 'undefined' || typeof matchMedia !== 'function') return () => {}
  let query: MediaQueryList | null = null
  const listen = () => {
    query?.removeEventListener('change', handle)
    query = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    query.addEventListener('change', handle)
  }
  const handle = () => {
    onChange(window.devicePixelRatio || 1)
    listen()
  }
  onChange(window.devicePixelRatio || 1)
  listen()
  return () => query?.removeEventListener('change', handle)
}
