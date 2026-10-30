import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExportError } from '../../lib/export/errors'
import { useEditor, type LoadedDocument } from '../../store/editor'

/** A controllable stand-in for the real exporter: each call returns a deferred result. */
const calls: { flatten: boolean; signal?: AbortSignal; resolve: (b: Uint8Array) => void; reject: (e: unknown) => void }[] = []
vi.mock('../../lib/export/exportPdf', async () => {
  const errors = await import('../../lib/export/errors')
  return {
    ExportError: errors.ExportError,
    exportCurrentDocument: vi.fn(
      (options: { flattenForms: boolean }, hooks: { signal?: AbortSignal; onProgress?: (p: unknown) => void }) =>
        new Promise<Uint8Array>((resolve, reject) => {
          calls.push({ flatten: options.flattenForms, signal: hooks.signal, resolve, reject })
          hooks.onProgress?.({ phase: 'pages', done: 0, total: 3 })
          hooks.signal?.addEventListener('abort', () => reject(new errors.ExportError('aborted')))
        }),
    ),
  }
})

const { latestExport, preloadExportEngine, prepareExport, resetExport, useExportJob } = await import('./exportJob')

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

  it('resets to idle when the dialog closes', () => {
    prepareExport(true).catch(() => {})
    resetExport()
    expect(calls[0].signal?.aborted).toBe(true)
    expect(useExportJob.getState().status).toBe('idle')
  })
})
