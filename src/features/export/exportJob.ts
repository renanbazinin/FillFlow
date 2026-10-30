import { create } from 'zustand'
import { ExportError } from '../../lib/export/errors'
import type { ExportProgress } from '../../lib/export/types'
import { useEditor } from '../../store/editor'

type ExportEngine = typeof import('../../lib/export/exportPdf')

/**
 * The export engine (pdf-lib, fontkit, text shaping) is fetched on first use instead of being
 * part of the main bundle. Once loaded, exports start synchronously.
 */
let engine: ExportEngine | null = null
let engineLoad: Promise<ExportEngine> | null = null

export function preloadExportEngine(): Promise<ExportEngine> {
  engineLoad ??= import('../../lib/export/exportPdf').then(
    (m) => (engine = m),
    (err: unknown) => {
      engineLoad = null // a later attempt may succeed (e.g. after reconnecting)
      throw err
    },
  )
  return engineLoad
}

/**
 * The export dialog prepares the file as soon as it opens (and again when an option changes),
 * so Download/Share/Print are instant — Share in particular must run within the click's
 * short-lived user activation. Results are cached by document revision + options.
 */

export type ExportStatus = 'idle' | 'working' | 'ready' | 'error'

interface ExportJobState {
  status: ExportStatus
  progress: ExportProgress | null
  /** Size of the prepared file (bytes). */
  size: number | null
  error: string | null
}

const IDLE: ExportJobState = { status: 'idle', progress: null, size: null, error: null }

export const useExportJob = create<ExportJobState>(() => IDLE)

let current: { key: string; promise: Promise<Uint8Array>; ctrl: AbortController } | null = null

function jobKey(flatten: boolean): string | null {
  const { doc, revision } = useEditor.getState()
  return doc ? `${doc.id}:${revision}:${flatten ? 1 : 0}` : null
}

export function errorMessage(err: unknown): string {
  if (err instanceof ExportError) return err.message
  return 'Something went wrong while creating the PDF. Please try again.'
}

/** Starts (or reuses) the export for the current document state. */
export function prepareExport(flatten: boolean): Promise<Uint8Array> {
  const key = jobKey(flatten)
  if (!key) return Promise.reject(new ExportError('unknown', 'Open a document first.'))
  if (current?.key === key) return current.promise

  current?.ctrl.abort()
  const ctrl = new AbortController()
  const isCurrent = () => current?.ctrl === ctrl
  // Register before starting so progress reported synchronously isn't dropped.
  const job: { key: string; ctrl: AbortController; promise: Promise<Uint8Array> } = { key, ctrl, promise: Promise.resolve(new Uint8Array()) }
  current = job
  useExportJob.setState({ status: 'working', progress: null, size: null, error: null })
  const run = ({ exportCurrentDocument }: ExportEngine) =>
    exportCurrentDocument(
      { flattenForms: flatten },
      {
        signal: ctrl.signal,
        onProgress: (progress) => {
          if (isCurrent()) useExportJob.setState({ progress })
        },
      },
    )
  const promise = engine ? run(engine) : preloadExportEngine().then(run)
  job.promise = promise
  promise.then(
    (bytes) => {
      if (isCurrent()) useExportJob.setState({ status: 'ready', progress: null, size: bytes.length })
    },
    (err) => {
      if (!isCurrent()) return
      current = null // let the next attempt start over
      if (err instanceof ExportError && err.code === 'aborted') return
      console.error('[export] failed', err)
      useExportJob.setState({ status: 'error', progress: null, error: errorMessage(err) })
    },
  )
  return promise
}

/**
 * The export for the latest document state: when the job being awaited is superseded (the
 * content changed meanwhile), waits for the newer one instead of failing.
 */
export async function latestExport(flatten: boolean, stillWanted: () => boolean): Promise<Uint8Array> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prepareExport(flatten)
    } catch (err) {
      const superseded = err instanceof ExportError && err.code === 'aborted' && current !== null
      if (!superseded || attempt >= 3 || !stillWanted()) throw err
    }
  }
}

/** Drops any running or cached export (dialog closed / document changed). */
export function resetExport(): void {
  current?.ctrl.abort()
  current = null
  useExportJob.setState(IDLE)
}
