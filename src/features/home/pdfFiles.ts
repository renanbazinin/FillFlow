/** Pure helpers for recognizing and naming PDF files (no store / DOM access). */

export const PDF_ACCEPT = 'application/pdf,.pdf'

export const SAMPLE_FORM_NAME = 'Sample application form.pdf'

export function isPdfFile(file: Pick<File, 'name' | 'type'>): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name.trim())
}

/** The first PDF in a file list (drop / paste / picker), or null. */
export function firstPdf<T extends Pick<File, 'name' | 'type'>>(files: Iterable<T> | ArrayLike<T> | null | undefined): T | null {
  if (!files) return null
  for (const f of Array.from(files)) if (isPdfFile(f)) return f
  return null
}

/** "form.pdf" → "form" (display only; the real name is kept everywhere else). */
export function displayName(name: string): string {
  const base = name.replace(/\.pdf$/i, '').trim()
  return base || name
}
