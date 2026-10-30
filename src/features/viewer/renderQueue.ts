/**
 * A tiny priority scheduler for page/thumbnail rendering. pdf.js renders on the main thread in
 * slices, so running every visible page at once only delays the first one; instead at most
 * `concurrency` jobs run, and the next job is chosen when a slot frees up by asking each queued job
 * for its *current* priority (lower runs first), so pages that scrolled into view jump the queue.
 */

export type RenderJob = (signal: AbortSignal) => Promise<void>

interface Entry {
  run: RenderJob
  priority: () => number
  controller: AbortController
}

export interface RenderQueue {
  /** Queues a job; returns a function that cancels it (aborting its signal if it is already running). */
  schedule(run: RenderJob, priority?: () => number): () => void
  readonly pending: number
  readonly running: number
}

export function createRenderQueue(concurrency = 2): RenderQueue {
  const queue: Entry[] = []
  let running = 0

  function readPriority(entry: Entry): number {
    try {
      const p = entry.priority()
      return Number.isFinite(p) ? p : Number.MAX_SAFE_INTEGER
    } catch {
      return Number.MAX_SAFE_INTEGER
    }
  }

  function takeNext(): Entry | undefined {
    let best = -1
    let bestPriority = Infinity
    // `queue` is in insertion order and the comparison is strict, so ties stay FIFO.
    for (let i = 0; i < queue.length; i++) {
      const p = readPriority(queue[i])
      if (p < bestPriority) {
        best = i
        bestPriority = p
      }
    }
    return best >= 0 ? queue.splice(best, 1)[0] : undefined
  }

  function pump() {
    while (running < concurrency && queue.length) {
      const entry = takeNext()
      if (!entry) return
      running++
      let job: Promise<void>
      try {
        job = Promise.resolve(entry.run(entry.controller.signal))
      } catch (err) {
        job = Promise.reject(err)
      }
      job
        .catch((err) => {
          if (!entry.controller.signal.aborted) console.warn('[viewer] render job failed', err)
        })
        .finally(() => {
          running--
          pump()
        })
    }
  }

  return {
    schedule(run, priority = () => 0) {
      const entry: Entry = { run, priority, controller: new AbortController() }
      queue.push(entry)
      // Let callers schedule a batch (e.g. every page that became visible) before choosing.
      queueMicrotask(pump)
      return () => {
        const i = queue.indexOf(entry)
        if (i >= 0) queue.splice(i, 1)
        entry.controller.abort()
      }
    },
    get pending() {
      return queue.length
    },
    get running() {
      return running
    },
  }
}

/** Shared by the page canvases and the thumbnails. */
export const renderQueue = createRenderQueue(2)
