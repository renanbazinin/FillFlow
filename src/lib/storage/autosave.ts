import { useEffect } from 'react'
import { toast } from 'sonner'
import { shallow } from 'zustand/shallow'
import { confirm } from '../../components/ui/confirm'
import { STAYING_TOASTER } from '../../components/ui/toasts'
import { getT } from '../../i18n'
import { filledCount, useEditor, type EditorState, type LoadedDocument } from '../../store/editor'
import { createAutosaver, type Autosaver } from './autosaver'
import {
  SessionConflictError,
  SessionRemovedError,
  StorageUnavailableError,
  getRecentDocument,
  loadedSessionVersion,
  rememberDocument,
  requestPersistentStorage,
  saveSession,
  sessionsChannel,
  type SessionVersion,
} from './db'
import { neededPassword } from './protectedDocs'
import { patchRecentSoon } from './recentPatches'
import { IDLE_STATUS, describeStorageError, setSaveStatus, useSaveStatusStore, type SaveStatus } from './saveStatus'
import { buildSession } from './session'
import { renderThumbnail, whenIdle } from './thumbnail'

export type { SaveStatus } from './saveStatus'
/** Tabs announce each session they save or delete on this channel (see `startAutosave`). */
export { SESSIONS_CHANNEL } from './db'

/** Quiet time after the last change before it is written. */
export const AUTOSAVE_DELAY_MS = 600
/** A long burst of changes (typing a paragraph) is still written at least this often. */
export const AUTOSAVE_MAX_WAIT_MS = 3000
const ERROR_TOAST_ID = 'autosave-error'
const OUTDATED_TOAST_ID = 'autosave-outdated'
const STORAGE_TOAST_ID = 'storage-unavailable'
const NOT_STORED_TOAST_ID = 'file-not-stored'

/**
 * Why a copy of a document is out of date, so no longer saved: another tab saved newer work, its
 * saved work didn't load here (and is there after all), or another tab removed it from this device.
 * Its words are in the interface's messages (`editor.save.outdated`).
 */
type OutdatedReason = 'changedElsewhere' | 'notLoaded' | 'removed'

/** Autosave state of one opened document. */
interface Target {
  doc: LoadedDocument
  /**
   * The stored session this tab's copy is based on; each committed write advances it. A copy of
   * the same file opened again in its place may share it (see `baseVersion`).
   */
  version: SessionVersion
  /** Why this copy is out of date (newer work is stored), so it is no longer saved; else null. */
  outdated: OutdatedReason | null
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
/**
 * The document with which the user was told that nothing can be stored in this browser (once per
 * page load: the message goes with that document); null until then.
 */
let storageNoticeFor: string | null = null
let activeFlush: (() => Promise<void>) | null = null
const thumbnailRequested = new WeakSet<LoadedDocument>()
/** Newest session version this tab has written (versions only ever increase, see `persist`). */
let lastVersion = 0

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
        // Its work is what is stored now: reloading would only bring back what is on screen.
        if (target.doc.sessionLoadFailed) toast.dismiss(OUTDATED_TOAST_ID)
        setSaveStatus({ state: 'saved', savedAt: Date.now() })
      },
      onError(snap, err) {
        if (err instanceof SessionConflictError) {
          return outdated(snap.target, snap.target.version.updatedAt === null ? 'notLoaded' : 'changedElsewhere')
        }
        if (err instanceof SessionRemovedError) return outdated(snap.target, 'removed')
        console.warn('[autosave] could not save', err)
        if (snap.target !== target) return reportLost(snap.target, describeStorageError(err))
        if (target.outdated) return
        // Where nothing can be stored, the user was told so as the document opened (see `switchTo`).
        if (!errorToastShown && !(err instanceof StorageUnavailableError && storageNoticeFor !== null)) {
          errorToastShown = true
          const m = getT().editor.save
          toast.error(m.failed, {
            id: ERROR_TOAST_ID,
            description: m.downloadToKeep(describeStorageError(err)),
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
  function markNotSaved(t: Target, reason: OutdatedReason) {
    t.warned = true
    const error = `${getT().editor.save.outdated[reason]}.`
    setSaveStatus({ state: 'error', savedAt: useSaveStatusStore.getState().savedAt, error })
  }

  // The actions of these messages keep them up as they run (sonner closes them otherwise): they go
  // once the document is opened again with its work, or kept (see `switchTo`, `keep`), and stay
  // up when that doesn't happen, the open failing again included.
  function showOutdated(t: Target, reason: OutdatedReason) {
    const m = getT().editor.save
    const removed = reason === 'removed'
    toast.error(m.outdated[reason], {
      id: OUTDATED_TOAST_ID,
      description: removed ? m.removedBody : m.outdatedBody,
      duration: Infinity,
      toasterId: STAYING_TOASTER,
      action: removed
        ? {
            label: m.keep,
            onClick: (e) => {
              e.preventDefault()
              keep(t)
            },
          }
        : {
            label: m.reload,
            onClick: (e) => {
              e.preventDefault()
              void reload(t.doc)
            },
          },
    })
  }

  /**
   * The copy opened without its saved work, which couldn't be read: say so before any work goes
   * into it. Its first save then either finds that work, and stops (see `outdated`), or finds
   * none it can read, and takes its place.
   */
  function showNotLoaded(t: Target) {
    const m = getT().editor.save
    toast.error(m.outdated.notLoaded, {
      id: OUTDATED_TOAST_ID,
      description: m.notLoadedBody,
      duration: Infinity,
      toasterId: STAYING_TOASTER,
      action: {
        label: m.reload,
        onClick: (e) => {
          e.preventDefault()
          void reload(t.doc)
        },
      },
    })
  }

  /**
   * Nothing can be stored in this browser: say so once, before any work goes in. (An error, as
   * every message that stays until acted on is: the popovers and dialogs that clear passing
   * messages out of their way leave those up.)
   */
  function showStorageUnavailable(t: Target) {
    if (storageNoticeFor !== null) return
    storageNoticeFor = t.doc.id
    const { editor } = getT()
    toast.error(editor.save.unavailable, {
      id: STORAGE_TOAST_ID,
      description: editor.save.downloadToKeep(editor.storage.blocked),
      duration: Infinity,
      toasterId: STAYING_TOASTER,
      action: { label: editor.save.gotIt, onClick: () => {} },
    })
  }

  /**
   * The file couldn't be stored (no room for it): it is listed, and its work saved, but only the
   * file opened again continues that work, so the user had better keep it. (An error: see above.)
   */
  function reportNotStored(t: Target, stored: Promise<void> | undefined) {
    void stored?.catch((err: unknown) => {
      if (t !== target || t.doc.storageUnavailable || err instanceof StorageUnavailableError) return
      const m = getT().editor.save
      toast.error(m.fileNotStored, {
        id: NOT_STORED_TOAST_ID,
        description: m.fileNotStoredBody(describeStorageError(err)),
        duration: Infinity,
        toasterId: STAYING_TOASTER,
        action: { label: m.gotIt, onClick: () => {} },
      })
    })
  }

  /**
   * The user keeps the document after it was removed from this device elsewhere: it is stored and
   * listed again, and what is on screen is saved, from now on as before.
   */
  function keep(t: Target) {
    if (t !== target || t.outdated !== 'removed') return
    toast.dismiss(OUTDATED_TOAST_ID)
    const { doc } = t
    t.outdated = null
    t.warned = false
    t.version = { updatedAt: 0 }
    saver = createSaver()
    saver.schedule({ state: useEditor.getState(), target: t })
    markSaving()
    const stored = rememberDocument({ id: doc.id, name: doc.name, size: doc.bytes.byteLength, pageCount: doc.pages.length }, doc.bytes)
    void stored.then(
      () => {
        // Listed anew, without its page preview.
        thumbnailRequested.delete(doc)
        requestThumbnail(doc)
      },
      (err: unknown) => console.warn('[storage] could not remember document', err),
    )
    reportNotStored(t, stored)
  }

  /** Newer work on `t` is stored, or none any more: stop saving this copy over it, and offer a way out. */
  function outdated(t: Target, reason: OutdatedReason) {
    if (t !== target) return reportLost(t, getT().editor.save.lostBecause[reason])
    if (t.outdated) return
    t.outdated = reason
    const unsaved = saver !== null && (saver.queued || saver.busy)
    saver?.dispose()
    saver = null
    // Removed, none of it is stored any more: the work on screen, saved or loaded, is the only copy.
    const removedWork = reason === 'removed' && filledCount() > 0
    if (unsaved || removedWork || useSaveStatusStore.getState().state === 'error') markNotSaved(t, reason)
    // Nor is a removed document without any work saved: it is as good as just opened.
    else if (reason === 'removed') setSaveStatus(IDLE_STATUS)
    showOutdated(t, reason)
  }

  /**
   * The last write of a document that is no longer open failed: say so (`description`: why),
   * unless the user knows.
   */
  function reportLost(t: Target, description: string) {
    if (t.warned) return
    t.warned = true
    toast.error(getT().editor.save.lost(t.doc.name), { description })
  }

  function switchTo(s: EditorState) {
    const replaced = target
    retire(saver)
    // About the document on screen. (The one about storage goes with the document it was shown
    // with, never to come back.)
    toast.dismiss(OUTDATED_TOAST_ID)
    toast.dismiss(NOT_STORED_TOAST_ID)
    if (s.doc?.id !== storageNoticeFor) toast.dismiss(STORAGE_TOAST_ID)
    target = s.doc ? { doc: s.doc, version: baseVersion(s.doc.id, replaced), outdated: null, warned: false } : null
    baseline = { elements: s.elements, formValues: s.formValues }
    saver = target ? createSaver() : null
    setSaveStatus(IDLE_STATUS)
    if (target) {
      requestThumbnail(target.doc)
      // Storage that can't be used at all holds no saved work that could have failed to load.
      if (target.doc.storageUnavailable) showStorageUnavailable(target)
      else if (target.doc.sessionLoadFailed) showNotLoaded(target)
      reportNotStored(target, target.doc.stored)
    }
  }

  function onChange(s: EditorState) {
    if (s.doc !== (target?.doc ?? null)) return switchTo(s)
    if (!target || s.revision === 0) return
    // Back to what is already stored (an undo before the timer fired, an asset added without
    // being placed, such as a saved signature taken up…): nothing to write, nor anything unsaved.
    const unchanged = baseline !== null && s.elements === baseline.elements && s.formValues === baseline.formValues
    if (target.outdated) {
      // Nothing is saved here any more: make sure the user knows before putting in more work.
      if (!unchanged && useSaveStatusStore.getState().state !== 'error') {
        markNotSaved(target, target.outdated)
        showOutdated(target, target.outdated)
      }
      return
    }
    if (!saver) return
    if (unchanged) {
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
    // Where nothing can be stored (and nothing has been), say so at once rather than once the write
    // fails: leaving then asks first from the very first change.
    const { savedAt } = useSaveStatusStore.getState()
    if (!target.doc.storageUnavailable || savedAt !== null) return markSaving()
    setSaveStatus({ state: 'error', savedAt, error: getT().editor.storage.blocked })
  }

  /**
   * Another tab committed a session, or deleted one (removing the document from this device): if
   * it's for this document, the copy here is out of date.
   */
  const onAnnounce = (e: MessageEvent) => {
    const { docId, updatedAt, removed } = (e.data ?? {}) as { docId?: unknown; updatedAt?: unknown; removed?: unknown }
    if (!target || target.outdated || docId !== target.doc.id) return
    if (removed === true) return outdated(target, 'removed')
    if (typeof updatedAt !== 'number') return
    const known = target.version.updatedAt
    if (known === null || updatedAt > known) outdated(target, 'changedElsewhere')
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
  // without the version check, whose read would hold the write back past an unload (unless
  // the stored version is unknown, see `persist`).
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
  // Never blind against an unknown base (the copy's saved work didn't load): the check then
  // refuses the write rather than let a copy without that work replace it.
  return saveSession(session, version, { blind: blind && version.updatedAt !== null }).then(() => {
    sessionsChannel()?.postMessage({ docId: doc.id, updatedAt: session.updatedAt })
    // Counted from what was stored (a blank text block still being typed into isn't).
    void patchRecentSoon(doc.id, {
      filledCount: filledCount({ ...state, elements: session.elements }),
      editedAt: session.updatedAt,
    })
  })
}

/**
 * Opens the document again from its bytes, which loads the latest saved work. As when leaving it
 * (see `confirmLeaveDocument`): changes still waiting are written first, and changes made here
 * that couldn't be saved are only thrown away once the user agrees.
 */
async function reload(doc: LoadedDocument) {
  if (useEditor.getState().doc !== doc) return
  await flushAutosave()
  if (useEditor.getState().doc !== doc) return
  if (useSaveStatusStore.getState().state === 'error') {
    const m = getT().editor.unsaved
    const ok = await confirm({
      title: m.reloadTitle,
      description: m.body,
      confirmLabel: m.reload,
      danger: true,
    })
    if (!ok) return
  }
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
