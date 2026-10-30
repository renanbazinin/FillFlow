import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedSignature } from '../../lib/storage/db'
import type { Asset } from '../../model/types'

const db = vi.hoisted(() => ({
  stored: [] as SavedSignature[],
  failSave: false,
  failDelete: false,
  failList: false,
  listGate: null as Promise<void> | null,
}))

vi.mock('../../lib/storage/db', () => ({
  listSavedSignatures: vi.fn(async () => {
    if (db.listGate) await db.listGate
    if (db.failList) throw new Error('no idb')
    return [...db.stored].sort((a, b) => b.createdAt - a.createdAt)
  }),
  saveSignature: vi.fn(async (sig: SavedSignature) => {
    if (db.failSave) throw new Error('quota')
    db.stored = [...db.stored.filter((s) => s.id !== sig.id), sig]
  }),
  deleteSignature: vi.fn(async (id: string) => {
    if (db.failDelete) throw new Error('locked')
    db.stored = db.stored.filter((s) => s.id !== id)
  }),
}))

const { useSignatureLibrary, savedFor } = await import('./library')

function asset(id: string, dataUrl = `data:image/png;base64,${id}`): Asset {
  return { id, mime: 'image/png', dataUrl, width: 600, height: 200 }
}

function saved(id: string, role: SavedSignature['role'], createdAt: number): SavedSignature {
  return { id, role, asset: asset(`a-${id}`), createdAt }
}

beforeEach(() => {
  db.stored = []
  db.failSave = false
  db.failDelete = false
  db.failList = false
  db.listGate = null
  useSignatureLibrary.setState({ items: [], status: 'idle' })
})

describe('useSignatureLibrary', () => {
  it('loads lazily, newest first, only once', async () => {
    db.stored = [saved('old', 'signature', 1), saved('new', 'signature', 3), saved('ini', 'initials', 2)]
    const { load } = useSignatureLibrary.getState()
    await Promise.all([load(), load()])
    expect(useSignatureLibrary.getState().status).toBe('ready')
    expect(useSignatureLibrary.getState().items.map((i) => i.id)).toEqual(['new', 'ini', 'old'])
    expect(savedFor('signature').map((i) => i.id)).toEqual(['new', 'old'])
    expect(savedFor('initials').map((i) => i.id)).toEqual(['ini'])
    db.stored = []
    await load()
    expect(useSignatureLibrary.getState().items).toHaveLength(3)
  })

  it('adds optimistically and persists', async () => {
    await useSignatureLibrary.getState().load()
    const pending = useSignatureLibrary.getState().add('signature', asset('x'))
    // Visible before the write resolves.
    expect(useSignatureLibrary.getState().items[0].asset.id).toBe('x')
    const item = await pending
    expect(item.role).toBe('signature')
    expect(db.stored.map((s) => s.id)).toEqual([item.id])
  })

  it('does not duplicate an identical image; it moves it to the front', async () => {
    const lib = useSignatureLibrary.getState()
    await lib.load()
    const first = await lib.add('signature', asset('one', 'data:same'))
    await lib.add('signature', asset('two', 'data:other'))
    const again = await lib.add('signature', asset('three', 'data:same'))
    expect(again.id).toBe(first.id)
    expect(useSignatureLibrary.getState().items.map((i) => i.id)).toEqual([first.id, expect.any(String)])
    expect(db.stored).toHaveLength(2)
    // The same picture saved as initials is a separate entry.
    await lib.add('initials', asset('four', 'data:same'))
    expect(useSignatureLibrary.getState().items).toHaveLength(3)
  })

  it('rolls back a failed add', async () => {
    await useSignatureLibrary.getState().load()
    db.failSave = true
    await expect(useSignatureLibrary.getState().add('initials', asset('x'))).rejects.toThrow('quota')
    expect(useSignatureLibrary.getState().items).toEqual([])
  })

  it('removes optimistically and restores on failure', async () => {
    db.stored = [saved('a', 'signature', 1), saved('b', 'signature', 2)]
    await useSignatureLibrary.getState().load()
    await useSignatureLibrary.getState().remove('a')
    expect(useSignatureLibrary.getState().items.map((i) => i.id)).toEqual(['b'])
    expect(db.stored.map((s) => s.id)).toEqual(['b'])

    db.failDelete = true
    const pending = useSignatureLibrary.getState().remove('b')
    expect(useSignatureLibrary.getState().items).toEqual([])
    await expect(pending).rejects.toThrow('locked')
    expect(useSignatureLibrary.getState().items.map((i) => i.id)).toEqual(['b'])
  })

  it('keeps items added or removed while the first load is in flight', async () => {
    db.stored = [saved('keep', 'signature', 1), saved('gone', 'signature', 2)]
    let release!: () => void
    db.listGate = new Promise<void>((r) => (release = r))
    const lib = useSignatureLibrary.getState()
    const loading = lib.load()
    // Optimistic state is visible immediately; `remove` needs the item in memory, so seed it.
    useSignatureLibrary.setState((s) => ({ items: [...s.items, saved('gone', 'signature', 2)] }))
    await lib.remove('gone')
    const added = await lib.add('signature', asset('fresh'))
    release()
    await loading
    const ids = useSignatureLibrary.getState().items.map((i) => i.id)
    expect(ids).toContain('keep')
    expect(ids).toContain(added.id)
    expect(ids).not.toContain('gone')
  })

  it('reports an error status when storage is unavailable', async () => {
    db.failList = true
    await useSignatureLibrary.getState().load()
    expect(useSignatureLibrary.getState().status).toBe('error')
    expect(useSignatureLibrary.getState().items).toEqual([])
  })
})
