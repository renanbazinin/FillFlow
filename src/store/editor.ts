import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { DATE_FORMATS, DEFAULT_STYLES, defaultDateFormat, MAX_FONT_SIZE, MIN_FONT_SIZE, withTextLayout } from '../model/elements'
import { FONT_IDS, loadFont } from '../model/fonts'
import type {
  Asset,
  DateFormat,
  Element,
  ElementPatch,
  FontId,
  FormField,
  FormValue,
  FormValues,
  PageInfo,
  StyleDefaults,
  ToolId,
} from '../model/types'
import { defaultFormValues, extractFormFields, getFormDocumentInfo } from '../lib/pdf/formFields'
import { storedValue } from '../lib/pdf/forms/values'
import { looksLikePdf, openPdf, PasswordRequiredError, readPageInfos, stopLoading, type PDFDocumentProxy } from '../lib/pdf/pdfjs'
import { loadDocumentBytes, loadSession, rememberDocument } from '../lib/storage/db'
import { clearMeasureCache } from '../lib/text/layout'
import { createId } from '../lib/utils/id'
import { clamp, sha256Hex } from '../lib/utils/misc'

// ---------------------------------------------------------------------------
// Zoom units: `scale` is CSS pixels per PDF point. 100% ("actual size") = 96/72.
// ---------------------------------------------------------------------------

export const PT_TO_PX = 96 / 72
export const MIN_SCALE = 0.25 * PT_TO_PX
export const MAX_SCALE = 5 * PT_TO_PX
export const zoomPercent = (scale: number) => Math.round((scale / PT_TO_PX) * 100)

const HISTORY_LIMIT = 200
const COALESCE_MS = 1200

export interface LoadedDocument {
  /** SHA-256 of the original bytes — stable key for sessions & recents. */
  id: string
  name: string
  /** Original, unmodified file bytes (never handed to pdf.js directly). */
  bytes: Uint8Array
  pdf: PDFDocumentProxy
  pages: PageInfo[]
  formFields: FormField[]
  /** Its saved work couldn't be read when it opened, so it opened without it. */
  sessionLoadFailed?: boolean
}

export type LoadState =
  | { status: 'idle' }
  | {
      status: 'loading'
      fileName: string
      /** Trying the password entered in the prompt, which stays up meanwhile. */
      unlocking?: boolean
    }
  | { status: 'password'; fileName: string; incorrect: boolean }
  | { status: 'error'; fileName: string; message: string }

export type DialogId = 'signature' | 'initials' | 'export' | 'shortcuts'

interface Content {
  elements: Element[]
  formValues: FormValues
}

interface HistoryEntry extends Content {
  /** Selection at the time, restored on undo/redo. */
  selection: string[]
}

export interface UpdateOptions {
  /**
   * Merge consecutive updates with the same key into one undo step (e.g. typing in a box:
   * `text:<id>`). Ignored while a gesture is active.
   */
  coalesce?: string
  /**
   * No undo step of its own: the change becomes part of the latest step, which is dropped if
   * that leaves it changing nothing (rare; e.g. a locked text getting its text back).
   */
  history?: false
}

export interface EditorState {
  // --- document ---
  doc: LoadedDocument | null
  load: LoadState

  // --- content (undoable) ---
  elements: Element[]
  formValues: FormValues
  /** Image payloads referenced by ImageElements. Append-only; not part of undo. */
  assets: Record<string, Asset>
  past: HistoryEntry[]
  future: HistoryEntry[]
  /** Increments on every content change; autosave watches this. */
  revision: number

  // --- interaction ---
  tool: ToolId
  /** When false, the tool reverts to 'select' after placing one item. */
  toolLocked: boolean
  /** Asset waiting to be placed by the signature / initials / image tool. */
  placingAssetId: string | null
  styles: StyleDefaults
  selection: string[]
  /** Text element currently being typed into. */
  editingId: string | null
  /** Focused AcroForm field (form panel ↔ page overlay sync). */
  activeFieldName: string | null

  // --- view ---
  scale: number
  fitMode: 'width' | 'page' | null
  currentPage: number
  leftPanelOpen: boolean
  rightPanelOpen: boolean
  rightPanelTab: 'form' | 'items'
  activeDialog: DialogId | null
}

export interface EditorActions {
  openDocument(input: File | { name: string; bytes: Uint8Array }, password?: string): Promise<boolean>
  /** Re-try a password-protected open; `null` cancels. */
  submitPassword(password: string | null): Promise<void>
  openRecent(id: string, name: string): Promise<boolean>
  /** Gives up on the open in progress (or the password prompt): the open document, if any, stays. */
  cancelOpen(): void
  closeDocument(): void
  dismissLoadError(): void

  addElement(el: Element, opts?: { select?: boolean; edit?: boolean }): void
  addElements(els: Element[], opts?: { select?: boolean }): void
  updateElement(id: string, patch: ElementPatch, opts?: UpdateOptions): void
  updateElements(patches: Record<string, ElementPatch>, opts?: UpdateOptions): void
  /** Locked elements are never removed. */
  removeElements(ids: string[], opts?: UpdateOptions): void
  duplicateElements(ids: string[], offset?: number): string[]
  reorderElements(ids: string[], where: 'front' | 'back'): void
  setFormValue(name: string, value: FormValue, opts?: UpdateOptions): void
  /** Removes every unlocked element and resets form fields to their original values. */
  clearAll(): void
  addAsset(asset: Omit<Asset, 'id'> & { id?: string }): string
  /** Re-measures all text elements (after fonts load). No undo step. */
  relayoutText(): void

  /** Start of a continuous edit (drag/resize): later updates collapse into one undo step. */
  beginGesture(): void
  endGesture(): void
  /** Abort the gesture and restore content from its start. */
  cancelGesture(): void
  undo(): void
  redo(): void

  select(ids: string[], mode?: 'replace' | 'add' | 'toggle'): void
  clearSelection(): void
  setEditing(id: string | null): void
  setActiveField(name: string | null): void

  setTool(tool: ToolId, opts?: { locked?: boolean }): void
  /** Arms the signature/initials/image tool with an asset to place on the next click. */
  startPlacingAsset(tool: 'signature' | 'initials' | 'image', assetId: string): void
  setStyle<K extends keyof StyleDefaults>(key: K, patch: StyleDefaults[K] extends object ? Partial<StyleDefaults[K]> : StyleDefaults[K]): void

  setScale(scale: number, fitMode?: 'width' | 'page' | null): void
  setCurrentPage(index: number): void
  setLeftPanelOpen(open: boolean): void
  setRightPanelOpen(open: boolean, tab?: 'form' | 'items'): void
  openDialog(id: DialogId): void
  closeDialog(): void
}

export type EditorStore = EditorState & EditorActions

const STYLE_STORAGE_KEY = 'fillflow:styles'

function loadStyles(): StyleDefaults {
  let saved: unknown = null
  try {
    const raw = localStorage.getItem(STYLE_STORAGE_KEY)
    saved = raw ? JSON.parse(raw) : null
  } catch {
    /* storage unavailable or unreadable */
  }
  return parseStyles(saved)
}

type Loose = Record<string, unknown>

const loose = (v: unknown): Loose => (v && typeof v === 'object' ? (v as Loose) : {})
const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
const isSize = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

/**
 * Style defaults as saved by any build (or edited by hand): each field is checked and falls
 * back to its default, so one bad value can't break placing items or opening documents.
 */
export function parseStyles(saved: unknown): StyleDefaults {
  const s = loose(saved)
  const text = loose(s.text)
  const mark = loose(s.mark)
  const shape = loose(s.shape)
  const ink = loose(s.ink)
  const d = DEFAULT_STYLES
  return {
    text: {
      fontId: FONT_IDS.includes(text.fontId as FontId) ? (text.fontId as FontId) : d.text.fontId,
      fontSize: isSize(text.fontSize) ? clamp(text.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE) : d.text.fontSize,
      color: isColor(text.color) ? text.color : d.text.color,
      bold: typeof text.bold === 'boolean' ? text.bold : d.text.bold,
    },
    mark: {
      color: isColor(mark.color) ? mark.color : d.mark.color,
      size: isSize(mark.size) ? mark.size : d.mark.size,
    },
    shape: {
      strokeColor: isColor(shape.strokeColor) ? shape.strokeColor : d.shape.strokeColor,
      fillColor: shape.fillColor === null || isColor(shape.fillColor) ? shape.fillColor : d.shape.fillColor,
      strokeWidth: isSize(shape.strokeWidth) ? shape.strokeWidth : d.shape.strokeWidth,
    },
    ink: {
      color: isColor(ink.color) ? ink.color : d.ink.color,
      strokeWidth: isSize(ink.strokeWidth) ? ink.strokeWidth : d.ink.strokeWidth,
    },
    dateFormat: DATE_FORMATS.includes(s.dateFormat as DateFormat) ? (s.dateFormat as DateFormat) : defaultDateFormat(),
  }
}

const TEXT_LAYOUT_KEYS = ['text', 'fontId', 'bold', 'fontSize', 'lineHeight', 'letterSpacing', 'align'] as const

/** Applies a patch; text elements are re-measured when a layout-affecting prop changes. */
function applyPatch(el: Element, patch: ElementPatch): Element {
  const next = { ...el, ...patch } as Element
  if (next.kind === 'text' && TEXT_LAYOUT_KEYS.some((k) => k in patch) && !('width' in patch && 'height' in patch)) {
    return withTextLayout(next)
  }
  return next
}

/** Equal by value: the same keys, each value identical (arrays compared item by item). */
function sameFields(a: object, b: object): boolean {
  if (a === b) return true
  const x = a as Loose
  const y = b as Loose
  const keys = Object.keys(x)
  if (keys.length !== Object.keys(y).length) return false
  return keys.every((k) => {
    if (!(k in y)) return false
    const v = x[k]
    const w = y[k]
    return Object.is(v, w) || (Array.isArray(v) && Array.isArray(w) && v.length === w.length && v.every((item, i) => Object.is(item, w[i])))
  })
}

/** Whether two contents are the same by value (a drag that ended where it started, a no-op reorder…). */
function sameContent(a: Content, b: Content): boolean {
  if (a.elements !== b.elements) {
    if (a.elements.length !== b.elements.length) return false
    if (!a.elements.every((e, i) => sameFields(e, b.elements[i]))) return false
  }
  return sameFields(a.formValues, b.formValues)
}

/** Pending input while waiting for a password. */
let pendingOpen: { name: string; bytes: Uint8Array } | null = null
/** Bumped by every open, cancel and close: an open started under an older token never applies. */
let openToken = 0
/** Settles the open in progress as not opened once it is superseded (see `runOpen`). */
let abandonOpen: (() => void) | null = null
/** Aborted once the open in progress is superseded: pdf.js lets go of what it loads at once. */
let openAbort: AbortController | null = null
let lastCoalesce: { key: string; at: number } | null = null
let gestureStart: Content | null = null

const initialView = {
  tool: 'select' as ToolId,
  toolLocked: false,
  placingAssetId: null,
  selection: [] as string[],
  editingId: null,
  activeFieldName: null,
  scale: PT_TO_PX,
  fitMode: 'width' as const,
  currentPage: 0,
  activeDialog: null,
}

export const useEditor = create<EditorStore>()(
  subscribeWithSelector((set, get) => {
    /** Records `prev` content as an undo step before it becomes `next` (honoring gestures and coalescing). */
    function pushHistory(prev: Content, next: Content, opts?: UpdateOptions) {
      if (gestureStart) return
      const { past, selection } = get()
      if (opts?.history === false) {
        // Part of the latest step, which has nothing left to undo once it changes nothing. Either
        // way, what follows starts a step of its own.
        lastCoalesce = null
        if (past.length && sameContent(past[past.length - 1], next)) set({ past: past.slice(0, -1) })
        return
      }
      const now = Date.now()
      if (opts?.coalesce && lastCoalesce && lastCoalesce.key === opts.coalesce && now - lastCoalesce.at < COALESCE_MS) {
        lastCoalesce.at = now
        return
      }
      lastCoalesce = opts?.coalesce ? { key: opts.coalesce, at: now } : null
      set({ past: [...past.slice(-(HISTORY_LIMIT - 1)), { ...prev, selection }], future: [] })
    }

    /** Commits a content change. One that changes nothing records nothing (and keeps redo). */
    function commit(next: Partial<Content>, opts?: UpdateOptions) {
      const s = get()
      const prev: Content = { elements: s.elements, formValues: s.formValues }
      const after: Content = { ...prev, ...next }
      if (sameContent(prev, after)) return
      pushHistory(prev, after, opts)
      set({ ...next, revision: s.revision + 1 })
    }

    function pruneSelection(elements: Element[], selection: string[]) {
      const ids = new Set(elements.map((e) => e.id))
      return selection.filter((id) => ids.has(id))
    }

    /** Supersedes the open in progress, if any: it never applies, and nothing waits on it any more. */
    function supersedeOpen(): number {
      abandonOpen?.()
      abandonOpen = null
      openAbort?.abort()
      openAbort = null
      return ++openToken
    }

    /**
     * Runs `open` as the open in progress, under a new token (see `openToken`). Resolves with
     * whether it opened, or with false as soon as it is superseded, even while one of its steps
     * (pdf.js, storage) never ends: each checks the token once it does, and `signal` is aborted
     * at once, so that pdf.js doesn't wait for that.
     */
    function runOpen(
      load: Extract<LoadState, { status: 'loading' }>,
      open: (token: number, signal: AbortSignal) => Promise<boolean>,
    ): Promise<boolean> {
      const token = supersedeOpen()
      const { signal } = (openAbort = new AbortController())
      set({ load })
      const abandoned = new Promise<boolean>((resolve) => (abandonOpen = () => resolve(false)))
      return Promise.race([open(token, signal), abandoned])
    }

    async function finishOpen(token: number, signal: AbortSignal, name: string, bytes: Uint8Array, password?: string): Promise<boolean> {
      // A newer open, a cancel or a close supersedes this one, however late it finishes.
      if (token !== openToken) return false
      let opening: Promise<PDFDocumentProxy> | null = null
      let pdf: PDFDocumentProxy | null = null
      try {
        if (!looksLikePdf(bytes)) throw new Error("This file doesn't look like a PDF.")
        opening = openPdf(bytes, password, signal)
        const [id, opened] = await Promise.all([sha256Hex(bytes), opening])
        pdf = opened
        // Given up on while pdf.js was busy: let go of the document now rather than after the rest.
        if (token !== openToken) {
          void pdf.loadingTask.destroy()
          return false
        }
        // Given up on during a later step: at once too, as that step (or its worker) may never end.
        const release = () => stopLoading(opened.loadingTask)
        signal.addEventListener('abort', release, { once: true })
        const pages = await readPageInfos(pdf)
        const formFields = await extractFormFields(pdf, pages).catch((err) => {
          // (Not when it failed because the open was given up on: see `release`.)
          if (token === openToken) console.warn('[forms] could not read form fields', err)
          return [] as FormField[]
        })
        // undefined: the saved work couldn't be read, so the document opens without it.
        const session = await loadSession(id).catch((err: unknown) => {
          console.warn('[storage] could not read the saved work', err)
          return undefined
        })
        const elements = session?.elements ?? []
        // Load the fonts this document uses before measuring any text.
        const fonts = new Map<string, [FontId, boolean]>()
        for (const e of elements) if (e.kind === 'text') fonts.set(`${e.fontId}:${e.bold}`, [e.fontId, e.bold])
        const { fontId: defFont, bold: defBold } = get().styles.text
        fonts.set(`${defFont}:${defBold}`, [defFont, defBold])
        await Promise.all([...fonts.values()].map(([fontId, bold]) => loadFont(fontId, bold)))
        clearMeasureCache()

        if (token !== openToken) {
          void pdf.loadingTask.destroy()
          return false
        }
        // It applies: from now on it is the open document, which a later abort must leave alone.
        signal.removeEventListener('abort', release)
        const hasFormTab = formFields.length > 0 || getFormDocumentInfo(pdf)?.pureXfa === true
        const previous = get().doc
        if (previous) void previous.pdf.loadingTask.destroy()
        gestureStart = null
        lastCoalesce = null
        pendingOpen = null
        set({
          doc: { id, name, bytes, pdf, pages, formFields, sessionLoadFailed: session === undefined },
          load: { status: 'idle' },
          elements: elements.map((e) => (e.kind === 'text' ? withTextLayout(e) : e)),
          formValues: { ...defaultFormValues(formFields), ...session?.formValues },
          assets: session?.assets ?? {},
          past: [],
          future: [],
          revision: 0,
          ...initialView,
          // A pure XFA form has no fields, but the form tab explains why it can't be filled.
          rightPanelTab: hasFormTab ? 'form' : 'items',
          rightPanelOpen: hasFormTab && typeof window !== 'undefined' && window.innerWidth >= 1280,
        })
        void rememberDocument({ id, name, size: bytes.byteLength, pageCount: pages.length }, bytes).catch((err) =>
          console.warn('[storage] could not remember document', err),
        )
        return true
      } catch (err) {
        // Whatever failed, the parsed document (its worker and its copy of the bytes) goes too,
        // even one that only arrives after the hashing failed.
        if (!pdf) void opening?.then((p) => p.loadingTask.destroy(), () => {})
        else if (get().doc?.pdf !== pdf) void pdf.loadingTask.destroy()
        if (token !== openToken) return false
        if (err instanceof PasswordRequiredError) {
          pendingOpen = { name, bytes }
          set({ load: { status: 'password', fileName: name, incorrect: err.incorrect } })
          return false
        }
        pendingOpen = null
        console.error('[open] failed', err)
        const message =
          err instanceof Error && err.name === 'InvalidPDFException'
            ? 'This PDF is damaged or not a valid PDF file.'
            : err instanceof Error
              ? err.message
              : 'Could not open this file.'
        set({ load: { status: 'error', fileName: name, message } })
        return false
      }
    }

    return {
      doc: null,
      load: { status: 'idle' },
      elements: [],
      formValues: {},
      assets: {},
      past: [],
      future: [],
      revision: 0,
      ...initialView,
      styles: loadStyles(),
      leftPanelOpen: typeof window !== 'undefined' && window.innerWidth >= 1024,
      rightPanelOpen: false,
      rightPanelTab: 'items',

      // --- document -------------------------------------------------------
      openDocument(input, password) {
        const name = input instanceof File ? input.name : input.name
        return runOpen({ status: 'loading', fileName: name }, async (token, signal) => {
          let bytes: Uint8Array
          try {
            bytes = input instanceof File ? new Uint8Array(await input.arrayBuffer()) : input.bytes
          } catch {
            if (token === openToken) set({ load: { status: 'error', fileName: name, message: 'Could not read the file.' } })
            return false
          }
          return finishOpen(token, signal, name, bytes, password)
        })
      },

      async submitPassword(password) {
        const p = pendingOpen
        if (!p || password === null) return get().cancelOpen()
        await runOpen({ status: 'loading', fileName: p.name, unlocking: true }, (token, signal) =>
          finishOpen(token, signal, p.name, p.bytes, password),
        )
      },

      openRecent(id, name) {
        return runOpen({ status: 'loading', fileName: name }, async (token, signal) => {
          let bytes: Uint8Array | null
          try {
            bytes = await loadDocumentBytes(id)
          } catch (err) {
            // The record may still be there (and the work saved with it): don't call it gone.
            console.warn('[storage] could not read document', err)
            if (token === openToken) {
              set({ load: { status: 'error', fileName: name, message: 'Couldn’t read this document from this device’s storage.' } })
            }
            return false
          }
          if (token !== openToken) return false
          if (!bytes) {
            set({ load: { status: 'error', fileName: name, message: 'This document is no longer stored on this device.' } })
            return false
          }
          return finishOpen(token, signal, name, bytes)
        })
      },

      cancelOpen() {
        // An open still in progress finds its token out of date and lets go of what it parsed.
        supersedeOpen()
        pendingOpen = null
        set({ load: { status: 'idle' } })
      },

      closeDocument() {
        const { doc } = get()
        if (doc) void doc.pdf.loadingTask.destroy()
        supersedeOpen()
        pendingOpen = null
        gestureStart = null
        lastCoalesce = null
        set({
          doc: null,
          load: { status: 'idle' },
          elements: [],
          formValues: {},
          assets: {},
          past: [],
          future: [],
          revision: 0,
          ...initialView,
        })
      },

      dismissLoadError() {
        pendingOpen = null
        set({ load: { status: 'idle' } })
      },

      // --- content --------------------------------------------------------
      addElement(el, opts) {
        commit({ elements: [...get().elements, el] })
        if (opts?.select !== false) set({ selection: [el.id], editingId: opts?.edit ? el.id : null })
      },

      addElements(els, opts) {
        if (!els.length) return
        commit({ elements: [...get().elements, ...els] })
        if (opts?.select !== false) set({ selection: els.map((e) => e.id), editingId: null })
      },

      updateElement(id, patch, opts) {
        const { elements } = get()
        const i = elements.findIndex((e) => e.id === id)
        if (i < 0) return
        const next = elements.slice()
        next[i] = applyPatch(elements[i], patch)
        commit({ elements: next }, opts)
      },

      updateElements(patches, opts) {
        const ids = Object.keys(patches)
        if (!ids.length) return
        const next = get().elements.map((e) => (patches[e.id] ? applyPatch(e, patches[e.id]) : e))
        commit({ elements: next }, opts)
      },

      removeElements(ids, opts) {
        const drop = new Set(ids)
        const { elements, selection, editingId } = get()
        const next = elements.filter((e) => !drop.has(e.id) || e.locked)
        if (next.length === elements.length) return
        commit({ elements: next }, opts)
        set({ selection: pruneSelection(next, selection), editingId: editingId && drop.has(editingId) ? null : editingId })
      },

      duplicateElements(ids, offset = 12) {
        const pick = new Set(ids)
        const { elements, doc } = get()
        const copies = elements
          .filter((e) => pick.has(e.id))
          .map((e) => {
            const page = doc?.pages[e.page]
            const x = page ? Math.min(e.x + offset, Math.max(0, page.width - e.width)) : e.x + offset
            const y = page ? Math.min(e.y + offset, Math.max(0, page.height - e.height)) : e.y + offset
            return { ...e, id: createId(), x, y, locked: false } as Element
          })
        if (!copies.length) return []
        commit({ elements: [...elements, ...copies] })
        set({ selection: copies.map((c) => c.id), editingId: null })
        return copies.map((c) => c.id)
      },

      reorderElements(ids, where) {
        const pick = new Set(ids)
        const { elements } = get()
        const moving = elements.filter((e) => pick.has(e.id))
        if (!moving.length) return
        const rest = elements.filter((e) => !pick.has(e.id))
        commit({ elements: where === 'front' ? [...rest, ...moving] : [...moving, ...rest] })
      },

      setFormValue(name, value, opts) {
        const { formValues } = get()
        if (storedValue(formValues, name) === value) return
        commit({ formValues: { ...formValues, [name]: value } }, opts)
      },

      clearAll() {
        const { doc, elements, selection } = get()
        // Locked items stay, as with every other way of deleting.
        const kept = elements.filter((e) => e.locked)
        commit({ elements: kept, formValues: doc ? defaultFormValues(doc.formFields) : {} })
        set({ selection: pruneSelection(kept, selection), editingId: null })
      },

      addAsset(asset) {
        const id = asset.id ?? createId()
        set((s) => ({ assets: { ...s.assets, [id]: { ...asset, id } }, revision: s.revision + 1 }))
        return id
      },

      relayoutText() {
        const { elements } = get()
        let changed = false
        const next = elements.map((e) => {
          if (e.kind !== 'text') return e
          const r = withTextLayout(e)
          if (Math.abs(r.width - e.width) > 0.01 || Math.abs(r.height - e.height) > 0.01) changed = true
          return r
        })
        if (changed) set((s) => ({ elements: next, revision: s.revision + 1 }))
      },

      // --- history ----------------------------------------------------------
      beginGesture() {
        const { elements, formValues } = get()
        gestureStart = { elements, formValues }
        lastCoalesce = null
      },

      endGesture() {
        const start = gestureStart
        gestureStart = null
        if (!start) return
        const { elements, formValues, past, selection } = get()
        // Compared by value: a drag can go away and come back, or push against the page edge.
        if (sameContent(start, { elements, formValues })) return
        set({ past: [...past.slice(-(HISTORY_LIMIT - 1)), { ...start, selection }], future: [] })
      },

      cancelGesture() {
        const start = gestureStart
        gestureStart = null
        if (!start) return
        set((s) => ({ ...start, revision: s.revision + 1 }))
      },

      undo() {
        const { past, future, elements, formValues, selection, revision } = get()
        const prev = past[past.length - 1]
        if (!prev) return
        gestureStart = null
        lastCoalesce = null
        set({
          past: past.slice(0, -1),
          future: [{ elements, formValues, selection }, ...future],
          elements: prev.elements,
          formValues: prev.formValues,
          selection: pruneSelection(prev.elements, prev.selection),
          editingId: null,
          revision: revision + 1,
        })
      },

      redo() {
        const { past, future, elements, formValues, selection, revision } = get()
        const next = future[0]
        if (!next) return
        gestureStart = null
        lastCoalesce = null
        set({
          past: [...past, { elements, formValues, selection }],
          future: future.slice(1),
          elements: next.elements,
          formValues: next.formValues,
          selection: pruneSelection(next.elements, next.selection),
          editingId: null,
          revision: revision + 1,
        })
      },

      // --- selection & tools ------------------------------------------------
      select(ids, mode = 'replace') {
        const { selection, editingId } = get()
        let next: string[]
        if (mode === 'replace') next = ids
        else if (mode === 'add') next = [...new Set([...selection, ...ids])]
        else {
          const cur = new Set(selection)
          for (const id of ids) {
            if (cur.has(id)) cur.delete(id)
            else cur.add(id)
          }
          next = [...cur]
        }
        set({ selection: next, editingId: editingId && next.includes(editingId) ? editingId : null })
      },

      clearSelection() {
        if (get().selection.length || get().editingId) set({ selection: [], editingId: null })
      },

      setEditing(id) {
        set(id ? { editingId: id, selection: [id] } : { editingId: null })
      },

      setActiveField(name) {
        set({ activeFieldName: name })
      },

      setTool(tool, opts) {
        set({
          tool,
          toolLocked: opts?.locked ?? false,
          placingAssetId: null,
          editingId: null,
          ...(tool !== 'select' ? { selection: [] } : {}),
        })
      },

      startPlacingAsset(tool, assetId) {
        set({ tool, placingAssetId: assetId, toolLocked: false, selection: [], editingId: null })
      },

      setStyle(key, patch) {
        const styles = get().styles
        const value = typeof patch === 'object' && patch !== null ? { ...(styles[key] as object), ...patch } : patch
        const next = { ...styles, [key]: value } as StyleDefaults
        set({ styles: next })
        try {
          localStorage.setItem(STYLE_STORAGE_KEY, JSON.stringify(next))
        } catch {
          /* storage unavailable */
        }
      },

      // --- view -------------------------------------------------------------
      setScale(scale, fitMode = null) {
        set({ scale: clamp(scale, MIN_SCALE, MAX_SCALE), fitMode })
      },

      setCurrentPage(index) {
        if (get().currentPage !== index) set({ currentPage: index })
      },

      setLeftPanelOpen(open) {
        set({ leftPanelOpen: open })
      },

      setRightPanelOpen(open, tab) {
        set(tab ? { rightPanelOpen: open, rightPanelTab: tab } : { rightPanelOpen: open })
      },

      openDialog(id) {
        set({ activeDialog: id })
      },

      closeDialog() {
        set({ activeDialog: null })
      },
    }
  }),
)

// ---------------------------------------------------------------------------
// Selectors & non-React helpers.
// ---------------------------------------------------------------------------

export const selectCanUndo = (s: EditorStore) => s.past.length > 0
export const selectCanRedo = (s: EditorStore) => s.future.length > 0

/** Elements on one page, in paint order. Use with `useShallow` or compare by reference. */
export function elementsOnPage(elements: Element[], page: number): Element[] {
  return elements.filter((e) => e.page === page)
}

export function getSelectedElements(s: EditorState = useEditor.getState()): Element[] {
  const ids = new Set(s.selection)
  return s.elements.filter((e) => ids.has(e.id))
}

/** Count of user contributions: placed elements + form fields that differ from the original. */
export function filledCount(s: EditorState = useEditor.getState()): number {
  const fields = s.doc?.formFields ?? []
  let n = s.elements.length
  for (const f of fields) {
    const v = storedValue(s.formValues, f.name)
    if (v !== undefined && JSON.stringify(v) !== JSON.stringify(f.defaultValue)) n++
  }
  return n
}
