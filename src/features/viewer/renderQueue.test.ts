import { describe, expect, it } from 'vitest'
import { createRenderQueue } from './renderQueue'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('createRenderQueue', () => {
  it('runs at most `concurrency` jobs at a time', async () => {
    const q = createRenderQueue(2)
    const gates = [deferred(), deferred(), deferred()]
    const started: number[] = []
    gates.forEach((g, i) =>
      q.schedule(async () => {
        started.push(i)
        await g.promise
      }),
    )
    await tick()
    expect(started).toEqual([0, 1])
    expect(q.running).toBe(2)
    expect(q.pending).toBe(1)
    gates[0].resolve()
    await tick()
    expect(started).toEqual([0, 1, 2])
    gates[1].resolve()
    gates[2].resolve()
    await tick()
    expect(q.running).toBe(0)
  })

  it('picks the lowest current priority, FIFO on ties', async () => {
    const q = createRenderQueue(1)
    const order: string[] = []
    const gate = deferred()
    q.schedule(async () => {
      order.push('blocker')
      await gate.promise
    })
    await tick()
    let farPriority = 100
    q.schedule(async () => void order.push('far'), () => farPriority)
    q.schedule(async () => void order.push('mid-a'), () => 50)
    q.schedule(async () => void order.push('mid-b'), () => 50)
    // The "far" page scrolls into view while waiting: its priority is read when a slot frees up.
    farPriority = 0
    gate.resolve()
    await tick()
    await tick()
    expect(order).toEqual(['blocker', 'far', 'mid-a', 'mid-b'])
  })

  it('cancelling a queued job removes it; cancelling a running job aborts its signal', async () => {
    const q = createRenderQueue(1)
    const gate = deferred()
    let aborted = false
    const cancelRunning = q.schedule(async (signal) => {
      signal.addEventListener('abort', () => {
        aborted = true
        gate.resolve()
      })
      await gate.promise
    })
    let ranQueued = false
    const cancelQueued = q.schedule(async () => {
      ranQueued = true
    })
    await tick()
    cancelQueued()
    expect(q.pending).toBe(0)
    cancelRunning()
    await tick()
    expect(aborted).toBe(true)
    expect(ranQueued).toBe(false)
    expect(q.running).toBe(0)
  })

  it('keeps going after a job throws', async () => {
    const q = createRenderQueue(1)
    const order: string[] = []
    const warn = console.warn
    console.warn = () => {}
    try {
      q.schedule(async () => {
        throw new Error('boom')
      })
      q.schedule(() => {
        throw new Error('sync boom')
      })
      q.schedule(async () => void order.push('after'))
      await tick()
      await tick()
      await tick()
    } finally {
      console.warn = warn
    }
    expect(order).toEqual(['after'])
  })

  it('treats a throwing or NaN priority as lowest', async () => {
    const q = createRenderQueue(1)
    const order: string[] = []
    const gate = deferred()
    q.schedule(async () => {
      await gate.promise
    })
    await tick()
    q.schedule(async () => void order.push('nan'), () => Number.NaN)
    q.schedule(async () => void order.push('throws'), () => {
      throw new Error('detached')
    })
    q.schedule(async () => void order.push('ok'), () => 5)
    gate.resolve()
    await tick()
    await tick()
    await tick()
    expect(order[0]).toBe('ok')
    expect(order).toHaveLength(3)
  })
})
