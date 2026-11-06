import { clear, createStore, del, delMany, entries, get, keys, promisifyRequest, set, type UseStore } from 'idb-keyval'
import type { Asset, DocumentSession } from '../../model/types'
import { importLegacySignature } from './legacy'
import { parseSession, storedVersion } from './session'

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
  /** When work on it was last saved (unset until then). */
  editedAt?: number
  /** Small JPEG data URL of page 1, if generated. */
  thumbnail?: string
  /** Number of placed elements + filled form fields at last save (for "progress" badges). */
  filledCount?: number
  /**
   * Its file isn't stored on this device (there was no room for it, or it is gone): it is listed
   * for its work, which opening the same file again continues.
   */
  fileMissing?: boolean
}

export interface SavedSignature {
  id: string
  role: 'signature' | 'initials'
  asset: Asset
  createdAt: number
}

/**
 * Storage on this device can't be used at all (it is blocked for this site, or missing): nothing
 * can be stored or read, as opposed to one record or one write failing.
 */
export class StorageUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Storage is unavailable in this browser.', { cause })
    this.name = 'StorageUnavailableError'
  }
}

/** An idb-keyval store that rejects with StorageUnavailableError when its database can't be opened. */
function openStore(dbName: string, storeName: string): UseStore {
  const store = createStore(dbName, storeName)
  return (txMode, callback) => {
    let opened = false
    try {
      return store(txMode, (os) => {
        opened = true
        return callback(os)
      }).catch((err: unknown) => {
        throw opened ? err : new StorageUnavailableError(err)
      })
    } catch (err) {
      // No IndexedDB at all: opening it throws at once.
      return Promise.reject(new StorageUnavailableError(err))
    }
  }
}

let stores: { files: UseStore; recents: UseStore; sessions: UseStore; signatures: UseStore } | null = null

function db() {
  if (!stores) {
    stores = {
      files: openStore('fillflow-files', 'files'),
      recents: openStore('fillflow-recents', 'recents'),
      sessions: openStore('fillflow-sessions', 'sessions'),
      signatures: openStore('fillflow-signatures', 'signatures'),
    }
  }
  return stores
}

/** Tabs announce on this channel each session they save (see autosave) or delete. */
export const SESSIONS_CHANNEL = 'fillflow-sessions'

let channel: BroadcastChannel | null | undefined

/** This tab's end of SESSIONS_CHANNEL: one for the whole tab, which never hears its own messages. */
export function sessionsChannel(): BroadcastChannel | null {
  channel ??= typeof BroadcastChannel === 'function' ? new BroadcastChannel(SESSIONS_CHANNEL) : null
  return channel
}

/** Tells the other tabs that the work on these documents was deleted. */
function announceRemoved(ids: IDBValidKey[]): void {
  for (const docId of ids) sessionsChannel()?.postMessage({ docId, removed: true })
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

function withoutUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}

/**
 * A stored recents entry, validated (another build may have written it): null without an id
 * and a name; unusable numbers become 0 and unusable optional fields are left out.
 */
function parseRecent(v: unknown): RecentDocument | null {
  if (typeof v !== 'object' || v === null) return null
  const r = v as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return null
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined)
  return withoutUndefined({
    id: r.id,
    name: r.name,
    size: num(r.size) ?? 0,
    pageCount: num(r.pageCount) ?? 0,
    addedAt: num(r.addedAt) ?? 0,
    openedAt: num(r.openedAt) ?? 0,
    editedAt: num(r.editedAt),
    thumbnail: typeof r.thumbnail === 'string' ? r.thumbnail : undefined,
    filledCount: num(r.filledCount),
    fileMissing: r.fileMissing === true ? true : undefined,
  }) as RecentDocument
}

// --- Documents --------------------------------------------------------------

/**
 * Stores the original file and upserts its recent-documents entry. A file that can't be stored
 * (no room for it) is listed all the same, marked `fileMissing`, as its work is saved: then it
 * rejects with why the file wasn't stored.
 *
 * The entry is written first, marked until the file is stored: right after a write that there was
 * no room for, the browser may refuse the next one too, however small (Chrome still counts the
 * refused write for a moment).
 */
export async function rememberDocument(
  meta: Omit<RecentDocument, 'addedAt' | 'openedAt' | 'fileMissing'> & Partial<Pick<RecentDocument, 'addedAt'>>,
  bytes: Uint8Array,
): Promise<void> {
  const { files, recents } = db()
  // The id is the SHA-256 of the bytes: an existing file under this key is the same file. (When
  // that can't be told, the file is stored again.)
  const stored = await has(files, meta.id).catch(() => false)
  const now = Date.now()
  await modify<RecentDocument>(recents, meta.id, (existing) => {
    const current = parseRecent(existing)
    return withoutUndefined({
      ...current,
      ...(withoutUndefined(meta) as typeof meta),
      addedAt: current?.addedAt || meta.addedAt || now,
      openedAt: now,
      fileMissing: stored ? undefined : true,
    }) as RecentDocument
  })
  let notStored: { error: unknown } | null = null
  if (!stored) {
    try {
      await set(meta.id, ownBytes(bytes), files)
    } catch (error) {
      notStored = { error }
    }
    // Stored: no longer marked. (Should that write fail, the next open of the file clears the mark.)
    if (!notStored) {
      await modify<RecentDocument>(recents, meta.id, (existing) => {
        const current = parseRecent(existing)
        return current?.fileMissing ? (withoutUndefined({ ...current, fileMissing: undefined }) as RecentDocument) : undefined
      }).catch((err: unknown) => console.warn('[storage] could not update a recent document', err))
    }
  }
  await pruneRecentDocuments()
  if (notStored) throw notStored.error
}

/** Patches an existing recent-documents entry (never creates one). */
export async function updateRecentDocument(id: string, patch: Partial<RecentDocument>): Promise<void> {
  await patchRecentDocument(id, patch)
}

/** Like `updateRecentDocument`, but resolves with whether the entry existed (and was updated). */
export async function patchRecentDocument(id: string, patch: Partial<RecentDocument>): Promise<boolean> {
  const written = await modify<RecentDocument>(db().recents, id, (existing) => {
    const current = parseRecent(existing)
    return current ? { ...current, ...patch, id } : undefined
  })
  return written !== undefined
}

export async function getRecentDocument(id: string): Promise<RecentDocument | null> {
  return parseRecent(await get<unknown>(id, db().recents))
}

/** Most recently opened first. */
export async function listRecentDocuments(): Promise<RecentDocument[]> {
  const all = await entries<string, unknown>(db().recents)
  return all
    .map(([, v]) => parseRecent(v))
    .filter((d) => d !== null)
    .sort((a, b) => b.openedAt - a.openedAt || b.addedAt - a.addedAt)
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
  announceRemoved([id])
}

/**
 * Takes a document off the recents list and drops its stored file, but keeps its saved work:
 * opening the same file again (from disk) brings the work back.
 */
export async function removeRecentDocument(id: string): Promise<void> {
  const { files, recents } = db()
  await Promise.all([del(id, files), del(id, recents)])
}

/** Keeps the list, and the stored files that make up most of the data, short. Work is kept. */
async function pruneRecentDocuments(): Promise<void> {
  const list = await listRecentDocuments()
  await Promise.all(list.slice(MAX_RECENT_DOCUMENTS).map((d) => removeRecentDocument(d.id)))
}

/** Work on a document that is no longer in the recents list is kept this long after its last save. */
export const UNLISTED_SESSION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000

/** Keys of the saved work on documents that are no longer in the recents list. */
async function unlistedSessionKeys(): Promise<IDBValidKey[]> {
  const { recents, sessions } = db()
  const [listed, saved] = await Promise.all([keys(recents), keys(sessions)])
  const keep = new Set(listed)
  return saved.filter((key) => !keep.has(key))
}

/** Whether work is still saved for documents that are no longer in the recents list. */
export async function hasUnlistedSessions(): Promise<boolean> {
  return (await unlistedSessionKeys()).length > 0
}

/** Deletes the saved work on documents that are no longer in the recents list. */
export async function forgetUnlistedSessions(): Promise<void> {
  const unlisted = await unlistedSessionKeys()
  if (!unlisted.length) return
  await delMany(unlisted, db().sessions)
  announceRemoved(unlisted)
}

/**
 * Deletes the saved work on documents that are no longer in the recents list and haven't been
 * worked on for `UNLISTED_SESSION_MAX_AGE_MS`. Until then, opening the same file again brings
 * it back. Listed documents' work is never read or touched.
 */
export async function forgetStaleSessions(): Promise<void> {
  const unlisted = await unlistedSessionKeys()
  if (!unlisted.length) return
  const cutoff = Date.now() - UNLISTED_SESSION_MAX_AGE_MS
  const deleted: IDBValidKey[] = []
  await db().sessions('readwrite', (os) => {
    for (const key of unlisted) {
      const read = os.get(key)
      read.onsuccess = () => {
        if (read.result === undefined || storedVersion(read.result) >= cutoff) return
        os.delete(key)
        deleted.push(key)
      }
      // Unreadable right now: leave it for another time.
      read.onerror = (e) => e.preventDefault()
    }
    return promisifyRequest(os.transaction)
  })
  announceRemoved(deleted)
}

// --- Sessions ---------------------------------------------------------------

/**
 * What a tab knows about a document's stored session, for compare-and-swap writes: the
 * `updatedAt` it last loaded or wrote (0 = nothing was stored), or null when it couldn't tell.
 */
export interface SessionVersion {
  updatedAt: number | null
}

/** `saveSession` found a different session stored than expected: another tab saved newer work. */
export class SessionConflictError extends Error {
  constructor() {
    super('The document was changed in another tab.')
    this.name = 'SessionConflictError'
  }
}

/**
 * `saveSession` found no session stored where this tab had saved or loaded one: it was deleted
 * since (the document was removed from this device, in another tab), and isn't brought back unasked.
 */
export class SessionRemovedError extends Error {
  constructor() {
    super('The document was removed from this device.')
    this.name = 'SessionRemovedError'
  }
}

/** The stored session couldn't be read back while checking it (see `saveSession`). */
class UnreadableSessionError extends Error {}

/** Whether work is saved for a document (without reading it). */
export function hasSession(docId: string): Promise<boolean> {
  return has(db().sessions, docId)
}

/** What the last `loadSession` of each document found (see `loadedSessionVersion`). */
const loadedVersions = new Map<string, number>()

/** The saved work for a document, validated; null when there is none (or it is unusable). */
export async function loadSession(docId: string): Promise<DocumentSession | null> {
  loadedVersions.delete(docId)
  const raw = await get<unknown>(docId, db().sessions)
  loadedVersions.set(docId, storedVersion(raw))
  const session = parseSession(raw)
  return session && session.docId === docId ? session : null
}

/**
 * The version of a document's stored session as the last `loadSession` read it (0 = none), or
 * null when that read failed or never happened. Autosave's writes start from it, so they never
 * replace work that another tab saved after this one loaded the document.
 */
export function loadedSessionVersion(docId: string): number | null {
  return loadedVersions.get(docId) ?? null
}

/**
 * Stores the user's work on a document; resolves once it is committed. The commit is requested
 * along with the write, so a write started as the page is being unloaded still lands.
 *
 * With `version`, it's a compare-and-swap: the stored session is only replaced while it is the
 * one `version` names (or when there is none and `version` expects none, or it is unreadable);
 * otherwise nothing is written and it rejects with SessionConflictError, or SessionRemovedError
 * when the session `version` names is gone. `version` advances when the write commits. A `blind`
 * write skips the check, whose read would hold the write back past a page unload: for the last
 * write before the page goes away.
 */
export function saveSession(session: DocumentSession, version?: SessionVersion, { blind = false } = {}): Promise<void> {
  const saving = db().sessions('readwrite', (os) => {
    const tx = os.transaction
    let failure: unknown = null
    const committed = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => {
        if (version) version.updatedAt = session.updatedAt
        resolve()
      }
      tx.onabort = () => reject(failure ?? tx.error)
    })
    const write = () => {
      try {
        os.put(session, session.docId)
        tx.commit?.()
      } catch (err) {
        failure = err
        tx.abort()
      }
    }
    if (!version || blind) {
      write()
      return committed
    }
    const read = os.get(session.docId)
    read.onsuccess = () => {
      const stored: unknown = read.result
      // Nothing stored is fine, unless this tab saved or loaded a session (`updatedAt` > 0).
      if (stored === undefined ? !version.updatedAt : storedVersion(stored) === version.updatedAt) return write()
      failure = stored === undefined ? new SessionRemovedError() : new SessionConflictError()
      tx.abort()
    }
    read.onerror = (e) => {
      e.preventDefault()
      failure = new UnreadableSessionError()
      tx.abort()
    }
    return committed
  })
  // A record that can't be read back (its data is lost) is no work worth keeping: replace it. Not
  // in the transaction whose read failed, which then never commits in some browsers (Chrome).
  return saving.catch((err: unknown) => {
    if (!(err instanceof UnreadableSessionError)) throw err
    return saveSession(session, version, { blind: true })
  })
}

export async function deleteSession(docId: string): Promise<void> {
  await del(docId, db().sessions)
  announceRemoved([docId])
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
