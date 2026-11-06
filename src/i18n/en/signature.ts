/**
 * Strings for signatures, initials and images: the signing dialog, its pads and the saved ones.
 * Messages that depend on what is being made come in pairs, by role (`signature` / `initials`):
 * English often says the same for both, other languages may not (gender, number).
 */
export const signature = {
  /** The signing dialog. */
  dialog: {
    title: { signature: 'Add your signature', initials: 'Add your initials' },
    description: 'Draw, type or upload it. It never leaves your device.',
    /** Heading over the saved ones, above the tabs. */
    useSaved: { signature: 'Use a saved signature', initials: 'Use your saved initials' },
    /** Between the saved ones and the tabs. */
    createNew: { signature: 'or create a new one', initials: 'or create a new one' },
    /** The tab list's accessible name. */
    tabsLabel: { signature: 'How to create your signature', initials: 'How to create your initials' },
    tabs: { draw: 'Draw', type: 'Type', upload: 'Upload' },
    /** The primary button: makes it and lets it be placed. */
    use: { signature: 'Use signature', initials: 'Use initials' },
    nothingToUse: {
      title: "There's nothing to use yet",
      description: { signature: 'Add your signature first.', initials: 'Add your initials first.' },
    },
    pasteFailed: { title: "Couldn't read the pasted image", description: 'Try saving it as a PNG or JPEG file first.' },
    saveFailed: { title: "Couldn't save it for next time", description: "This browser isn't allowing local storage." },
    failed: { title: 'Something went wrong', description: 'Please try again.' },
  },
  /** The ink color swatches (their names are the palette's, shell.ui.colors). */
  inkColor: 'Ink color',
  pen: {
    label: 'Pen width',
    fine: 'Fine pen',
    medium: 'Medium pen',
    bold: 'Bold pen',
  },
  saveForNextTime: 'Save for next time',
  /** The Draw tab. */
  draw: {
    /** Under the line on the empty pad. */
    hint: { signature: 'Sign above the line', initials: 'Initial above the line' },
    /** The pad's accessible name, with how many strokes are drawn on it. */
    area: {
      signature: (strokes: number) =>
        `Drawing area for your signature. Draw with a mouse, finger or stylus${strokes ? `; ${strokes} ${strokes === 1 ? 'stroke' : 'strokes'} so far` : ''}.`,
      initials: (strokes: number) =>
        `Drawing area for your initials. Draw with a mouse, finger or stylus${strokes ? `; ${strokes} ${strokes === 1 ? 'stroke' : 'strokes'} so far` : ''}.`,
    },
    undoStroke: 'Undo last stroke',
    undo: 'Undo',
    clearDrawing: 'Clear drawing',
    clear: 'Clear',
  },
  /** The Type tab. */
  type: {
    nameLabel: { signature: 'Your full name', initials: 'Your initials' },
    placeholder: { signature: 'e.g. Jane Cooper', initials: 'e.g. JC' },
    /** What the style cards show until something is typed. */
    sample: { signature: 'Your Name', initials: 'YN' },
    styles: 'Handwriting style',
  },
  /** The Upload tab. */
  upload: {
    notImage: { title: "That file isn't an image", description: 'Choose a PNG or JPEG picture of your signature.' },
    openFailed: { title: "Couldn't open this image", description: 'Try a PNG or JPEG file.' },
    opening: 'Opening image…',
    dropToUpload: 'Drop to upload',
    drop: { signature: 'Drop an image of your signature', initials: 'Drop an image of your initials' },
    /** {link} is `chooseFile`, drawn as a link. */
    orChoose: 'or {link}',
    chooseFile: 'choose a file',
    /** Follows `orChoose` where there's a keyboard; {keys} is the paste shortcut (Ctrl+V, ⌘+V). */
    orPaste: ' · or paste with {keys}',
    tip: 'Sign on plain white paper and take the photo in good light. The background is removed automatically.',
    /** The preview's accessible name when background removal left nothing. */
    previewEmpty: 'Preview: nothing left after removing the background',
    preview: { signature: 'Preview of the uploaded signature', initials: 'Preview of the uploaded initials' },
    nothingLeft: 'Nothing left to keep. Lower the sensitivity or turn background removal off.',
    dropToReplace: 'Drop to replace',
    replace: 'Replace',
    remove: 'Remove image',
    removeBackground: 'Remove background',
    removeBackgroundHint: 'Makes the paper transparent so only the ink is placed.',
    sensitivity: 'Sensitivity',
    /** The sensitivity slider's accessible name. */
    sensitivityLabel: 'Background removal sensitivity',
    /** Back to the sensitivity worked out for the picture. */
    auto: 'Auto',
  },
  /** The saved ones: the dock button's list and the tiles (also in the dialog). */
  saved: {
    /** The list's accessible name. */
    label: { signature: 'Saved signatures', initials: 'Saved initials' },
    title: { signature: 'Your signatures', initials: 'Your initials' },
    pick: 'Pick one to place it',
    empty: {
      signature: 'Nothing saved yet. Create one and tick “Save for next time”.',
      initials: 'Nothing saved yet. Create one and tick “Save for next time”.',
    },
    new: { signature: 'New signature', initials: 'New initials' },
    /** Read out when the list changes. */
    count: {
      signature: (n: number) => `${n} saved signature`,
      initials: (n: number) => `${n} saved initials`,
    },
    /** A tile, and its × button; `date` is the day it was saved ("Mar 5, 2026"). */
    place: {
      signature: (date: string) => `Place signature saved ${date}`,
      initials: (date: string) => `Place initials saved ${date}`,
    },
    remove: {
      signature: (date: string) => `Delete signature saved ${date}`,
      initials: (date: string) => `Delete initials saved ${date}`,
    },
    confirmDelete: {
      title: { signature: 'Delete this signature?', initials: 'Delete these initials?' },
      description: {
        signature: 'It will be removed from this device. Documents you already signed are not affected.',
        initials: 'It will be removed from this device. Documents you already signed are not affected.',
      },
      confirm: 'Delete',
    },
    deleteFailed: { title: "Couldn't delete it", description: 'Please try again.' },
  },
  /** While a signature, initials or picture waits to be placed on a page. */
  place: {
    hint: 'Click where you want to place it, or press Enter',
    touchHint: 'Tap where you want to place it',
  },
  /** The image tool. */
  image: {
    preparing: 'Preparing image…',
    openFailed: { title: "This image couldn't be opened", description: 'Try a PNG, JPEG, WebP or GIF file.' },
    /** Its shortcut couldn't open the file picker; `tool` is the image tool's name. */
    blocked: {
      title: (tool: string) => `Choose a picture with the ${tool} button`,
      description: 'Your browser blocked opening the file picker from the shortcut.',
    },
  },
}

export type SignatureMessages = typeof signature
