import { useEffect } from 'react'
import { toast } from 'sonner'
import { shallow } from 'zustand/shallow'
import { filledCount, useEditor, type EditorState, type LoadedDocument } from '../../store/editor'
import { bidiIsolate } from '../utils/misc'
import { createAutosaver, type Autosaver } from './autosaver'
import {
  SessionConflictError,
  getRecentDocument,
  loadedSessionVersion,
  requestPersistentStorage,
  saveSession,
  type SessionVersion,
} from './db'
import { neededPassword } from './protectedDocs'
import { patchRecentSoon } from './recentPatches'
import { IDLE_STATUS, describeStorageError, setSaveStatus, useSaveStatusStore, type SaveStatus } from './saveStatus'
import { buildSession } from './session'
import { renderThumbnail, whenIdle } from './thumbnail'

export type { SaveStatus } from './saveStatus'

/** Quiet time after the last change before it is written. */
export const AUTOSAVE_DELAY_MS = 600
/** A long burst of changes (typing a paragraph) is still written at least this often. */
export const AUTOSAVE_MAX_WAIT_MS = 3000
const ERROR_TOAST_ID = 'autosave-error'
const OUTDATED_TOAST_ID = 'autosave-outdated'
/** Tabs announce each session they save on this channel (see `startAutosave`). */
export const SESSIONS_CHANNEL = 'fillflow-sessions'

const CHANGED_ELSEWHERE = 'This document was changed in another tab'
const NOT_LOADED = 'Your saved work on this document didn’t load'

/** Autosave state of one opened document. */
interface Target {
  doc: LoadedDocument
  /**
   * The stored session this tab's copy is based on; each committed write advances it. A copy of
   * the same file opened again in its place may share it (see `baseVersion`).
   */
  version: SessionVersion
  /** Why this copy is out of date (newer work is stored), so it is no longer saved; else null. */
  outdated: string | null
  /** The user has been told that its latest changes aren't saved. */
  warned: boolean
}

interface Snapshot {
  /** The (immutable) store state right after the change. */
  state: EditorState
  /** The document it belongs to; results for one that was closed since never touch the status. */
  target: Target
}

type Content = Pick<EditorState, 'elements' | 'formValues'>

/** One error toast per failure streak, app-wide. */
let errorToastShown = false
let activeFlush: (() => Promise<void>) | null = null
const thumbnailRequested = new WeakSet<LoadedDocument>()
/** Newest session version this tab has written (versions only ever increase, see `persist`). */
let lastVersion = 0

let channel: BroadcastChannel | null | undefined
function sessionsChannel(): BroadcastChannel | null {
  channel ??= typeof BroadcastChannel === 'function' ? new BroadcastChannel(SESSIONS_CHANNEL) : null
  return channel
}

/**
 * Autosaves the open document's work to IndexedDB and keeps its recents entry fresh (progress
 * count, page-1 thumbnail). Mount once, in the editor screen.
 */
export function useAutosave(): void {
  useEffect(() => startAutosave(), [])
}

/** Save status of the open document; pass a selector to subscribe to a single field. */
export function useSaveStatus<T = SaveStatus>(selector: (s: SaveStatus) => T = identity as (s: SaveStatus) => T): T {
  return useSaveStatusStore(selector)
}

/**
 * Writes any pending change right away (e.g. before leaving the document) and resolves once the
 * latest write has settled: the save status then tells whether everything is stored.
 */
export function flushAutosave(): Promise<void> {
  return activeFlush?.() ?? Promise.resolve()
}

/**
 * Starts autosaving; returns a stop function that flushes pending work. Used by `useAutosave`.
 *
 * Several tabs may have the same document open. Writes are compare-and-swaps against the stored
 * version this tab's copy is based on, and every committed write is announced to the other
 * tabs, so a tab holding an out-of-date copy stops saving (it would wipe out the newer work) and
 * offers to reload the document instead.
 */
export function startAutosave(): () => void {
  let target: Target | null = null
  let saver: Autosaver<Snapshot> | null = null
  /** Content known to be stored (or in flight); null when unknown (after a failure). */
  let baseline: Content | null = null
  /** Set while flushing because the page is going away. */
  let leaving = false

  const createSaver = () =>
    createAutosaver<Snapshot>({
      delay: AUTOSAVE_DELAY_MS,
      maxWait: AUTOSAVE_MAX_WAIT_MS,
      save: (snap) => persist(snap, leaving),
      onStart(snap) {
        if (snap.target !== target) return
        baseline = { elements: snap.state.elements, formValues: snap.state.formValues }
        markSaving()
      },
      onSuccess(snap) {
        if (errorToastShown) {
          errorToastShown = false
          toast.dismiss(ERROR_TOAST_ID)
        }
        void requestPersistentStorage()
        if (snap.target !== target || target.outdated) return
        target.warned = false
        setSaveStatus({ state: 'saved', savedAt: Date.now() })
      },
      onError(snap, err) {
        if (err instanceof SessionConflictError) {
          return outdated(snap.target, snap.target.version.updatedAt === null ? NOT_LOADED : CHANGED_ELSEWHERE)
        }
        console.warn('[autosave] could not save', err)
        if (snap.target !== target) return reportLost(snap.target, describeStorageError(err))
        if (target.outdated) return
        if (!errorToastShown) {
          errorToastShown = true
          toast.error("Couldn't save your progress on this device", {
            id: ERROR_TOAST_ID,
            description: `${describeStorageError(err)} Download your PDF to keep your changes.`,
          })
        }
        baseline = null
        target.warned = true
        setSaveStatus({ state: 'error', savedAt: useSaveStatusStore.getState().savedAt, error: describeStorageError(err) })
      },
    })

  /** Writes the previous document's pending work now, then retires its saver. */
  const retire = (old: Autosaver<Snapshot> | null) => {
    if (old) void old.flush().finally(() => old.dispose())
  }

  /** Changes are waiting to be written. A failed save keeps the status at 'error' until one succeeds. */
  function markSaving() {
    const cur = useSaveStatusStore.getState()
    if (cur.state !== 'saving' && cur.state !== 'error') setSaveStatus({ state: 'saving', savedAt: cur.savedAt })
  }

  /** The open document has changes that won't be saved: its copy is out of date. */
  function markNotSaved(t: Target, reason: string) {
    t.warned = true
    setSaveStatus({ state: 'error', savedAt: useSaveStatusStore.getState().savedAt, error: `${reason}.` })
  }

  function showOutdated(t: Target, reason: string) {
    toast.error(reason, {
      id: OUTDATED_TOAST_ID,
      description: 'Reload it to get the latest saved version. Changes made here aren’t being saved.',
      duration: Infinity,
      action: { label: 'Reload', onClick: () => reload(t.doc) },
    })
  }

  /** Newer work on `t` is stored: stop saving this copy over it, and offer to reload. */
  function outdated(t: Target, reason: string) {
    if (t !== target) return reportLost(t, 'It was changed in another tab.')
    if (t.outdated) return
    t.outdated = reason
    const unsaved = saver !== null && (saver.queued || saver.busy)
    saver?.dispose()
    saver = null
    if (unsaved || useSaveStatusStore.getState().state === 'error') markNotSaved(t, reason)
    showOutdated(t, reason)
  }

  /** The last write of a document that is no longer open failed: say so, unless the user knows. */
  function reportLost(t: Target, description: string) {
    if (t.warned) return
    t.warned = true
    toast.error(`Your latest changes to “${bidiIsolate(t.doc.name)}” couldn’t be saved`, { description })
  }

  function switchTo(s: EditorState) {
    const replaced = target
    retire(saver)
    toast.dismiss(OUTDATED_TOAST_ID)
    target = s.doc ? { doc: s.doc, version: baseVersion(s.doc.id, replaced), outdated: null, warned: false } : null
    baseline = { elements: s.elements, formValues: s.formValues }
    saver = target ? createSaver() : null
    setSaveStatus(IDLE_STATUS)
    if (target) requestThumbnail(target.doc)
  }

  function onChange(s: EditorState) {
    if (s.doc !== (target?.doc ?? null)) return switchTo(s)
    if (!target || s.revision === 0) return
    if (target.outdated) {
      // Nothing is saved here any more: make sure the user knows before putting in more work.
      if (useSaveStatusStore.getState().state !== 'error') {
        markNotSaved(target, target.outdated)
        showOutdated(target, target.outdated)
      }
      return
    }
    if (!saver) return
    if (baseline && s.elements === baseline.elements && s.formValues === baseline.formValues) {
      // Back to what is already stored (an undo before the timer fired, an asset added
      // without being placed…): nothing to write.
      if (saver.queued) {
        saver.cancel()
        if (!saver.busy) {
          const { savedAt } = useSaveStatusStore.getState()
          setSaveStatus(savedAt ? { state: 'saved', savedAt } : IDLE_STATUS)
        }
      }
      return
    }
    saver.schedule({ state: s, target })
    markSaving()
  }

  /** Another tab committed a session: if it's for this document, the copy here is out of date. */
  const onAnnounce = (e: MessageEvent) => {
    const { docId, updatedAt } = (e.data ?? {}) as { docId?: unknown; updatedAt?: unknown }
    if (!target || target.outdated || docId !== target.doc.id || typeof updatedAt !== 'number') return
    const known = target.version.updatedAt
    if (known === null || updatedAt > known) outdated(target, CHANGED_ELSEWHERE)
  }
  sessionsChannel()?.addEventListener('message', onAnnounce)

  const unsubscribe = useEditor.subscribe(
    (s) => [s.doc, s.revision] as const,
    () => onChange(useEditor.getState()),
    { equalityFn: shallow },
  )
  onChange(useEditor.getState())

  const flush = () => saver?.flush() ?? Promise.resolve()
  // Leaving the page (tab switch, app switch on mobile, closing the tab, reload): write now,
  // without the version check, whose read would hold the write back past an unload.
  const flushLeaving = () => {
    leaving = true
    try {
      void flush()
    } finally {
      leaving = false
    }
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') flushLeaving()
  }
  const onPageHide = () => flushLeaving()
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', onPageHide)
  activeFlush = flush

  return () => {
    unsubscribe()
    sessionsChannel()?.removeEventListener('message', onAnnounce)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', onPageHide)
    if (activeFlush === flush) activeFlush = null
    retire(saver)
    saver = null
    target = null
  }
}

/**
 * The stored version a newly opened copy of a document saves against: the one its load read.
 * When it replaces a copy of the same file that already knew that version (no other tab saved
 * since), the two share the version object instead: changes that still reached the old copy
 * during the load, written as it is retired, then advance it rather than pass for another tab's.
 */
function baseVersion(docId: string, replaced: Target | null): SessionVersion {
  const loaded = loadedSessionVersion(docId)
  if (loaded !== null && replaced?.doc.id === docId && !replaced.outdated) {
    const own = replaced.version.updatedAt
    if (own !== null && own >= loaded) return replaced.version
  }
  return { updatedAt: loaded }
}

function persist({ state, target }: Snapshot, blind: boolean): Promise<void> {
  const { doc, version } = target
  // Newer than anything this tab has seen or written: later compare-and-swaps tell them apart.
  lastVersion = Math.max(Date.now(), lastVersion + 1, (version.updatedAt ?? 0) + 1)
  const session = buildSession(
    {
      docId: doc.id,
      fileName: doc.name,
      elements: state.elements,
      formValues: state.formValues,
      assets: state.assets,
    },
    lastVersion,
  )
  return saveSession(session, version, { blind }).then(() => {
    sessionsChannel()?.postMessage({ docId: doc.id, updatedAt: session.updatedAt })
    // Counted from what was stored (a blank text block still being typed into isn't).
    void patchRecentSoon(doc.id, {
      filledCount: filledCount({ ...state, elements: session.elements }),
      editedAt: session.updatedAt,
    })
  })
}

/** Opens the document again from its bytes, which loads the latest saved work. */
function reload(doc: LoadedDocument) {
  const { doc: open, openDocument } = useEditor.getState()
  if (open === doc) void openDocument({ name: doc.name, bytes: doc.bytes })
}

function requestThumbnail(doc: LoadedDocument) {
  if (thumbnailRequested.has(doc)) return
  thumbnailRequested.add(doc)
  void ensureThumbnail(doc)
}

/**
 * Renders page 1 for the recents list when the document doesn't have a thumbnail yet — except
 * for password-protected documents, whose content must not be shown without the password.
 */
async function ensureThumbnail(doc: LoadedDocument): Promise<void> {
  try {
    const recent = await getRecentDocument(doc.id)
    if (recent?.thumbnail || (await neededPassword(doc))) return
    await whenIdle()
    if (useEditor.getState().doc !== doc) return
    const thumbnail = await renderThumbnail(doc.pdf)
    await patchRecentSoon(doc.id, { thumbnail })
  } catch (err) {
    // Closing the document mid-render cancels pdf.js; that's not worth a warning.
    if (useEditor.getState().doc === doc) console.warn('[autosave] could not render a thumbnail', err)
  }
}

function identity<T>(v: T): T {
  return v
}
