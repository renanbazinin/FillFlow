import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAutosaver, type AutosaverOptions } from './autosaver'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/** A save function whose calls can be resolved/rejected by the test. */
function controllableSave() {
  const calls: { snapshot: string; resolve: () => void; reject: (e: unknown) => void }[] = []
  const save = vi.fn(
    (snapshot: string) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ snapshot, resolve, reject })
      }),
  )
  return { save, calls }
}

function setup(overrides: Partial<AutosaverOptions<string>> = {}) {
  const events: string[] = []
  const { save, calls } = controllableSave()
  const saver = createAutosaver<string>({
    delay: 600,
    save,
    retryDelays: [1000, 5000],
    onStart: (s) => events.push(`start:${s}`),
    onSuccess: (s) => events.push(`ok:${s}`),
    onError: (s) => events.push(`error:${s}`),
    ...overrides,
  })
  return { saver, save, calls, events }
}

describe('createAutosaver', () => {
  it('debounces changes and saves only the latest snapshot', async () => {
    const { saver, save, calls, events } = setup()
    saver.schedule('a')
    await vi.advanceTimersByTimeAsync(400)
    saver.schedule('b')
    await vi.advanceTimersByTimeAsync(400)
    saver.schedule('c')
    expect(save).not.toHaveBeenCalled()
    expect(saver.queued).toBe(true)
    await vi.advanceTimersByTimeAsync(600)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('c')
    expect(saver.queued).toBe(false)
    expect(saver.busy).toBe(true)
    calls[0].resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(saver.busy).toBe(false)
    expect(events).toEqual(['start:c', 'ok:c'])
  })

  it('flush saves immediately and is a no-op when nothing is queued', async () => {
    const { saver, save, calls } = setup()
    await saver.flush()
    expect(save).not.toHaveBeenCalled()
    saver.schedule('a')
    const flushed = saver.flush()
    // The write starts synchronously (important for pagehide).
    expect(save).toHaveBeenCalledWith('a')
    calls[0].resolve()
    await flushed
    await vi.advanceTimersByTimeAsync(2000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('cancel drops the queued snapshot', async () => {
    const { saver, save } = setup()
    saver.schedule('a')
    saver.cancel()
    expect(saver.queued).toBe(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).not.toHaveBeenCalled()
  })

  it('reports only the most recent save when saves overlap', async () => {
    const { saver, calls, events } = setup()
    saver.schedule('a')
    void saver.flush()
    saver.schedule('b')
    void saver.flush()
    calls[1].resolve()
    await vi.advanceTimersByTimeAsync(0)
    calls[0].reject(new Error('late failure of a superseded save'))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(events).toEqual(['start:a', 'start:b', 'ok:b'])
    expect(saver.queued).toBe(false)
  })

  it('does not report success while newer changes are waiting', async () => {
    const { saver, calls, events } = setup()
    saver.schedule('a')
    void saver.flush()
    saver.schedule('b')
    calls[0].resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(events).toEqual(['start:a'])
    await vi.advanceTimersByTimeAsync(600)
    calls[1].resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(events).toEqual(['start:a', 'start:b', 'ok:b'])
  })

  it('keeps a failed snapshot queued, retries with back-off, then waits for the next change', async () => {
    const { saver, save, calls, events } = setup()
    saver.schedule('a')
    await vi.advanceTimersByTimeAsync(600)
    calls[0].reject(new DOMException('full', 'QuotaExceededError'))
    await vi.advanceTimersByTimeAsync(0)
    expect(events).toEqual(['start:a', 'error:a'])
    expect(saver.queued).toBe(true)

    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(2)
    calls[1].reject(new Error('still full'))
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).toHaveBeenCalledTimes(3)
    calls[2].reject(new Error('still full'))
    await vi.advanceTimersByTimeAsync(60_000)
    // Out of automatic retries: the snapshot waits for a flush or the next change.
    expect(save).toHaveBeenCalledTimes(3)
    expect(saver.queued).toBe(true)

    saver.schedule('b')
    await vi.advanceTimersByTimeAsync(600)
    expect(save).toHaveBeenLastCalledWith('b')
    calls[3].resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(events.slice(-2)).toEqual(['start:b', 'ok:b'])
    expect(saver.queued).toBe(false)
  })

  it('a flush retries a failed snapshot right away', async () => {
    const { saver, save, calls } = setup()
    saver.schedule('a')
    void saver.flush()
    calls[0].reject(new Error('transient'))
    await vi.advanceTimersByTimeAsync(0)
    void saver.flush()
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith('a')
  })

  it('treats a synchronous throw like a failed save', async () => {
    const onError = vi.fn()
    const saver = createAutosaver<string>({
      delay: 10,
      save: () => {
        throw new Error('boom')
      },
      onError,
    })
    saver.schedule('a')
    await vi.advanceTimersByTimeAsync(10)
    expect(onError).toHaveBeenCalledWith('a', expect.objectContaining({ message: 'boom' }))
  })

  it('dispose stops pending work', async () => {
    const { saver, save } = setup()
    saver.schedule('a')
    saver.dispose()
    saver.schedule('b')
    await vi.advanceTimersByTimeAsync(5000)
    await saver.flush()
    expect(save).not.toHaveBeenCalled()
  })
})
