import { bidiIsolate } from '../../lib/utils/misc'

/** Strings for the editor's frame: tool dock, hints, shortcuts, side panels, document title, viewer chrome, saving. */
export const editor = {
  /** The browser tab's title while a document is open ("Lease agreement — FillFlow"). */
  tabTitle: (name: string) => `${name} — FillFlow`,

  dock: {
    /** The tool dock's accessible name. */
    label: 'Tools',
    /** The dock button that offers the shapes, and the heading of its list. */
    shapes: 'Shapes',
    /** The Shapes button's line of help, after its name in the tooltip. */
    shapesHint: 'Rectangle, ellipse or line',
    /** The Date tool's list of formats (its heading and accessible name). */
    dateFormat: 'Date format',
  },

  /** The chip above the dock that says what the active tool does. */
  hint: {
    /** A signature, initials or image is ready to be put on a page. */
    place: {
      signature: 'Click to place your signature',
      initials: 'Click to place your initials',
      image: 'Click to place the image',
    },
    /** The same on a touch screen. */
    placeTouch: {
      signature: 'Tap to place your signature',
      initials: 'Tap to place your initials',
      image: 'Tap to place the image',
    },
    /** What a key does, after its key cap ("Enter to add · Esc to finish"). */
    keys: {
      add: 'to add',
      place: 'to place',
      cancel: 'to cancel',
      finish: 'to finish',
    },
    /** A tool kept on (double-clicked) stays on after each use. */
    staysOn: 'Stays on',
  },

  /** The message as a document with a form first opens. */
  formHint: {
    /** `touch`: on a touch screen. */
    found: (count: number, touch: boolean) =>
      `${count} fillable field${count === 1 ? '' : 's'} found — ${touch ? 'tap' : 'click'} a field to type`,
    show: 'Show form',
    xfa: 'This dynamic XFA form can’t be filled in a browser',
    xfaBody: 'You can still type, check and sign on top of the pages.',
    details: 'Details',
  },

  shortcuts: {
    title: 'Keyboard shortcuts',
    /** {key} is the ? key cap. */
    intro: 'Press {key} any time to see these again.',
    /** The scrolling list's accessible name. */
    list: 'Shortcut list',
    /** Between two combinations that do the same. */
    or: 'or',
    groups: {
      tools: 'Tools',
      editing: 'Editing',
      view: 'View',
      file: 'File',
    },
    /** What the pointer does in a combination, next to its key caps ("Shift + click"). */
    pointer: {
      click: 'click',
      'double-click': 'double-click',
      'right-click': 'right-click',
      drag: 'drag',
      scroll: 'scroll',
      pinch: 'pinch',
    },
    rows: {
      undo: 'Undo',
      redo: 'Redo',
      copy: 'Copy',
      cut: 'Cut',
      paste: 'Paste',
      duplicate: 'Duplicate',
      delete: 'Delete',
      selectAll: 'Select all on the page',
      addToSelection: 'Add to selection',
      /** Enter puts the active tool's item in the middle of the view. */
      addInView: 'Add the active tool’s item in the middle of the view',
      /** The arrow keys move the selection a little (10 pt with Shift). */
      nudge: 'Nudge (Shift for 10 pt)',
      editText: 'Edit text',
      finishText: 'Finish editing text',
      bold: 'Bold text',
      toFront: 'Bring to front',
      toBack: 'Send to back',
      lock: 'Lock / unlock',
      deselect: 'Done / deselect',
      /** Double-clicking a tool keeps it on after each use. */
      keepTool: 'Keep a tool on',
      itemMenu: 'Item menu',
      /** Shift while dragging: resizing keeps the proportions, lines snap to 45°. */
      proportions: 'Keep proportions, 45° lines',
      noSnap: 'Move without snapping',
      cancelDrag: 'Cancel a drag',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      fitWidth: 'Fit to width',
      zoom: 'Zoom',
      pan: 'Pan',
      download: 'Download PDF',
      open: 'Open another PDF',
      shortcuts: 'Keyboard shortcuts',
    },
  },

  /** The side panels: pages at the start, the form and items at the end. */
  panels: {
    pages: 'Pages',
    /** The pages panel's close button: docked beside the pages, or as a sheet over them. */
    hidePages: 'Hide pages',
    closePages: 'Close pages',
    hidePanel: 'Hide panel',
    closePanel: 'Close panel',
    /** The form and items panel's tab list. */
    tabs: 'Panel',
    form: 'Form',
    items: 'Items',
    formAndItems: 'Form and items',
  },

  viewer: {
    /** The scrolling area that holds the pages. */
    label: 'Document pages',
    /** A page's accessible name. */
    page: (n: number, count: number) => `Page ${n} of ${count}`,
    renderError: 'This page couldn’t be displayed.',
  },

  zoom: {
    label: 'Zoom',
    in: 'Zoom in',
    out: 'Zoom out',
    /** The zoom menu's button: the zoom level, and how it fits the pages when it does. */
    level: (percent: number, fit: 'width' | 'page' | null) => `Zoom level ${percent}%${fit ? `, fit ${fit}` : ''}`,
    fitWidth: 'Fit width',
    fitPage: 'Fit page',
  },

  thumbnails: {
    label: 'Pages',
    /** A page in the pages panel; `edits` counts its items and changed form fields. */
    page: (n: number, count: number, edits: number) =>
      `Page ${n} of ${count}${edits ? `, ${edits} ${edits === 1 ? 'edit' : 'edits'}` : ''}`,
  },

  /** Saving on this device: the status in the top bar, and what is said when saving fails. */
  save: {
    saving: 'Saving…',
    saved: 'Saved on this device',
    /** The same, on a phone. */
    savedShort: 'Saved',
    notSaved: 'Not saved',
    /** The "Not saved" tooltip: why (a sentence), then what to do. */
    notSavedTip: (reason: string) => `${reason} Download your PDF to keep them.`,
    /** Why, when nothing more is known. */
    refused: 'Your browser refused to store your changes.',
    failed: "Couldn't save your progress on this device",
    unavailable: 'Your progress can’t be saved on this device',
    /** After why the changes can't be saved (a sentence). */
    downloadToKeep: (reason: string) => `${reason} Download your PDF to keep your changes.`,
    fileNotStored: 'This PDF couldn’t be stored on this device',
    /** After why the file couldn't be stored (a sentence). */
    fileNotStoredBody: (reason: string) =>
      `${reason} Keep your copy of the file: you’ll need to open it again to continue your work.`,
    gotIt: 'Got it',
    /**
     * Why this tab's copy of the document is no longer saved: newer work is stored (from another
     * tab, or work that didn't load here), or none any more. Also the "Not saved" reason, with a period.
     */
    outdated: {
      changedElsewhere: 'This document was changed in another tab',
      notLoaded: 'Your saved work on this document didn’t load',
      removed: 'This document was removed from this device',
    },
    outdatedBody: 'Reload it to get the latest saved version. Changes made here aren’t being saved.',
    removedBody: 'Changes made here aren’t being saved unless you keep it.',
    notLoadedBody: 'Reload it to try again before you make changes.',
    reload: 'Reload',
    /** Stores the removed document on this device again. */
    keep: 'Keep it',
    /** A document that is no longer open lost its last changes (`name`: its file name). */
    lost: (name: string) => `Your latest changes to “${bidiIsolate(name)}” couldn’t be saved`,
    /** Why, under `lost`, when that copy was out of date. */
    lostBecause: {
      changedElsewhere: 'It was changed in another tab.',
      notLoaded: 'Its saved work didn’t load.',
      removed: 'It was removed from this device.',
    },
  },

  /** Why storage failed (a sentence; what to do follows it). */
  storage: {
    blocked: 'This browser is blocking storage for this site.',
    full: 'Storage on this device is full.',
    window: 'Storage is unavailable in this browser window.',
    content: 'This content could not be stored.',
    other: 'Storage on this device reported an error.',
  },

  /** Leaving or reloading a document whose latest changes couldn't be saved. */
  unsaved: {
    body: 'They couldn’t be saved on this device. Download your PDF first if you want to keep them.',
    leaveTitle: 'Leave without your latest changes?',
    leave: 'Leave anyway',
    stay: 'Stay',
    reloadTitle: 'Reload without your latest changes?',
    reload: 'Reload anyway',
  },
}

export type EditorMessages = typeof editor
