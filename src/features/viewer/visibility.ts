/**
 * One shared IntersectionObserver per scroll area (cheaper than one per page). Elements register a
 * callback that receives `true` while they are within the observer's root margin. Registrations made
 * before the root element exists are queued.
 */
export class VisibilityRegistry {
  private observer: IntersectionObserver | null = null
  private readonly callbacks = new Map<Element, (near: boolean) => void>()
  private readonly rootMargin: string

  constructor(rootMargin: string) {
    this.rootMargin = rootMargin
  }

  /** Starts observing within `root` (null = the browser viewport); re-observes everything registered so far. */
  setRoot(root: Element | null): void {
    this.observer?.disconnect()
    this.observer = null
    if (typeof IntersectionObserver === 'undefined') {
      // Very old browsers: treat everything as visible.
      for (const cb of this.callbacks.values()) cb(true)
      return
    }
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) this.callbacks.get(entry.target)?.(entry.isIntersecting)
      },
      { root, rootMargin: this.rootMargin },
    )
    for (const el of this.callbacks.keys()) this.observer.observe(el)
  }

  observe(el: Element, callback: (near: boolean) => void): () => void {
    this.callbacks.set(el, callback)
    if (typeof IntersectionObserver === 'undefined') callback(true)
    this.observer?.observe(el)
    return () => {
      this.callbacks.delete(el)
      this.observer?.unobserve(el)
    }
  }

  disconnect(): void {
    this.observer?.disconnect()
    this.observer = null
  }
}

/** The closest ancestor that scrolls vertically (the thumbnails panel's scroll area), or null for the viewport. */
export function scrollParent(el: Element | null): HTMLElement | null {
  let node = el?.parentElement ?? null
  while (node && node !== document.body && node !== document.documentElement) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return node
    node = node.parentElement
  }
  return null
}
