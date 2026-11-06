/** Strings for placed items: the items panel, the selection toolbar and menu, item names, text editing. */
export const elements = {
  /**
   * What each kind of item is called: in the Items panel, and as the accessible name of an item on
   * the page. `text` quotes what a text item says (people's own words, shortened).
   */
  names: {
    text: (excerpt: string) => `“${excerpt}”`,
    emptyText: 'Empty text',
    check: 'Checkmark',
    cross: 'Cross',
    dot: 'Dot',
    signature: 'Signature',
    initials: 'Initials',
    image: 'Image',
    highlight: 'Highlight',
    whiteout: 'Whiteout',
    rect: 'Rectangle',
    ellipse: 'Ellipse',
    line: 'Line',
    /** Freehand pen strokes. */
    ink: 'Drawing',
  },
  /** The fonts of text items, named by how they look (a font's real family name would stay as it is). */
  fonts: {
    sans: 'Sans',
    serif: 'Serif',
    mono: 'Mono',
  },
  /** A size in points ("12.5 pt"): a font size, letter spacing. */
  points: (n: number) => `${n} pt`,
  /** What can be done to the selection: its toolbar and the toolbar's ⋯ menu, the right-click menu, the Items panel. */
  actions: {
    editText: 'Edit text',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    duplicate: 'Duplicate',
    bringToFront: 'Bring to front',
    sendToBack: 'Send to back',
    lock: 'Lock',
    unlock: 'Unlock',
    delete: 'Delete',
    /** The Items panel's delete button on a locked item. */
    unlockToDelete: 'Unlock to delete',
    /** The toolbar's delete button while everything selected is locked. */
    lockedCantDelete: 'Locked items can’t be deleted',
    /** The toolbar's ⋯ button: its tooltip (`more`) and its accessible name (`moreActions`). */
    more: 'More',
    moreActions: 'More actions',
  },
  /** The selection toolbar's style controls and their popovers. */
  toolbar: {
    /** The toolbar's accessible name for one item (several are counted instead: common.items). */
    label: 'Item options',
    font: 'Font',
    /** The font menu's button (on phones), by the font the text is in. */
    fontButton: (font: string) => `Font: ${font}`,
    /** A font's option in the font picker. */
    fontOption: (font: string) => `${font} font`,
    fontSize: 'Font size',
    bold: 'Bold',
    textColor: 'Text color',
    /** Where text sits on the page: left stays left in every language. */
    textAlignment: 'Text alignment',
    alignLeft: 'Align left',
    alignCenter: 'Align center',
    alignRight: 'Align right',
    /** The popover with the alignment (on phones), letter spacing and line height: its button and its title. */
    spacing: 'Alignment and spacing',
    /** The same button's tooltip. */
    spacingTip: 'Alignment & spacing',
    alignment: 'Alignment',
    letterSpacing: 'Letter spacing',
    lineHeight: 'Line height',
    /** A mark is a ✓, ✗ or •. */
    markShape: 'Mark shape',
    markColor: 'Color',
    markSize: 'Size',
    lineColor: 'Line color',
    lineWidth: 'Line width',
    border: 'Border',
    borderWidth: 'Border width',
    fill: 'Fill',
    penColor: 'Pen color',
    penWidth: 'Pen width',
    opacity: 'Opacity',
    /** The opacity button's accessible name, with the value it shows. */
    opacityValue: (percent: number) => `Opacity ${percent}%`,
    /** A size field's tooltip while every item it applies to is locked; `what` is its label ("Font size"). */
    unlockToChange: (what: string) => `Unlock to change the ${what.toLowerCase()}`,
  },
  /** The Items panel (the right panel's Items tab). */
  panel: {
    /** A page's heading in the list, and its group's accessible name. */
    page: (n: number) => `Page ${n}`,
    locked: 'Locked',
    /** A text item's row, on hover. */
    rowHint: 'Click to select · double-click to edit',
    clearAll: 'Clear all items',
    clearTitle: 'Clear all items?',
    /** `removable` items go; `locked` ones stay. */
    clearBody: (removable: number, locked: number) =>
      `This removes ${removable === 1 ? 'the item' : `all ${removable} items`} you added to this document.` +
      (locked ? ` ${locked === 1 ? 'One locked item stays' : `${locked} locked items stay`}.` : '') +
      ' You can undo this.',
    clearConfirm: 'Clear all',
    /** Before anything is placed: what the panel is for, and a quick start with some of the tools. */
    empty: {
      title: 'No items yet',
      body: 'Text, checkmarks, signatures and drawings you add to the document will be listed here.',
      /** Under the tool's name, by tool. */
      quick: {
        text: 'Type anywhere on the page',
        check: 'Tick boxes with a checkmark',
        signature: 'Draw, type or upload it',
        ink: 'Freehand pen',
      },
      /** {enter} is the Enter key cap; "Draw" is the pen tool (tools.ink.label). */
      keyboard: 'From the keyboard: pick any tool but Draw, press {enter} to add one in the middle of the page, then move it with the arrow keys.',
    },
  },
  /** Typing into a text item on the page. */
  textEditor: {
    /** The text box's accessible name. */
    label: 'Edit text',
    /** Under a text too big for its page (shown on the page, in the interface's language). */
    pastEdge: 'Text past the page edge won’t be in the download',
  },
  /** Messages after something was tried. */
  toasts: {
    /** Deleting `n` items that are all locked. */
    lockedTitle: (n: number): string => (n === 1 ? 'This item is locked' : 'These items are locked'),
    lockedBody: (n: number): string => (n === 1 ? 'Unlock it to delete it.' : 'Unlock them to delete them.'),
    pastedTooLong: 'The pasted text doesn’t fit on the page',
    pastedTooLongBody: 'Text past the bottom of the page won’t be in the download.',
    /** Pasting items copied in another tab (or before a reload): they live in that tab's memory only. */
    copyAgain: 'Copy the items again to paste them here',
    copyAgainBody: 'Copied items can only be pasted in the same tab, before it’s reloaded.',
  },
  /**
   * The size shown under an item on the page while it's resized: a measurement, read left to right
   * in every language. Whole points; a line's `angle` in whole degrees.
   */
  readout: {
    box: (width: number, height: number) => `${width.toFixed(0)} × ${height.toFixed(0)} pt`,
    line: (length: number, angle: number) => `${length.toFixed(0)} pt · ${angle.toFixed(0)}°`,
  },
}

export type ElementsMessages = typeof elements
