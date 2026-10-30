import { create } from 'zustand'
import { INK_COLORS } from '../../model/elements'
import { isSignatureFontId, type SignatureFontId } from './fonts'
import type { BackgroundMap } from './imageUtils'
import type { SignatureRole } from './library'
import { PEN_WIDTHS, type PenWidth, type Stroke } from './strokes'
import { initialsFrom } from './text'

/**
 * State of the signature dialog: remembered preferences (localStorage) plus the in-progress
 * content of each role. Drafts live in memory only, so an accidental dismiss doesn't lose a
 * drawing; they are cleared once the result is used.
 */

export type SignatureTab = 'draw' | 'type' | 'upload'
export const SIGNATURE_TABS: SignatureTab[] = ['draw', 'type', 'upload']

/** Ink colors offered for signatures: black, blue, red. */
export const SIGNATURE_INKS: readonly string[] = INK_COLORS.slice(0, 3)

export interface UploadDraft {
  fileName: string
  /** Decoded image, downscaled to a working size. */
  source: HTMLCanvasElement
  /** Small copy of `source` for live previews. */
  preview: HTMLCanvasElement
  /** Lighting model of the photo (computed once, from the preview). */
  map: BackgroundMap
  autoWhitePoint: number
  removeBg: boolean
  whitePoint: number
}

interface Prefs {
  tab: SignatureTab
  color: string
  pen: PenWidth
  font: SignatureFontId
  save: boolean
  /** Last typed signature name. */
  name: string
  /** Last typed initials, when they differ from the name's initials. */
  initials: string
}

const PREFS_KEY = 'fillflow:signature'

const DEFAULT_PREFS: Prefs = {
  tab: 'draw',
  color: SIGNATURE_INKS[0],
  pen: 'medium',
  font: 'great-vibes',
  save: true,
  name: '',
  initials: '',
}

function readPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Record<keyof Prefs, unknown>>
    return {
      tab: SIGNATURE_TABS.includes(raw.tab as SignatureTab) ? (raw.tab as SignatureTab) : DEFAULT_PREFS.tab,
      color: SIGNATURE_INKS.includes(raw.color as string) ? (raw.color as string) : DEFAULT_PREFS.color,
      pen: PEN_WIDTHS.includes(raw.pen as PenWidth) ? (raw.pen as PenWidth) : DEFAULT_PREFS.pen,
      font: isSignatureFontId(raw.font) ? raw.font : DEFAULT_PREFS.font,
      save: typeof raw.save === 'boolean' ? raw.save : DEFAULT_PREFS.save,
      name: typeof raw.name === 'string' ? raw.name : '',
      initials: typeof raw.initials === 'string' ? raw.initials : '',
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

function writePrefs(patch: Partial<Prefs>): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), ...patch }))
  } catch {
    /* storage unavailable */
  }
}

type PerRole<T> = Record<SignatureRole, T>

export interface DraftState {
  tab: SignatureTab
  color: string
  pen: PenWidth
  font: SignatureFontId
  save: boolean
  strokes: PerRole<Stroke[]>
  text: PerRole<string>
  upload: PerRole<UploadDraft | null>
  /** The upload has nothing left after background removal. */
  uploadEmpty: PerRole<boolean>

  setTab(tab: SignatureTab): void
  setColor(color: string): void
  setPen(pen: PenWidth): void
  setFont(font: SignatureFontId): void
  setSave(save: boolean): void
  addStroke(role: SignatureRole, stroke: Stroke): void
  undoStroke(role: SignatureRole): void
  clearStrokes(role: SignatureRole): void
  setText(role: SignatureRole, text: string): void
  setUpload(role: SignatureRole, upload: UploadDraft | null): void
  patchUpload(role: SignatureRole, patch: Partial<Pick<UploadDraft, 'removeBg' | 'whitePoint'>>): void
  setUploadEmpty(role: SignatureRole, empty: boolean): void
  /** Pre-fills the Type tab from the remembered name when it's empty. */
  prefill(role: SignatureRole): void
  /** Remembers the typed name / initials for next time. */
  rememberText(role: SignatureRole): void
  /** Clears the content of the given tab after it was used. */
  consume(role: SignatureRole, tab: SignatureTab): void
}

const initial = readPrefs()

export const useSignatureDraft = create<DraftState>()((set, get) => ({
  tab: initial.tab,
  color: initial.color,
  pen: initial.pen,
  font: initial.font,
  save: initial.save,
  strokes: { signature: [], initials: [] },
  text: { signature: '', initials: '' },
  upload: { signature: null, initials: null },
  uploadEmpty: { signature: false, initials: false },

  setTab(tab) {
    set({ tab })
    writePrefs({ tab })
  },
  setColor(color) {
    set({ color })
    writePrefs({ color })
  },
  setPen(pen) {
    set({ pen })
    writePrefs({ pen })
  },
  setFont(font) {
    set({ font })
    writePrefs({ font })
  },
  setSave(save) {
    set({ save })
    writePrefs({ save })
  },

  addStroke(role, stroke) {
    set((s) => ({ strokes: { ...s.strokes, [role]: [...s.strokes[role], stroke] } }))
  },
  undoStroke(role) {
    set((s) => ({ strokes: { ...s.strokes, [role]: s.strokes[role].slice(0, -1) } }))
  },
  clearStrokes(role) {
    set((s) => ({ strokes: { ...s.strokes, [role]: [] } }))
  },

  setText(role, text) {
    set((s) => ({ text: { ...s.text, [role]: text } }))
  },

  setUpload(role, upload) {
    set((s) => ({ upload: { ...s.upload, [role]: upload }, uploadEmpty: { ...s.uploadEmpty, [role]: false } }))
  },
  patchUpload(role, patch) {
    const current = get().upload[role]
    if (current) set((s) => ({ upload: { ...s.upload, [role]: { ...current, ...patch } } }))
  },
  setUploadEmpty(role, empty) {
    if (get().uploadEmpty[role] !== empty) set((s) => ({ uploadEmpty: { ...s.uploadEmpty, [role]: empty } }))
  },

  prefill(role) {
    if (get().text[role].trim()) return
    const prefs = readPrefs()
    const text = role === 'signature' ? prefs.name : prefs.initials || initialsFrom(prefs.name)
    if (text) set((s) => ({ text: { ...s.text, [role]: text } }))
  },
  rememberText(role) {
    const text = get().text[role].trim()
    if (!text) return
    if (role === 'signature') {
      // A new name re-derives the initials.
      if (text !== readPrefs().name) writePrefs({ name: text, initials: '' })
    } else {
      writePrefs({ initials: text === initialsFrom(readPrefs().name) ? '' : text })
    }
  },
  consume(role, tab) {
    if (tab === 'draw') get().clearStrokes(role)
    else if (tab === 'upload') get().setUpload(role, null)
    // Typed text stays: it is the remembered name.
  },
}))

/** Whether the given tab has something to use. */
export function draftHasContent(s: DraftState, role: SignatureRole, tab: SignatureTab): boolean {
  if (tab === 'draw') return s.strokes[role].length > 0
  if (tab === 'type') return s.text[role].trim().length > 0
  return s.upload[role] !== null && !s.uploadEmpty[role]
}
