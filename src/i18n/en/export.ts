import { bidiIsolate } from '../../lib/utils/misc'

/** Letters of the right-to-left scripts (and their presentation forms). */
const RTL_TEXT = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/

const count = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`

/** Strings for the download dialog and creating the PDF. */
export const exportDialog = {
  title: 'Download PDF',
  description: 'Your filled copy is created right here on your device — the file never leaves it.',
  fileName: 'File name',
  /** Ends the name the download gets by default: "lease.pdf" → "lease-filled.pdf". */
  nameSuffix: 'filled',
  /** The card about the file: what's in it, then how it's coming along. */
  summary: {
    pages: (n: number) => count(n, 'page', 'pages'),
    /** Items placed on the pages. */
    placed: (n: number) => `${count(n, 'item', 'items')} placed`,
    /** Form fields that will carry a value. */
    filled: (n: number) => `${count(n, 'field', 'fields')} filled`,
    ready: 'Ready',
    /** `size` is formatted by `size` below ("1.2 MB"). */
    readySize: (size: string) => `Ready · ${size}`,
  },
  progress: {
    preparing: 'Preparing your PDF…',
    forms: 'Filling in form fields…',
    pages: 'Adding your changes…',
    page: (page: number, total: number) => `Adding your changes… page ${page} of ${total}`,
    saving: 'Saving…',
  },
  /** A file size: bytes and kilobytes are whole numbers, megabytes come rounded ("3.3"). */
  size: {
    bytes: (n: number) => `${n} B`,
    kb: (n: number) => `${n} KB`,
    mb: (n: string) => `${n} MB`,
  },
  flatten: 'Flatten form fields',
  flattenHint: 'Recommended when sending — values can no longer be edited',
  /**
   * Form fields named in a sentence: “A”, “A” and “B”, “A”, “B” and “C”; past `max`, “A”, “B”, “C”
   * and 2 more. Right-to-left names are isolated, so two Hebrew names in a row keep their order and
   * quotes.
   */
  list: (names: string[], max: number) => {
    const quoted = names.map((s) => `“${RTL_TEXT.test(s) ? bidiIsolate(s) : s}”`)
    if (quoted.length <= max) return quoted.length > 1 ? `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}` : (quoted[0] ?? '')
    return `${quoted.slice(0, max).join(', ')} and ${quoted.length - max} more`
  },
  /** With flattening off, the fields under items placed on them are flattened anyway; `list` is `list` above. */
  covered: (list: string, fields: number) =>
    `${list} will still be flattened so what you placed on ${fields === 1 ? 'it' : 'them'} stays visible.`,
  nothingAdded: {
    flattened: 'You haven’t added anything yet. The form fields will be flattened, so they can no longer be filled in.',
    unchanged: 'You haven’t added anything yet, so the download will match the original file.',
  },
  passwordDropped: 'The downloaded copy won’t be password-protected: anyone who has the file can open it.',
  /** Fields whose values the PDF couldn't take; `list` is `list` above. */
  unwritten: {
    title: (fields: number): string => (fields === 1 ? 'A field couldn’t be filled in' : 'Some fields couldn’t be filled in'),
    body: (list: string, _fields: number) => `The PDF won’t include what you entered in ${list}.`,
  },
  /** Over the error message. */
  failed: 'Couldn’t create the PDF',
  /** Sharing took too long to start from the press: the file is ready now. */
  shareAgain: 'Your PDF is ready — tap Share again to send it.',
  actions: {
    print: 'Print',
    share: 'Share…',
    preparing: 'Preparing…',
    download: 'Download PDF',
  },
  delivered: {
    /** Its description is the file's name. */
    downloaded: 'PDF downloaded',
    printTab: { title: 'Opened in a new tab', description: 'Print it from your browser’s PDF viewer.' },
    printDownloaded: {
      title: 'PDF downloaded instead',
      description: 'This browser can’t print PDFs directly — print it from your files.',
    },
  },
  /** The hidden frame a PDF is printed from. */
  printFrame: 'Print preview',
  /** Why creating the PDF failed (by ExportError code, and two more of its own). */
  errors: {
    encrypted:
      'This PDF is encrypted, so FillFlow can’t save a copy with your changes. Remove the protection first (for example, print it to a new PDF), then open that copy.',
    damaged: 'This PDF is damaged in a way FillFlow can’t repair, so a filled copy couldn’t be created.',
    fonts: 'The fonts needed for your text couldn’t be loaded. Check your connection and try again.',
    forms: 'The form field values couldn’t be written into the PDF.',
    aborted: 'Export cancelled.',
    unknown: 'Something went wrong while creating the PDF.',
    /** The PDF needs a password the export doesn't have. */
    passwordProtected: 'This PDF is password-protected. Open it in FillFlow with its password, then export again.',
    noDocument: 'Open a document first.',
    /** Anything else (sharing failed, an unexpected error). */
    generic: 'Something went wrong while creating the PDF. Please try again.',
  },
}

export type ExportMessages = typeof exportDialog
