import { bidiIsolate } from '../../lib/utils/misc'
import { common } from './common'

/** Strings for the home page, opening files and the loading card. */
export const home = {
  dropzone: {
    title: 'Drop a PDF here',
    /** The title while a file is dragged over the window. */
    titleDragging: 'Drop to open your PDF',
    /** The title on a touch screen, where nothing is dragged. */
    titleTouch: 'Open a PDF to fill',
    /** (\u00a0: a no-break space, so the dash never starts a line.) */
    hint: 'Forms, contracts, applications\u00a0— any PDF works.',
    choose: 'Choose PDF',
    /** {keys} is the paste shortcut's key caps (Ctrl V). */
    paste: 'or paste one with {keys}',
    private: 'Stays on your device — nothing is uploaded',
    sample: 'or try a sample form',
  },
  features: {
    /** The feature tiles' heading (screen readers only). */
    heading: 'Why FillFlow',
    fill: {
      title: 'Fill any form',
      body: 'Fillable fields are detected automatically — or click anywhere on the page to type.',
    },
    sign: {
      title: 'Sign in seconds',
      body: 'Draw, type or upload your signature. It’s saved for next time.',
    },
    private: {
      title: 'Private by design',
      body: 'Everything happens on your device. Your files are never uploaded.',
    },
    resume: {
      title: 'Pick up where you left off',
      body: 'Your progress is auto-saved in this browser as you work.',
    },
  },
  /** What shows while files are dragged over the window. */
  dropOverlay: {
    title: 'Drop your PDF to open it',
    /** In the editor; {name} is the open document's name. */
    workSaved: 'Your work on {name} is saved on this device.',
    saveFailed: 'Your latest changes to {name} couldn’t be saved on this device.',
    notPdf: 'Only PDF files can be opened',
  },
  recent: {
    title: 'Recent documents',
    subtitle: 'Saved in this browser only.',
    /** After a card's page count ("3 pages · edited 2h ago"); `when` is one of the `time` messages. */
    edited: (when: string) => `edited ${when}`,
    opened: (when: string) => `opened ${when}`,
    /** After a card's page count, when its file isn't stored ("2 pages · file not stored"). */
    fileNotStored: 'file not stored',
    fileNotStoredHint: 'Its file isn’t stored on this device. Open the same file again to continue.',
    /** On a card's thumbnail: placed items and changed form fields. */
    filled: (n: number) => `${n} filled`,
    /** The card's accessible names (the name is the document's). */
    openNamed: (name: string) => `Open ${name}`,
    moreFor: (name: string) => `More options for ${name}`,
    open: 'Open',
    remove: {
      menu: 'Remove from this device',
      /** {name} is the document's. */
      title: 'Remove “{name}”?',
      body: 'The file and the work you’ve done on it will be deleted from this device. This can’t be undone.',
      confirm: 'Remove',
      done: 'Removed from this device',
      failed: 'Couldn’t remove the document',
    },
    clear: {
      button: 'Clear all',
      title: 'Clear all recent documents?',
      body: (n: number) =>
        `${common.documents(n)} and the work you’ve done on ${n === 1 ? 'it' : 'them'} will be deleted from this device. This can’t be undone.`,
      confirm: 'Clear all',
      done: 'Recent documents cleared',
      failed: 'Some documents couldn’t be removed',
    },
    /** Work still saved for documents that dropped off the list. */
    olderWork: {
      notice: 'Your work on documents no longer listed is still saved on this device. Open the same file again to continue.',
      /** The button after the notice. */
      delete: 'Delete it',
      title: 'Delete your work on documents no longer listed?',
      body: 'What you filled in, typed or signed on them will be deleted from this device. This can’t be undone.',
      confirm: 'Delete',
      done: 'Work deleted from this device',
      failed: 'Couldn’t delete the work',
    },
  },
  /** When a recent document was edited or opened, as it follows "edited" / "opened". */
  time: {
    justNow: 'just now',
    minutesAgo: (n: number) => `${n}m ago`,
    hoursAgo: (n: number) => `${n}h ago`,
    /**
     * `days`: whole days since, rounded; `calendarDays`: midnights passed since (1: yesterday, 2: the
     * day before), for languages that name those days.
     */
    daysAgo: (days: number, _calendarDays?: number) => `${days}d ago`,
    /** A week or more back: the date, with the year when it isn't this year's ("Mar 4", "Mar 4, 2024"). */
    date: (date: Date, withYear: boolean) =>
      date.toLocaleDateString('en', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) }),
  },
  /** Messages about opening a file (the names are the files'). */
  open: {
    notPdf: (name: string) => `“${bidiIsolate(name)}” isn’t a PDF`,
    /** Several files dropped or pasted, none of them a PDF. */
    noPdfs: 'None of those files is a PDF',
    pdfOnly: 'FillFlow opens PDF files only.',
    /** Images dropped or pasted in the editor. */
    useImageTool: 'To add a picture to the page, use the Image tool.',
    /** Another document has opened in place of this one. */
    workSaved: (name: string) => `Your work on “${bidiIsolate(name)}” is saved`,
    reopen: 'Reopen it any time from the home screen.',
    sampleFailed: 'Couldn’t load the sample form',
    checkConnection: 'Check your connection and try again.',
  },
  /** The card that shows while a document opens. */
  loading: {
    title: 'Opening…',
  },
  password: {
    /** (\u2011: a no-break hyphen.) */
    title: 'This PDF is password\u2011protected',
    /** {name} is the file's. */
    body: 'Enter the password to open {name}.',
    /** The field's label and placeholder. */
    label: 'Password',
    show: 'Show password',
    hide: 'Hide password',
    incorrect: 'That password isn’t right. Please try again.',
    open: 'Open',
  },
  /** The dialog for an open that failed, and why it failed. */
  openError: {
    title: 'Couldn’t open this file',
    /** FillFlow itself couldn't download what opening files needs (offline…): not the file's fault. */
    unavailableTitle: 'FillFlow couldn’t finish loading',
    tryAgain: 'Try again',
    /** A recent document whose file is gone: the same file, opened again, brings back its work. */
    chooseFile: 'Choose file',
    tryAnother: 'Try another file',
    offline:
      'You’re offline, and FillFlow needs to finish downloading before it can open files. Reconnect and try again.',
    notDownloaded: 'FillFlow needs to finish downloading before it can open files. Check your connection and try again.',
    downloadFailed: 'FillFlow couldn’t download what it needs to open files. Reload the page and try again.',
    invalid: 'This PDF is damaged or not a valid PDF file.',
    unreadable: 'This PDF couldn’t be read. It may be damaged, or use features FillFlow doesn’t support.',
    notPdf: 'This file doesn’t look like a PDF.',
    readFailed: 'Could not read the file.',
    storageReadFailed: 'Couldn’t read this document from this device’s storage.',
    /** A recent document whose file is no longer stored. */
    missingWithWork:
      'It isn’t stored on this device, but your work on it is. Choose the same file to pick up where you left off.',
    missing: 'It isn’t stored on this device. Choose it again to open it.',
  },
}

export type HomeMessages = typeof home
