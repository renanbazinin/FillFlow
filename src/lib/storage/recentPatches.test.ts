import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Db = typeof import('./db')
type Patches = typeof import('./recentPatches')
let db: Db
let patches: Patches

/** A real (never faked) macrotask: fake-indexeddb schedules its work with setImmediate. */
const nextTask = () =>
  new Promise<void>((resolve) => (globalThis as unknown as { setImmediate(cb: () => void): void }).setImmediate(resolve))

async function settle() {
  for (let i = 0; i < 20; i++) await nextTask()
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.resetModules()
  db = await import('./db')
  patches = await import('./recentPatches')
})

afterEach(() => {
  vi.useRealTimers()
})

const remember = (id: string) => db.rememberDocument({ id, name: `${id}.pdf`, size: 1, pageCount: 1 }, new Uint8Array([1]))

describe('patchRecentSoon', () => {
  it('patches an existing entry right away', async () => {
    await remember('a')
    await patches.patchRecentSoon('a', { filledCount: 2 })
    expect((await db.getRecentDocument('a'))?.filledCount).toBe(2)
  })

  it('waits for the entry of a document that is still being remembered', async () => {
    const done = patches.patchRecentSoon('late', { thumbnail: 'data:image/jpeg;base64,T' })
    await settle()
    expect(await db.getRecentDocument('late')).toBeNull()
    await remember('late')
    await vi.advanceTimersByTimeAsync(patches.RECENT_PATCH_RETRY_MS)
    await settle()
    await done
    expect((await db.getRecentDocument('late'))?.thumbnail).toBe('data:image/jpeg;base64,T')
  })

  it('coalesces patches: newer values win, other fields are kept', async () => {
    const runs = [
      patches.patchRecentSoon('c', { filledCount: 1, thumbnail: 'thumb' }),
      patches.patchRecentSoon('c', { filledCount: 2 }),
    ]
    await settle()
    runs.push(patches.patchRecentSoon('c', { filledCount: 3 }))
    await remember('c')
    await vi.advanceTimersByTimeAsync(patches.RECENT_PATCH_RETRY_MS)
    await settle()
    await Promise.all(runs)
    expect(await db.getRecentDocument('c')).toMatchObject({ filledCount: 3, thumbnail: 'thumb' })
  })

  it('gives up when the entry never appears, and starts over for a later patch', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const run = patches.patchRecentSoon('ghost', { filledCount: 1 })
    for (let i = 0; i < patches.RECENT_PATCH_ATTEMPTS; i++) {
      await settle()
      await vi.advanceTimersByTimeAsync(patches.RECENT_PATCH_RETRY_MS)
    }
    await run
    await remember('ghost')
    await settle()
    // The abandoned value was dropped…
    expect((await db.getRecentDocument('ghost'))?.filledCount).toBeUndefined()
    // …and a new patch goes through.
    await patches.patchRecentSoon('ghost', { filledCount: 5 })
    expect((await db.getRecentDocument('ghost'))?.filledCount).toBe(5)
    spy.mockRestore()
  })
})
