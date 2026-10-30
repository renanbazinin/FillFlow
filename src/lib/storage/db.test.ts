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

  it(`keeps at most MAX_RECENT_DOCUMENTS, forgetting the oldest with their files and sessions`, async () => {
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
    expect(await db.loadSession('d0')).toBeNull()
    expect(await db.loadSession('d1')).toBeNull()
    expect(await db.loadDocumentBytes('d2')).not.toBeNull()
    expect(await db.loadSession('d2')).not.toBeNull()
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
