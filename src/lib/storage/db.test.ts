import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentSession } from '../../model/types'

type Db = typeof import('./db')
let db: Db
let now = 1_700_000_000_000

/** Each test gets an empty IndexedDB and a fresh module (db.ts caches its connections). */
beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  vi.resetModules()
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  db = await import('./db')
})

afterEach(() => {
  vi.restoreAllMocks()
})

const bytesOf = (...values: number[]) => new Uint8Array(values)

async function remember(id: string, at: number, extra: Partial<Parameters<Db['rememberDocument']>[0]> = {}) {
  now = at
  await db.rememberDocument({ id, name: `${id}.pdf`, size: 3, pageCount: 1, ...extra }, bytesOf(1, 2, 3))
}

const session = (docId: string, patch: Partial<DocumentSession> = {}): DocumentSession => ({
  version: 1,
  docId,
  fileName: `${docId}.pdf`,
  elements: [{ id: 'm', kind: 'mark', page: 0, x: 1, y: 2, width: 14, height: 14, shape: 'check', color: '#000000' }],
  formValues: { Name: 'Ada' },
  assets: {},
  updatedAt: 10,
  ...patch,
})

describe('documents', () => {
  it('stores the file and a recents entry', async () => {
    await remember('a', 1000)
    expect(await db.loadDocumentBytes('a')).toEqual(bytesOf(1, 2, 3))
    expect(await db.loadDocumentBytes('missing')).toBeNull()
    expect(await db.listRecentDocuments()).toEqual([
      { id: 'a', name: 'a.pdf', size: 3, pageCount: 1, addedAt: 1000, openedAt: 1000 },
    ])
    expect(await db.getRecentDocument('a')).toMatchObject({ id: 'a', name: 'a.pdf' })
    expect(await db.getRecentDocument('missing')).toBeNull()
  })

  it('stores a tight copy of a view into a larger buffer', async () => {
    const big = new Uint8Array(1024).map((_, i) => i % 251)
    await db.rememberDocument({ id: 'v', name: 'v.pdf', size: 4, pageCount: 1 }, big.subarray(10, 14))
    const stored = await db.loadDocumentBytes('v')
    expect(stored?.byteLength).toBe(4)
    expect(stored?.buffer.byteLength).toBe(4)
    expect([...(stored ?? [])]).toEqual([10, 11, 12, 13])
  })

  it('re-opening keeps addedAt, thumbnail and progress, and bumps openedAt', async () => {
    await remember('a', 1000)
    await db.updateRecentDocument('a', { thumbnail: 'data:image/jpeg;base64,xx', filledCount: 3 })
    await remember('a', 5000, { name: 'renamed.pdf' })
    expect(await db.getRecentDocument('a')).toEqual({
      id: 'a',
      name: 'renamed.pdf',
      size: 3,
      pageCount: 1,
      addedAt: 1000,
      openedAt: 5000,
      thumbnail: 'data:image/jpeg;base64,xx',
      filledCount: 3,
    })
  })

  it('lists the most recently opened first', async () => {
    await remember('a', 1000)
    await remember('b', 2000)
    await remember('c', 3000)
    await remember('a', 4000)
    expect((await db.listRecentDocuments()).map((d) => d.id)).toEqual(['a', 'c', 'b'])
  })

  it(`keeps at most MAX_RECENT_DOCUMENTS, dropping the oldest entries and files but keeping their work`, async () => {
    const total = db.MAX_RECENT_DOCUMENTS + 2
    for (let i = 0; i < total; i++) {
      await remember(`d${i}`, 1000 + i)
      await db.saveSession(session(`d${i}`))
    }
    const list = await db.listRecentDocuments()
    expect(list).toHaveLength(db.MAX_RECENT_DOCUMENTS)
    expect(list[0].id).toBe(`d${total - 1}`)
    expect(list.map((d) => d.id)).not.toContain('d0')
    expect(list.map((d) => d.id)).not.toContain('d1')
    expect(await db.loadDocumentBytes('d0')).toBeNull()
    expect(await db.loadDocumentBytes('d1')).toBeNull()
    expect(await db.loadDocumentBytes('d2')).not.toBeNull()
    // Opening the same file again restores the work.
    expect(await db.loadSession('d0')).toEqual(session('d0'))
    expect(await db.loadSession('d1')).toEqual(session('d1'))
    expect(await db.loadSession('d2')).not.toBeNull()
  })

  it('takes a document off the list without deleting its work', async () => {
    await remember('a', 1000)
    await db.saveSession(session('a'))
    await db.removeRecentDocument('a')
    expect(await db.listRecentDocuments()).toEqual([])
    expect(await db.loadDocumentBytes('a')).toBeNull()
    expect(await db.loadSession('a')).toEqual(session('a'))
  })

  it('deletes the work on documents that are no longer listed', async () => {
    await remember('listed', 1000)
    await db.saveSession(session('listed'))
    await db.saveSession(session('unlisted'))
    expect(await db.hasUnlistedSessions()).toBe(true)
    await db.forgetUnlistedSessions()
    expect(await db.hasUnlistedSessions()).toBe(false)
    expect(await db.loadSession('listed')).not.toBeNull()
    expect(await db.loadSession('unlisted')).toBeNull()
  })

  it('tells whether work is kept for documents that are no longer listed', async () => {
    expect(await db.hasUnlistedSessions()).toBe(false)
    await remember('a', 1000)
    await db.saveSession(session('a'))
    expect(await db.hasUnlistedSessions()).toBe(false)
    await db.removeRecentDocument('a')
    expect(await db.hasUnlistedSessions()).toBe(true)
  })

  it('lets go of the work on unlisted documents not worked on for a long time, and only that', async () => {
    const maxAge = db.UNLISTED_SESSION_MAX_AGE_MS
    await remember('listed', 1_800_000_000_000)
    await db.saveSession(session('listed', { updatedAt: now - 2 * maxAge }))
    await db.saveSession(session('stale', { updatedAt: now - maxAge - 1 }))
    await db.saveSession(session('recent', { updatedAt: now - maxAge + 1000 }))
    await db.forgetStaleSessions()
    expect(await db.loadSession('stale')).toBeNull()
    // Still within the time it is kept: opening the same file again brings it back.
    expect(await db.loadSession('recent')).toMatchObject({ updatedAt: now - maxAge + 1000 })
    // A listed document's work is never let go of, however old.
    expect(await db.loadSession('listed')).toMatchObject({ updatedAt: now - 2 * maxAge })
  })

  it('keeps unlisted work it can’t read when letting go of old work', async () => {
    await db.saveSession(session('unreadable', { updatedAt: 1 }))
    await db.saveSession(session('stale', { updatedAt: 1 }))
    const get = IDBObjectStore.prototype.get
    const read = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key: IDBValidKey | IDBKeyRange) {
      if (key !== 'unreadable') return get.call(this, key)
      // Its data is gone (e.g. a missing blob file): the read fails.
      const failing = {} as IDBRequest
      queueMicrotask(() => failing.onerror?.call(failing, new Event('error', { cancelable: true })))
      return failing
    })
    await db.forgetStaleSessions()
    read.mockRestore()
    expect(await db.loadSession('stale')).toBeNull()
    expect(await db.loadSession('unreadable')).not.toBeNull()
  })

  it('forgets a document completely', async () => {
    await remember('a', 1000)
    await remember('b', 2000)
    await db.saveSession(session('a'))
    await db.forgetDocument('a')
    expect(await db.loadDocumentBytes('a')).toBeNull()
    expect(await db.loadSession('a')).toBeNull()
    expect((await db.listRecentDocuments()).map((d) => d.id)).toEqual(['b'])
  })

  it('patches only entries that exist', async () => {
    expect(await db.patchRecentDocument('nope', { filledCount: 1 })).toBe(false)
    await db.updateRecentDocument('nope', { filledCount: 1 })
    expect(await db.listRecentDocuments()).toEqual([])
    await remember('a', 1000)
    expect(await db.patchRecentDocument('a', { filledCount: 2, id: 'hijack' })).toBe(true)
    expect(await db.getRecentDocument('a')).toMatchObject({ id: 'a', filledCount: 2 })
  })

  it('does not lose concurrent updates to the same entry', async () => {
    await remember('a', 1000)
    await Promise.all([
      db.updateRecentDocument('a', { thumbnail: 'thumb' }),
      db.updateRecentDocument('a', { filledCount: 7 }),
      remember('a', 2000),
      db.updateRecentDocument('a', { thumbnail: 'thumb2' }),
    ])
    expect(await db.getRecentDocument('a')).toMatchObject({ thumbnail: 'thumb2', filledCount: 7, addedAt: 1000, openedAt: 2000 })
  })

  it('ignores malformed recents entries', async () => {
    await remember('a', 1000)
    const { createStore, set } = await import('idb-keyval')
    await set('junk', 'not an entry', createStore('fillflow-recents', 'recents'))
    expect((await db.listRecentDocuments()).map((d) => d.id)).toEqual(['a'])
  })

  it('never hands out an entry without a name, and repairs unusable fields', async () => {
    const { createStore, set } = await import('idb-keyval')
    const store = createStore('fillflow-recents', 'recents')
    // Written by some other build: no name.
    await set('x', { id: 'x', size: 1, pageCount: 1, addedAt: 1, openedAt: 1 }, store)
    await set('y', { id: 'y', name: 'y.pdf', size: 'big', pageCount: null, openedAt: 5, thumbnail: 42, filledCount: 'many' }, store)
    expect(await db.getRecentDocument('x')).toBeNull()
    expect(await db.patchRecentDocument('x', { filledCount: 1 })).toBe(false)
    expect(await db.listRecentDocuments()).toEqual([{ id: 'y', name: 'y.pdf', size: 0, pageCount: 0, addedAt: 0, openedAt: 5 }])
    // Opening it again rewrites a clean entry.
    await remember('x', 2000)
    expect(await db.getRecentDocument('x')).toEqual({ id: 'x', name: 'x.pdf', size: 3, pageCount: 1, addedAt: 2000, openedAt: 2000 })
  })

  it('keeps when work was last saved', async () => {
    await remember('a', 1000)
    await db.updateRecentDocument('a', { editedAt: 3000, filledCount: 1 })
    await remember('a', 5000)
    expect(await db.getRecentDocument('a')).toMatchObject({ openedAt: 5000, editedAt: 3000 })
  })

  it('lists a document whose file there is no room for, marked as such, and says why it wasn’t stored', async () => {
    const quota = new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    const put = IDBObjectStore.prototype.put
    const full = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      // No room for the file; its small recents entry still fits.
      if (this.name === 'files') throw quota
      return put.apply(this, args)
    })
    now = 1000
    await expect(db.rememberDocument({ id: 'big', name: 'big.pdf', size: 3, pageCount: 2 }, bytesOf(1, 2, 3))).rejects.toBe(quota)
    full.mockRestore()
    expect(await db.loadDocumentBytes('big')).toBeNull()
    expect(await db.listRecentDocuments()).toEqual([
      { id: 'big', name: 'big.pdf', size: 3, pageCount: 2, addedAt: 1000, openedAt: 1000, fileMissing: true },
    ])
    // Opened again with room for it: stored, and no longer marked.
    await remember('big', 2000)
    expect(await db.loadDocumentBytes('big')).toEqual(bytesOf(1, 2, 3))
    expect((await db.getRecentDocument('big'))?.fileMissing).toBeUndefined()
  })

  it('lists a document whose file there is no room for even where the write after that one fails too', async () => {
    const quota = new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    const put = IDBObjectStore.prototype.put
    let refused = false
    const full = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'files') {
        refused = true
        throw quota
      }
      // As in Chrome, which still counts the refused file for a moment: the next write to the
      // recents list fails too, small as it is.
      if (this.name === 'recents' && refused) {
        refused = false
        throw quota
      }
      return put.apply(this, args)
    })
    now = 1000
    await expect(db.rememberDocument({ id: 'big', name: 'big.pdf', size: 3, pageCount: 2 }, bytesOf(1, 2, 3))).rejects.toBe(quota)
    full.mockRestore()
    expect(await db.getRecentDocument('big')).toEqual({ id: 'big', name: 'big.pdf', size: 3, pageCount: 2, addedAt: 1000, openedAt: 1000, fileMissing: true })
    expect(await db.loadDocumentBytes('big')).toBeNull()
  })

  it('stores no file that it can’t list', async () => {
    const quota = new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    const put = IDBObjectStore.prototype.put
    const full = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'recents') throw quota
      return put.apply(this, args)
    })
    await expect(remember('a', 1000)).rejects.toBe(quota)
    full.mockRestore()
    expect(await db.listRecentDocuments()).toEqual([])
    // Nothing would ever take it off the device again.
    expect(await db.loadDocumentBytes('a')).toBeNull()
  })

  it('tells whether work is saved for a document', async () => {
    expect(await db.hasSession('a')).toBe(false)
    await db.saveSession(session('a'))
    expect(await db.hasSession('a')).toBe(true)
  })

  it('tells the other tabs which documents’ work it deletes', async () => {
    const otherTab = new BroadcastChannel(db.SESSIONS_CHANNEL)
    const heard: unknown[] = []
    otherTab.onmessage = (e) => heard.push(e.data)
    try {
      await remember('a', 1000)
      await db.saveSession(session('a'))
      await db.forgetDocument('a')
      await db.saveSession(session('unlisted'))
      await db.forgetUnlistedSessions()
      await db.saveSession(session('stale', { updatedAt: 1 }))
      now = 1_800_000_000_000
      await db.forgetStaleSessions()
      await vi.waitFor(() =>
        expect(heard).toEqual([
          { docId: 'a', removed: true },
          { docId: 'unlisted', removed: true },
          { docId: 'stale', removed: true },
        ]),
      )
    } finally {
      otherTab.close()
    }
  })
})

describe('sessions', () => {
  it('round-trips a session', async () => {
    const s = session('a')
    await db.saveSession(s)
    expect(await db.loadSession('a')).toEqual(s)
    expect(await db.loadSession('b')).toBeNull()
  })

  it('overwrites the previous session and deletes it', async () => {
    await db.saveSession(session('a'))
    await db.saveSession(session('a', { elements: [], formValues: {}, updatedAt: 20 }))
    expect(await db.loadSession('a')).toMatchObject({ elements: [], formValues: {}, updatedAt: 20 })
    await db.deleteSession('a')
    expect(await db.loadSession('a')).toBeNull()
  })

  it('rejects sessions of another version or another document', async () => {
    const { createStore, set } = await import('idb-keyval')
    const store = createStore('fillflow-sessions', 'sessions')
    await set('v2', { ...session('v2'), version: 2 }, store)
    await set('moved', session('elsewhere'), store)
    expect(await db.loadSession('v2')).toBeNull()
    expect(await db.loadSession('moved')).toBeNull()
  })

  it('commits each write right away, so one started on pagehide survives the unload', async () => {
    const commit = vi.spyOn(IDBTransaction.prototype, 'commit')
    await db.saveSession(session('a'))
    expect(commit).toHaveBeenCalledTimes(1)
    await db.saveSession(session('a', { updatedAt: 20 }), { updatedAt: 10 })
    expect(commit).toHaveBeenCalledTimes(2)
  })

  it('remembers which version each load found', async () => {
    expect(db.loadedSessionVersion('a')).toBeNull()
    await db.loadSession('a')
    expect(db.loadedSessionVersion('a')).toBe(0)
    await db.saveSession(session('a', { updatedAt: 42 }))
    await db.loadSession('a')
    expect(db.loadedSessionVersion('a')).toBe(42)
  })

  it('compare-and-swap: replaces only the version this tab knows, and advances it', async () => {
    const version = { updatedAt: 0 as number | null }
    // Nothing stored yet.
    await db.saveSession(session('a', { updatedAt: 10 }), version)
    expect(version.updatedAt).toBe(10)
    await db.saveSession(session('a', { updatedAt: 11, formValues: { Name: 'Mine' } }), version)
    expect(version.updatedAt).toBe(11)

    // Another tab saves newer work…
    const otherTab = { updatedAt: 11 }
    await db.saveSession(session('a', { updatedAt: 12, formValues: { Name: 'Theirs' } }), otherTab)
    // …so this tab's next write is refused instead of overwriting it.
    await expect(db.saveSession(session('a', { updatedAt: 13, formValues: { Name: 'Stale' } }), version)).rejects.toBeInstanceOf(
      db.SessionConflictError,
    )
    expect(version.updatedAt).toBe(11)
    expect((await db.loadSession('a'))?.formValues).toEqual({ Name: 'Theirs' })

    // A blind (last-chance) write doesn't check.
    await db.saveSession(session('a', { updatedAt: 14, formValues: { Name: 'Blind' } }), version, { blind: true })
    expect(version.updatedAt).toBe(14)
    expect((await db.loadSession('a'))?.formValues).toEqual({ Name: 'Blind' })
  })

  it('compare-and-swap: overlapping writes from one tab expect each other', async () => {
    const version = { updatedAt: 0 as number | null }
    await Promise.all([
      db.saveSession(session('a', { updatedAt: 1 }), version),
      db.saveSession(session('a', { updatedAt: 2 }), version),
      db.saveSession(session('a', { updatedAt: 3 }), version),
    ])
    expect(version.updatedAt).toBe(3)
    expect((await db.loadSession('a'))?.updatedAt).toBe(3)
  })

  it('compare-and-swap: an unknown version only writes where nothing is stored', async () => {
    await db.saveSession(session('a', { updatedAt: 7 }))
    await expect(db.saveSession(session('a', { updatedAt: 8 }), { updatedAt: null })).rejects.toBeInstanceOf(db.SessionConflictError)
    const fresh = { updatedAt: null as number | null }
    await db.saveSession(session('b', { updatedAt: 9 }), fresh)
    expect(fresh.updatedAt).toBe(9)
  })

  it('compare-and-swap: work deleted since this tab saved or loaded it isn’t written back', async () => {
    const version = { updatedAt: 5 }
    await expect(db.saveSession(session('a', { updatedAt: 6 }), version)).rejects.toBeInstanceOf(db.SessionRemovedError)
    expect(version.updatedAt).toBe(5)
    expect(await db.loadSession('a')).toBeNull()
    // Where this tab expects nothing (or can't tell), nothing stored is fine.
    await db.saveSession(session('a', { updatedAt: 7 }), { updatedAt: 0 })
    await db.saveSession(session('b', { updatedAt: 8 }), { updatedAt: null })
    expect((await db.loadSession('a'))?.updatedAt).toBe(7)
    expect((await db.loadSession('b'))?.updatedAt).toBe(8)
  })

  it('compare-and-swap: replaces a record it can’t read back, in a transaction of its own', async () => {
    await db.saveSession(session('a', { updatedAt: 5, formValues: { Name: 'Lost' } }))
    const get = IDBObjectStore.prototype.get
    const put = IDBObjectStore.prototype.put
    let doomed: IDBTransaction | null = null
    vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key: IDBValidKey | IDBKeyRange) {
      if (this.transaction.mode !== 'readwrite') return get.call(this, key)
      // Its data is gone (a missing blob file): the read fails, and, as in Chrome, so does
      // anything else its transaction then writes.
      doomed = this.transaction
      const failing = {} as IDBRequest
      queueMicrotask(() => failing.onerror?.call(failing, new Event('error', { cancelable: true })))
      return failing
    })
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.transaction === doomed) throw new DOMException('Data lost due to missing file.', 'UnknownError')
      return put.call(this, value, key)
    })
    const version = { updatedAt: null as number | null }
    await db.saveSession(session('a', { updatedAt: 9, formValues: { Name: 'New' } }), version)
    vi.restoreAllMocks()
    expect(version.updatedAt).toBe(9)
    expect((await db.loadSession('a'))?.formValues).toEqual({ Name: 'New' })
  })
})

describe('when storage can’t be used at all', () => {
  it('tells that apart from one record failing', async () => {
    // Blocked for this site: opening the database fails.
    vi.spyOn(IDBFactory.prototype, 'open').mockImplementation(() => {
      const req = { error: new DOMException('The user denied permission to access the database.', 'UnknownError') } as unknown as IDBOpenDBRequest
      queueMicrotask(() => req.onerror?.call(req, new Event('error')))
      return req
    })
    await expect(db.loadSession('a')).rejects.toBeInstanceOf(db.StorageUnavailableError)
    await expect(db.rememberDocument({ id: 'a', name: 'a.pdf', size: 3, pageCount: 1 }, bytesOf(1))).rejects.toBeInstanceOf(
      db.StorageUnavailableError,
    )
    await expect(db.saveSession(session('a'))).rejects.toBeInstanceOf(db.StorageUnavailableError)
    vi.restoreAllMocks()

    // Storage works, but one record can't be read: not the same thing.
    vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementationOnce(() => {
      throw new DOMException('Data lost due to missing file.', 'NotReadableError')
    })
    const failure = await db.loadSession('a').catch((err: unknown) => err)
    expect(failure).toMatchObject({ name: 'NotReadableError' })
    expect(failure).not.toBeInstanceOf(db.StorageUnavailableError)
  })

  it('says so where the browser has no IndexedDB', async () => {
    globalThis.indexedDB = undefined as unknown as IDBFactory
    await expect(db.loadSession('a')).rejects.toBeInstanceOf(db.StorageUnavailableError)
    await expect(db.listRecentDocuments()).rejects.toBeInstanceOf(db.StorageUnavailableError)
  })
})

describe('signatures', () => {
  const sig = (id: string, createdAt: number, role: 'signature' | 'initials' = 'signature') => ({
    id,
    role,
    createdAt,
    asset: { id: `asset-${id}`, mime: 'image/png' as const, dataUrl: 'data:image/png;base64,AA', width: 120, height: 40 },
  })

  it('lists newest first and deletes', async () => {
    await db.saveSignature(sig('old', 1))
    await db.saveSignature(sig('new', 3, 'initials'))
    await db.saveSignature(sig('mid', 2))
    expect((await db.listSavedSignatures()).map((s) => s.id)).toEqual(['new', 'mid', 'old'])
    await db.deleteSignature('mid')
    expect((await db.listSavedSignatures()).map((s) => s.id)).toEqual(['new', 'old'])
  })
})

describe('clearAllData', () => {
  it('wipes every store', async () => {
    await remember('a', 1000)
    await db.saveSession(session('a'))
    await db.saveSignature({ id: 's', role: 'signature', createdAt: 1, asset: { id: 'x', mime: 'image/png', dataUrl: 'data:,', width: 1, height: 1 } })
    await db.clearAllData()
    expect(await db.listRecentDocuments()).toEqual([])
    expect(await db.loadDocumentBytes('a')).toBeNull()
    expect(await db.loadSession('a')).toBeNull()
    expect(await db.listSavedSignatures()).toEqual([])
  })
})
