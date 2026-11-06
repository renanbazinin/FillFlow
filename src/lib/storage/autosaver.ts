/**
 * Debounced "persist the latest snapshot" controller. Framework-agnostic (no store, no DOM) so
 * the timing rules can be unit tested; `autosave.ts` wires it to the editor.
 *
 *  - `schedule()` replaces the queued snapshot and restarts the debounce timer (but a burst of
 *    changes is still written every `maxWait` ms).
 *  - `flush()` saves the queued snapshot immediately (page hide, document switch) and resolves
 *    once the latest save has settled, so its outcome is known.
 *  - Saves are started in order and never awaited by each other, so the last one started is the
 *    one that ends up stored (IndexedDB runs overlapping readwrite transactions in order). Only
 *    the result of the most recent save is reported.
 *  - A failed snapshot stays queued: the next change replaces it, a flush retries it, and a few
 *    automatic retries back off in the meantime.
 */
export interface AutosaverOptions<T> {
  /** Debounce delay in ms. */
  delay: number
  /** Longest a change waits while newer ones keep restarting the debounce (default: no limit). */
  maxWait?: number
  /** Persists one snapshot. Should start its write synchronously (pagehide flushes). */
  save: (snapshot: T) => Promise<void>
  /** Delays (ms) of the automatic retries after a failure; then wait for the next change. */
  retryDelays?: number[]
  onStart?: (snapshot: T) => void
  /** The most recent save succeeded and nothing newer is queued. */
  onSuccess?: (snapshot: T) => void
  /** The most recent save failed. */
  onError?: (snapshot: T, error: unknown) => void
}

export interface Autosaver<T> {
  schedule(snapshot: T): void
  /** Saves now; with nothing queued, waits for the save in flight. Never rejects. */
  flush(): Promise<void>
  cancel(): void
  /** A snapshot is waiting to be saved. */
  readonly queued: boolean
  /** A save is in flight. */
  readonly busy: boolean
  /** Stops timers; queued work is dropped (flush first to keep it). */
  dispose(): void
}

export const DEFAULT_RETRY_DELAYS = [4000, 15_000, 60_000]

export function createAutosaver<T>(opts: AutosaverOptions<T>): Autosaver<T> {
  const retryDelays = opts.retryDelays ?? DEFAULT_RETRY_DELAYS
  let queued: { snapshot: T } | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  /** When the oldest change still waiting for a save was made. */
  let waitingSince: number | null = null
  let latest = 0
  let inFlight = 0
  let failures = 0
  let disposed = false
  /** The most recently started save, settled (never rejects). */
  let running: Promise<void> = Promise.resolve()

  function stopTimer() {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  function arm(ms: number) {
    stopTimer()
    timer = setTimeout(() => {
      timer = undefined
      void start()
    }, ms)
  }

  function start(): Promise<void> {
    stopTimer()
    if (!queued || disposed) return running
    const { snapshot } = queued
    queued = null
    waitingSince = null
    const id = ++latest
    inFlight++
    opts.onStart?.(snapshot)
    let pending: Promise<void>
    try {
      pending = Promise.resolve(opts.save(snapshot))
    } catch (err) {
      pending = Promise.reject(err)
    }
    running = pending.then(
      () => {
        inFlight--
        if (id !== latest) return
        failures = 0
        if (!queued) opts.onSuccess?.(snapshot)
      },
      (err: unknown) => {
        inFlight--
        // A newer save supersedes this one; its own result is what counts.
        if (id !== latest) return
        if (!queued && !disposed) {
          queued = { snapshot }
          const wait = retryDelays[failures]
          if (wait !== undefined) arm(wait)
        }
        failures++
        opts.onError?.(snapshot, err)
      },
    )
    return running
  }

  return {
    schedule(snapshot) {
      if (disposed) return
      queued = { snapshot }
      const now = Date.now()
      waitingSince ??= now
      arm(opts.maxWait === undefined ? opts.delay : Math.min(opts.delay, Math.max(0, waitingSince + opts.maxWait - now)))
    },
    flush: start,
    cancel() {
      stopTimer()
      queued = null
      waitingSince = null
    },
    get queued() {
      return queued !== null
    },
    get busy() {
      return inFlight > 0
    },
    dispose() {
      disposed = true
      stopTimer()
      queued = null
      waitingSince = null
    },
  }
}
