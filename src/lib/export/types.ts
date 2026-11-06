import type { Asset, Element, FontId, FormField, FormValues, PageInfo, TextElement } from '../../model/types'
import type { TextBlockLayout, TextMeasurer } from '../text/layout'

export interface ExportOptions {
  /** Bake form fields into static page content (no longer editable). */
  flattenForms: boolean
}

export interface ExportInput {
  /** Original file bytes. */
  bytes: Uint8Array
  pages: PageInfo[]
  elements: Element[]
  assets: Record<string, Asset>
  formFields: FormField[]
  formValues: FormValues
  options: ExportOptions
}

export type ExportPhase = 'prepare' | 'forms' | 'pages' | 'save'

export interface ExportProgress {
  phase: ExportPhase
  /** Pages drawn so far (phase 'pages'). */
  done: number
  /** Pages to draw (phase 'pages'). */
  total: number
}

/** Original document metadata recovered when the file had to be rewritten (decrypted) by pdf.js. */
export interface RecoveredInfo {
  title?: string
  author?: string
  subject?: string
  keywords?: string
  creator?: string
  creationDate?: Date
}

/** An optional content group (layer) of the original file, as pdf.js reads it. */
export interface RecoveredLayer {
  /** pdf.js id: the group's object reference in the original ("12R"). */
  id: string
  name: string | null
  intent: string[] | null
  /** /Usage states viewers apply on screen and in print. */
  view: 'ON' | 'OFF' | null
  print: 'ON' | 'OFF' | null
  /** On in the default configuration (before usage states). */
  on: boolean
  /** Radio-button sets (group ids) the group belongs to. */
  rbGroups: string[][]
}

/** The layers panel order: group ids and (optionally labelled) sub-lists. */
export type RecoveredLayerOrder = (string | { name: string | null; order: RecoveredLayerOrder })[]

/** Catalog entries the pdf.js rewrite leaves out, read (decrypted) from the original by pdf.js. */
export interface RecoveredCatalog {
  layers?: { name: string | null; creator: string | null; groups: RecoveredLayer[]; order: RecoveredLayerOrder | null }
  /** One label per page. */
  pageLabels?: string[]
  pageMode?: string
  pageLayout?: string
  viewerPreferences?: Record<string, unknown>
  /** Tagged PDF flags (/MarkInfo) that are set. */
  markInfo?: string[]
  lang?: string
}

/** Result of rewriting a document with pdf.js (decryption or repair). */
export interface RewrittenDocument {
  bytes: Uint8Array
  /** Index of an extra (helper) page appended at the end that must be removed, if any. */
  extraPageIndex?: number
  info?: RecoveredInfo
  catalog?: RecoveredCatalog
}

/** A text element rendered to a bitmap (fallback for glyphs the embedded fonts lack). */
export interface RasterizedText {
  png: Uint8Array
  /** Where to place the bitmap, in view space (may extend past the element box). */
  x: number
  y: number
  width: number
  height: number
}

/**
 * Environment-specific services. The browser build (`exportPdf.ts`) supplies canvas/fetch/pdf.js
 * based implementations; tests inject deterministic Node-friendly ones.
 */
export interface ExportDeps {
  /** Measures text exactly like the editor does (defaults to the shared canvas measurer). */
  measure?: TextMeasurer
  /** Raw TTF bytes of an element font. */
  loadFontBytes: (fontId: FontId, bold: boolean) => Promise<Uint8Array>
  /**
   * Renders a whole text element to PNG (fallback for characters missing from the fonts:
   * emoji, CJK, Arabic…). When absent, such elements are drawn with the vector path and the
   * missing glyphs are lost.
   */
  rasterizeText?: (el: TextElement, layout: TextBlockLayout) => Promise<RasterizedText | null>
  /**
   * Produces an unencrypted copy of an encrypted document (pdf.js). When absent, encrypted
   * input fails with ExportError('encrypted').
   */
  decrypt?: (bytes: Uint8Array) => Promise<RewrittenDocument>
  /** Produces a clean copy of a document pdf-lib can't parse (pdf.js). Optional. */
  repair?: (bytes: Uint8Array) => Promise<RewrittenDocument>
  /** Converts image bytes pdf-lib can't embed (WebP, GIF…) into PNG. Optional. */
  convertImage?: (bytes: Uint8Array, mime: string) => Promise<Uint8Array | null>
  onProgress?: (progress: ExportProgress) => void
  /** Told the names of form fields whose values could not be written (the export still succeeds). */
  onUnwrittenFields?: (names: string[]) => void
  /** Cancels the export between steps (rejects with ExportError('aborted')). */
  signal?: AbortSignal
  /** Lets the UI breathe between pages. Defaults to a macrotask yield. */
  yieldToUI?: () => Promise<void>
}
