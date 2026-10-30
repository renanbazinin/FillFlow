import { useEffect } from 'react'
import { toast } from 'sonner'
import { shallow } from 'zustand/shallow'
import { filledCount, useEditor, type EditorState, type LoadedDocument } from '../../store/editor'
import { createAutosaver, type Autosaver } from './autosaver'
import { getRecentDocument, requestPersistentStorage, saveSession } from './db'
import { neededPassword } from './protectedDocs'
import { patchRecentSoon } from './recentPatches'
import { IDLE_STATUS, describeStorageError, setSaveStatus, useSaveStatusStore, type SaveStatus } from './saveStatus'
import { buildSession } from './session'
import { renderThumbnail, whenIdle } from './thumbnail'

export type { SaveStatus } from './saveStatus'

/** Quiet time after the last change before it is written. */
export const AUTOSAVE_DELAY_MS = 600
const ERROR_TOAST_ID = 'autosave-error'

interface Snapshot {
  /** The (immutable) store state right after the change. */
  state: EditorState
  doc: LoadedDocument
  /** Which opened document this belongs to; stale results never touch the status. */
  generation: number
}

type Content = Pick<EditorState, 'elements' | 'formValues'>

/** One error toast per failure streak, app-wide. */
let errorToastShown = false
let activeFlush: (() => Promise<void>) | null = null
const thumbnailRequested = new WeakSet<LoadedDocument>()

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

/** Writes any pending change right away (e.g. before navigating away). */
export function flushAutosave(): Promise<void> {
  return activeFlush?.() ?? Promise.resolve()
}

/** Starts autosaving; returns a stop function that flushes pending work. Used by `useAutosave`. */
export function startAutosave(): () => void {
  let doc: LoadedDocument | null = null
  let saver: Autosaver<Snapshot> | null = null
  /** Content known to be stored (or in flight); null when unknown (after a failure). */
  let baseline: Content | null = null
  let generation = 0

  const createSaver = () =>
    createAutosaver<Snapshot>({
      delay: AUTOSAVE_DELAY_MS,
      save: persist,
      onStart(snap) {
        if (snap.generation !== generation) return
        baseline = { elements: snap.state.elements, formValues: snap.state.formValues }
        setSaveStatus({ state: 'saving', savedAt: useSaveStatusStore.getState().savedAt })
      },
      onSuccess(snap) {
        if (errorToastShown) {
          errorToastShown = false
          toast.dismiss(ERROR_TOAST_ID)
        }
        void requestPersistentStorage()
        if (snap.generation === generation) setSaveStatus({ state: 'saved', savedAt: Date.now() })
      },
      onError(snap, err) {
        console.warn('[autosave] could not save', err)
        if (!errorToastShown) {
          errorToastShown = true
          toast.error("Couldn't save your progress on this device", {
            id: ERROR_TOAST_ID,
            description: `${describeStorageError(err)} Download your PDF to keep your changes.`,
          })
        }
        if (snap.generation !== generation) return
        baseline = null
        setSaveStatus({ state: 'error', savedAt: useSaveStatusStore.getState().savedAt, error: describeStorageError(err) })
      },
    })

  /** Writes the previous document's pending work now, then retires its saver. */
  const retire = (old: Autosaver<Snapshot> | null) => {
    if (old) void old.flush().finally(() => old.dispose())
  }

  function switchTo(s: EditorState) {
    retire(saver)
    generation++
    doc = s.doc
    baseline = { elements: s.elements, formValues: s.formValues }
    saver = doc ? createSaver() : null
    setSaveStatus(IDLE_STATUS)
    if (doc) requestThumbnail(doc)
  }

  function onChange(s: EditorState) {
    if (s.doc !== doc) return switchTo(s)
    if (!doc || !saver || s.revision === 0) return
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
    saver.schedule({ state: s, doc, generation })
    const cur = useSaveStatusStore.getState()
    if (cur.state !== 'saving') setSaveStatus({ state: 'saving', savedAt: cur.savedAt })
  }

  const unsubscribe = useEditor.subscribe(
    (s) => [s.doc, s.revision] as const,
    () => onChange(useEditor.getState()),
    { equalityFn: shallow },
  )
  onChange(useEditor.getState())

  // Leaving the page (tab switch, app switch on mobile, closing the tab): write now.
  const flush = () => saver?.flush() ?? Promise.resolve()
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') void flush()
  }
  const onPageHide = () => void flush()
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', onPageHide)
  activeFlush = flush

  return () => {
    unsubscribe()
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', onPageHide)
    if (activeFlush === flush) activeFlush = null
    retire(saver)
    saver = null
    doc = null
    generation++
  }
}

function persist({ state, doc }: Snapshot): Promise<void> {
  const session = buildSession({
    docId: doc.id,
    fileName: doc.name,
    elements: state.elements,
    formValues: state.formValues,
    assets: state.assets,
  })
  return saveSession(session).then(() => {
    void patchRecentSoon(doc.id, { filledCount: filledCount(state) })
  })
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
