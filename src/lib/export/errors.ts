export type ExportErrorCode = 'encrypted' | 'damaged' | 'fonts' | 'forms' | 'aborted' | 'unknown'

const MESSAGES: Record<ExportErrorCode, string> = {
  encrypted:
    'This PDF is encrypted, so FillFlow can’t save a copy with your changes. Remove the protection first (for example, print it to a new PDF), then open that copy.',
  damaged: 'This PDF is damaged in a way FillFlow can’t repair, so a filled copy couldn’t be created.',
  fonts: 'The fonts needed for your text couldn’t be loaded. Check your connection and try again.',
  forms: 'The form field values couldn’t be written into the PDF.',
  aborted: 'Export cancelled.',
  unknown: 'Something went wrong while creating the PDF.',
}

/** An export failure with a user-facing message. */
export class ExportError extends Error {
  readonly code: ExportErrorCode

  constructor(code: ExportErrorCode, message = MESSAGES[code], options?: { cause?: unknown }) {
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
