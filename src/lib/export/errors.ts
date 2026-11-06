import { getT } from '../../i18n'

export type ExportErrorCode = 'encrypted' | 'damaged' | 'fonts' | 'forms' | 'aborted' | 'unknown'

/**
 * An export failure with a user-facing message: by default its code's (src/i18n/<language>/export.ts),
 * in the interface language of the moment it failed.
 */
export class ExportError extends Error {
  readonly code: ExportErrorCode

  constructor(code: ExportErrorCode, message = getT().export.errors[code], options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ExportError'
    this.code = code
  }
}

/** Wraps any thrown value into an ExportError (keeps ExportErrors as they are). */
export function toExportError(err: unknown): ExportError {
  if (err instanceof ExportError) return err
  if (err instanceof DOMException && err.name === 'AbortError') return new ExportError('aborted', undefined, { cause: err })
  return new ExportError('unknown', undefined, { cause: err })
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ExportError('aborted')
}
