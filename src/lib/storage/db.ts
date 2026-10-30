import { clear, createStore, del, entries, get, promisifyRequest, set, type UseStore } from 'idb-keyval'
import type { Asset, DocumentSession } from '../../model/types'
import { importLegacySignature } from './legacy'
import { parseSession } from './session'

/**
 * Local persistence (IndexedDB). Nothing ever leaves the device.
 *
 *  - files:      original PDF bytes, keyed by document id (SHA-256 of the bytes)
 *  - recents:    lightweight metadata for the "Recent documents" list
 *  - sessions:   the user's work on a document (elements, form values, assets)
 *  - signatures: saved signatures & initials
 *
 * Read-modify-write updates of a record run inside a single transaction, so concurrent writers
 * (opening a file, autosave, thumbnail generation) never lose each other's fields.
 *
 * This module must not import the editor store (the store imports it).
 */

export interface RecentDocument {
  id: string
  name: string
  size: number
  pageCount: number
  addedAt: number
  openedAt: number
  /** Small JPEG data URL of page 1, if generated. */
  thumbnail?: string
  /** Number of placed elements + filled form fields at last save (for "progress" badges). */
  filledCount?: number
}

export interface SavedSignature {
  id: string
  role: 'signature' | 'initials'
  asset: Asset
  createdAt: number
}

let stores: { files: UseStore; recents: UseStore; sessions: UseStore; signatures: UseStore } | null = null

function db() {
  if (!stores) {
    stores = {
      files: createStore('fillflow-files', 'files'),
      recents: createStore('fillflow-recents', 'recents'),
      sessions: createStore('fillflow-sessions', 'sessions'),
      signatures: createStore('fillflow-signatures', 'signatures'),
    }
  }
  return stores
}

export const MAX_RECENT_DOCUMENTS = 12

/**
 * Atomic read-modify-write of one record. `fn` receives the current value; returning
 * `undefined` leaves the record untouched. Resolves with what was written, once committed.
 */
function modify<T>(store: UseStore, key: IDBValidKey, fn: (current: T | undefined) => T | undefined): Promise<T | undefined> {
  return store('readwrite', (os) => {
    return new Promise<T | undefined>((resolve, reject) => {
      const req = os.get(key)
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        let next: T | undefined
        try {
          next = fn(req.result as T | undefined)
          if (next !== undefined) os.put(next, key)
        } catch (err) {
          reject(err)
          return
        }
        promisifyRequest(os.transaction).then(() => resolve(next), reject)
      }
    })
  })
}

/** Whether a key exists, without reading its (possibly large) value. */
function has(store: UseStore, key: IDBValidKey): Promise<boolean> {
  return store('readonly', (os) => promisifyRequest(os.count(key))).then((n) => n > 0)
}

/** Structured clone copies a typed array's *whole* buffer, so store a tight copy of views. */
function ownBytes(bytes: Uint8Array): Uint8Array {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice()
}

function isRecent(v: unknown): v is RecentDocument {
  return typeof v === 'object' && v !== null && typeof (v as RecentDocument).id === 'string'
}

function withoutUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}

// --- Documents --------------------------------------------------------------

/** Stores the original file and upserts its recent-documents entry. */
export async function rememberDocument(
  meta: Omit<RecentDocument, 'addedAt' | 'openedAt'> & Partial<Pick<RecentDocument, 'addedAt'>>,
  bytes: Uint8Array,
): Promise<void> {
  const { files, recents } = db()
  // The id is the SHA-256 of the bytes: an existing file under this key is the same file.
  if (!(await has(files, meta.id))) await set(meta.id, ownBytes(bytes), files)
  const now = Date.now()
  await modify<RecentDocument>(recents, meta.id, (existing) => ({
    ...existing,
    ...(withoutUndefined(meta) as typeof meta),
    addedAt: existing?.addedAt ?? meta.addedAt ?? now,
    openedAt: now,
  }))
  await pruneRecentDocuments()
}

/** Patches an existing recent-documents entry (never creates one). */
export async function updateRecentDocument(id: string, patch: Partial<RecentDocument>): Promise<void> {
  await patchRecentDocument(id, patch)
}

/** Like `updateRecentDocument`, but resolves with whether the entry existed (and was updated). */
export async function patchRecentDocument(id: string, patch: Partial<RecentDocument>): Promise<boolean> {
  const written = await modify<RecentDocument>(db().recents, id, (existing) =>
    isRecent(existing) ? { ...existing, ...patch, id } : undefined,
  )
  return written !== undefined
}

export async function getRecentDocument(id: string): Promise<RecentDocument | null> {
  const v = await get<unknown>(id, db().recents)
  return isRecent(v) ? v : null
}

/** Most recently opened first. */
export async function listRecentDocuments(): Promise<RecentDocument[]> {
  const all = await entries<string, unknown>(db().recents)
  return all
    .map(([, v]) => v)
    .filter(isRecent)
    .sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0) || (b.addedAt ?? 0) - (a.addedAt ?? 0))
}

export async function loadDocumentBytes(id: string): Promise<Uint8Array | null> {
  const bytes = await get<Uint8Array | ArrayBuffer>(id, db().files)
  if (!bytes) return null
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
}

/** Removes the file, its metadata and its saved session. */
export async function forgetDocument(id: string): Promise<void> {
  const { files, recents, sessions } = db()
  await Promise.all([del(id, files), del(id, recents), del(id, sessions)])
}

async function pruneRecentDocuments(): Promise<void> {
  const list = await listRecentDocuments()
  await Promise.all(list.slice(MAX_RECENT_DOCUMENTS).map((d) => forgetDocument(d.id)))
}

// --- Sessions ---------------------------------------------------------------

/** The saved work for a document, validated; null when there is none (or it is unusable). */
export async function loadSession(docId: string): Promise<DocumentSession | null> {
  const raw = await get<unknown>(docId, db().sessions)
  const session = parseSession(raw)
  return session && session.docId === docId ? session : null
}

export async function saveSession(session: DocumentSession): Promise<void> {
  await set(session.docId, session, db().sessions)
}

export async function deleteSession(docId: string): Promise<void> {
  await del(docId, db().sessions)
}

// --- Signatures -------------------------------------------------------------

let legacyImport: Promise<unknown> | null = null

/** Newest first. (The first call also brings over a signature saved by FillFlow v1.) */
export async function listSavedSignatures(): Promise<SavedSignature[]> {
  legacyImport ??= importLegacySignature(saveSignature)
  await legacyImport
  const all = await entries<string, SavedSignature>(db().signatures)
  return all
    .map(([, v]) => v)
    .filter((v) => typeof v === 'object' && v !== null && typeof v.asset?.dataUrl === 'string')
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function saveSignature(sig: SavedSignature): Promise<void> {
  await set(sig.id, sig, db().signatures)
}

export async function deleteSignature(id: string): Promise<void> {
  await del(id, db().signatures)
}

// --- Housekeeping -----------------------------------------------------------

/** Deletes everything FillFlow stored on this device (files, recents, sessions, signatures). */
export async function clearAllData(): Promise<void> {
  const { files, recents, sessions, signatures } = db()
  await Promise.all([clear(files), clear(recents), clear(sessions), clear(signatures)])
}

let persistRequested: Promise<boolean> | null = null

/**
 * Asks the browser not to evict our storage under pressure (best effort, once per page load).
 * Skipped where it would show a permission prompt (Firefox); Chromium and Safari decide silently.
 */
export function requestPersistentStorage(): Promise<boolean> {
  persistRequested ??= (async () => {
    try {
      const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined
      if (!storage?.persist || !storage.persisted) return false
      if (await storage.persisted()) return true
      if (/firefox/i.test(navigator.userAgent)) return false
      return await storage.persist()
    } catch {
      return false
    }
  })()
  return persistRequested
}
