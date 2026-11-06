import { useEffect } from 'react'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { deleteSignature, listSavedSignatures, saveSignature, type SavedSignature } from '../../lib/storage/db'
import { createId } from '../../lib/utils/id'
import type { Asset } from '../../model/types'

export type SignatureRole = SavedSignature['role']

export interface SignatureLibrary {
  /** Newest first. */
  items: SavedSignature[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Loads the saved items once (later calls reuse the result). */
  load(): Promise<void>
  /**
   * Saves an asset for next time (optimistic). Saving an identical image again just moves it to
   * the front. Rejects (after rolling back) when storage fails.
   */
  add(role: SignatureRole, asset: Asset): Promise<SavedSignature>
  /** Deletes an item (optimistic). Rejects (after restoring it) when storage fails. */
  remove(id: string): Promise<void>
}

const newestFirst = (a: SavedSignature, b: SavedSignature) => b.createdAt - a.createdAt

let inflight: Promise<void> | null = null
/** Ids removed while the initial load was in flight (so the load doesn't resurrect them). */
const removedWhileLoading = new Set<string>()

export const useSignatureLibrary = create<SignatureLibrary>()((set, get) => ({
  items: [],
  status: 'idle',

  load() {
    if (get().status === 'ready') return Promise.resolve()
    if (inflight) return inflight
    set({ status: 'loading' })
    inflight = listSavedSignatures()
      .then((stored) => {
        const current = get().items
        const known = new Set(current.map((i) => i.id))
        const merged = [...current, ...stored.filter((s) => !known.has(s.id) && !removedWhileLoading.has(s.id))]
        set({ items: merged.sort(newestFirst), status: 'ready' })
      })
      .catch((err) => {
        console.warn('[signatures] could not load saved signatures', err)
        set({ status: 'error' })
      })
      .finally(() => {
        inflight = null
        removedWhileLoading.clear()
      })
    return inflight
  },

  async add(role, asset) {
    const before = get().items
    const existing = before.find((i) => i.role === role && i.asset.dataUrl === asset.dataUrl)
    const item: SavedSignature = existing
      ? { ...existing, createdAt: Date.now() }
      : { id: createId(), role, asset: { ...asset }, createdAt: Date.now() }
    set({ items: [item, ...before.filter((i) => i.id !== item.id)] })
    try {
      await saveSignature(item)
      return item
    } catch (err) {
      set((s) => ({
        items: existing
          ? s.items.map((i) => (i.id === item.id ? existing : i)).sort(newestFirst)
          : s.items.filter((i) => i.id !== item.id),
      }))
      throw err
    }
  },

  async remove(id) {
    const item = get().items.find((i) => i.id === id)
    if (!item) return
    if (inflight) removedWhileLoading.add(id)
    set((s) => ({ items: s.items.filter((i) => i.id !== id) }))
    try {
      await deleteSignature(id)
    } catch (err) {
      set((s) => (s.items.some((i) => i.id === id) ? s : { items: [...s.items, item].sort(newestFirst) }))
      throw err
    }
  },
}))

/** Saved items for one role (newest first); triggers the lazy load. */
export function useSavedSignatures(role: SignatureRole): SavedSignature[] {
  useEffect(() => {
    void useSignatureLibrary.getState().load()
  }, [])
  return useSignatureLibrary(useShallow((s) => s.items.filter((i) => i.role === role)))
}

export function savedFor(role: SignatureRole): SavedSignature[] {
  return useSignatureLibrary.getState().items.filter((i) => i.role === role)
}
