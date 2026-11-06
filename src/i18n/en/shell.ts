/**
 * The app's frame: page title, crash screen, language and theme, the UI kit's own words, the
 * editor's top bar and ⋯ menu, and the home page's header, hero and footer.
 */
export const shell = {
  /** The browser tab's title on the home page (the editor shows the document's name). */
  title: 'FillFlow — Fill & sign PDFs in your browser',
  /** <meta name="description">. */
  description:
    'Fill out PDF forms, add text, checkmarks and signatures right in your browser. Free, private — your files never leave your device.',
  /** Accessible names of the passing messages, and of the stack of those that stay until acted on. */
  notifications: 'Notifications',
  alerts: 'Alerts',
  crash: {
    title: 'Something went wrong',
    body: 'FillFlow ran into an unexpected problem. Reload the page to continue — work saved on this device is kept.',
    reload: 'Reload',
  },
  language: {
    /** Menu heading and the switch's tooltip. */
    label: 'Language',
  },
  theme: {
    label: 'Theme',
    light: 'Light',
    dark: 'Dark',
    system: 'System',
    /** The theme switch's buttons, by option. */
    lightName: 'Light theme',
    darkName: 'Dark theme',
    systemName: 'System theme',
  },
  ui: {
    /** A dialog's description when it has none of its own (screen readers only). */
    dialog: 'Dialog',
    decrease: (what: string) => `Decrease ${what.toLowerCase()}`,
    increase: (what: string) => `Increase ${what.toLowerCase()}`,
    color: 'Color',
    noColor: 'No color',
    customColor: 'Custom color',
    colors: {
      black: 'Black',
      blue: 'Blue',
      red: 'Red',
      green: 'Green',
      purple: 'Purple',
      white: 'White',
      yellow: 'Yellow',
    },
  },
  topBar: {
    backHome: 'Back to home',
    download: 'Download',
    undo: 'Undo',
    redo: 'Redo',
    pages: 'Pages',
    formAndItems: 'Form & items',
    items: 'Items',
    more: 'More',
  },
  menu: {
    openAnother: 'Open another PDF…',
    pages: 'Pages',
    formAndItems: 'Form & items',
    items: 'Items',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fitWidth: 'Fit to width',
    shortcuts: 'Keyboard shortcuts',
    closeDocument: 'Close document',
    clearEverything: 'Clear everything…',
    clearTitle: 'Clear everything you added?',
    clearBody: (locked: number) =>
      'This removes all items from every page and resets the form fields to how they were.' +
      (locked ? ` ${locked === 1 ? 'One locked item stays' : `${locked} locked items stay`}.` : '') +
      ' You can undo this.',
    clearConfirm: 'Clear all',
  },
  home: {
    homeLink: 'FillFlow home',
    nav: 'Site',
    github: 'FillFlow on GitHub',
    badge: 'Free & open source',
    titleStart: 'Fill & sign any PDF,',
    titleEnd: 'right in your browser.',
    lead: 'Type on any form, tick boxes, add your signature and download. Free, no sign-up — your files never leave your device.',
    openSource: 'Open source on GitHub',
    noAccounts: 'No accounts',
    noTracking: 'No tracking',
    /** {pdfjs} and {pdflib} are links. */
    builtWith: 'Built with {pdfjs} and {pdflib}',
  },
}

export type ShellMessages = typeof shell
