import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLocale } from '../../i18n'
import { ExportError } from '../../lib/export/errors'
import { useEditor, type LoadedDocument } from '../../store/editor'

type Hooks = { signal?: AbortSignal; onProgress?: (p: unknown) => void; onUnwrittenFields?: (names: string[]) => void }

/** A controllable stand-in for the real exporter: each call returns a deferred result. */
const calls: { flatten: boolean; signal?: AbortSignal; hooks: Hooks; resolve: (b: Uint8Array) => void; reject: (e: unknown) => void }[] = []
let fontPreloads = 0
vi.mock('../../lib/export/exportPdf', async () => {
  const errors = await import('../../lib/export/errors')
  return {
    ExportError: errors.ExportError,
    preloadDefaultFont: () => {
      fontPreloads++
    },
    exportCurrentDocument: vi.fn(
      (options: { flattenForms: boolean }, hooks: Hooks) =>
        new Promise<Uint8Array>((resolve, reject) => {
          calls.push({ flatten: options.flattenForms, signal: hooks.signal, hooks, resolve, reject })
          hooks.onProgress?.({ phase: 'pages', done: 0, total: 3 })
          hooks.signal?.addEventListener('abort', () => reject(new errors.ExportError('aborted')))
        }),
    ),
  }
})

const { errorMessage, latestExport, preloadExportEngine, prepareExport, resetExport, useExportJob } = await import('./exportJob')

const fakeDoc = { id: 'doc-1', name: 'a.pdf', bytes: new Uint8Array(), pages: [], formFields: [] } as unknown as LoadedDocument

describe('export job', () => {
  beforeAll(async () => {
    await preloadExportEngine()
  })

  beforeEach(() => {
    resetExport()
    calls.length = 0
    useEditor.setState({ doc: fakeDoc, revision: 1 })
  })

  it('keeps the default text face in memory once the engine has loaded, for downloads made offline', async () => {
    await preloadExportEngine()
    expect(fontPreloads).toBe(1)
  })

  it('reuses the running export for the same document state and options', async () => {
    const a = prepareExport(true)
    const b = prepareExport(true)
    expect(a).toBe(b)
    expect(calls).toHaveLength(1)
    expect(useExportJob.getState()).toMatchObject({ status: 'working', progress: { phase: 'pages' } })
    calls[0].resolve(new Uint8Array(1234))
    await expect(a).resolves.toHaveLength(1234)
    expect(useExportJob.getState()).toMatchObject({ status: 'ready', size: 1234 })
    // Cached result: no new export.
    await prepareExport(true)
    expect(calls).toHaveLength(1)
  })

  it('starts over (and cancels the old run) when options or content change', async () => {
    const first = prepareExport(true)
    first.catch(() => {})
    prepareExport(false).catch(() => {})
    expect(calls).toHaveLength(2)
    expect(calls[0].signal?.aborted).toBe(true)
    useEditor.setState({ revision: 2 })
    prepareExport(false).catch(() => {})
    expect(calls).toHaveLength(3)
    await expect(first).rejects.toMatchObject({ code: 'aborted' })
  })

  it('lets an action wait for the newest export when its run is superseded', async () => {
    const pending = latestExport(true, () => true)
    useEditor.setState({ revision: 5 })
    prepareExport(true).catch(() => {})
    await Promise.resolve()
    calls[1].resolve(new Uint8Array(7))
    await expect(pending).resolves.toHaveLength(7)
  })

  it('surfaces failures as an error state and retries on the next request', async () => {
    const run = prepareExport(true)
    calls[0].reject(new ExportError('fonts'))
    await expect(run).rejects.toMatchObject({ code: 'fonts' })
    expect(useExportJob.getState()).toMatchObject({ status: 'error', error: expect.stringMatching(/fonts/i) })
    prepareExport(true).catch(() => {})
    expect(calls).toHaveLength(2)
  })

  it('remembers which field values the prepared file lacks', async () => {
    const run = prepareExport(false)
    calls[0].hooks.onUnwrittenFields?.(['applicant.last'])
    calls[0].resolve(new Uint8Array(3))
    await run
    expect(useExportJob.getState()).toMatchObject({ status: 'ready', unwritten: ['applicant.last'] })
    // The next export starts without them.
    useEditor.setState({ revision: 9 })
    prepareExport(false).catch(() => {})
    expect(useExportJob.getState()).toMatchObject({ status: 'working', unwritten: [] })
  })

  it('resets to idle when the dialog closes', () => {
    prepareExport(true).catch(() => {})
    resetExport()
    expect(calls[0].signal?.aborted).toBe(true)
    expect(useExportJob.getState().status).toBe('idle')
  })
})

describe('export failures in Hebrew', () => {
  afterEach(() => {
    setLocale('en')
    resetExport()
  })

  it('are told in the interface language', async () => {
    expect(errorMessage(new Error('share sheet broke'))).toBe('Something went wrong while creating the PDF. Please try again.')
    setLocale('he')
    expect(errorMessage(new Error('share sheet broke'))).toBe('משהו השתבש ביצירת קובץ ה-PDF. נסו שוב.')
    useEditor.setState({ doc: null })
    await expect(prepareExport(true)).rejects.toMatchObject({ code: 'unknown', message: 'פתחו קודם מסמך.' })
    useEditor.setState({ doc: fakeDoc, revision: 1 })
    const run = prepareExport(true)
    calls.at(-1)!.reject(new ExportError('fonts'))
    await expect(run).rejects.toMatchObject({ code: 'fonts' })
    expect(useExportJob.getState().error).toMatch(/^לא ניתן היה לטעון את הגופנים/)
  })
})
