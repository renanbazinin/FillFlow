# FillFlow

Fill & sign any PDF right in your browser — free, no sign-up, and private: your files never leave your device.

**Live site:** [renanbazinin.github.io/FillFlow](https://renanbazinin.github.io/FillFlow)

## Features

- **Fillable forms, detected automatically.** Text fields, checkboxes, radio groups, dropdowns, list boxes and comb fields are filled right on the page, or from a side panel with progress and "next empty field" navigation. Values are written back into the PDF's real form fields (optionally flattened).
- **Fill anything else, too.** Click to type anywhere, tick ✓ / ✗ / •, insert today's date, highlight, white-out, draw boxes, ellipses, lines or freehand ink.
- **Sign in seconds.** Draw (pressure-sensitive), type (five handwriting styles) or upload a signature or initials. Saved signatures are one click away next time, and clicking a form's signature field signs it in place.
- **Real editing.** Select, multi-select, drag (even across pages), resize, smart alignment guides, duplicate, copy/paste, lock, undo/redo, keyboard shortcuts, and a context toolbar for fonts, sizes, colors, alignment and spacing.
- **What you see is what you download.** On-screen text uses the same font files and the same layout code as the export, so positions match exactly — including rotated pages, cropped pages and Hebrew/RTL text.
- **Download, share or print.** Name the file, optionally flatten the form, then download it, send it through the system share sheet (where the browser supports it) or print it. The dialog warns you before anything would be lost: fields whose values can't be written, or a copy that won't keep the original's password.
- **Handles awkward files.** Password-protected PDFs open after you enter the password, slightly damaged files still open and export, and pure XFA forms get a clear explanation instead of a blank panel.
- **Picks up where you left off.** Work is auto-saved locally (IndexedDB) with a recent-documents list. Opening the same PDF again brings your work back, and a second tab can't silently overwrite it.
- **Comfortable everywhere.** Zoom (pinch, Ctrl/⌘+wheel, fit width/page), page thumbnails, light & dark themes, a touch-friendly layout on phones, and full keyboard support (press `?` for the shortcuts).

## Development

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev        # http://localhost:5173/FillFlow/
```

| Script | What it does |
| --- | --- |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | TypeScript only |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (Vitest, Node) |
| `npm run e2e` | End-to-end tests (Playwright, uses your installed Chrome) |
| `npm run sample` | Regenerate `public/samples/sample-form.pdf` |
| `npm run fixtures` | Regenerate the end-to-end test PDFs in `e2e/fixtures/` |
| `npm run deploy` | Build and publish `dist/` to GitHub Pages |

GitHub Actions (`.github/workflows/ci.yml`) runs the type check, lint, unit tests, build and end-to-end tests on every pull request. It never deploys.

The app targets current Chrome, Edge, Firefox and Safari on desktop and mobile. pdf.js is loaded from its legacy build, so recent-but-not-latest browsers (for example Safari before 18.2) open files too.

## How it works

- **Rendering** — [pdf.js](https://mozilla.github.io/pdf.js/) renders pages to canvas (virtualized, high-DPI). Interactive form widgets are drawn as HTML controls on top.
- **One coordinate system** — everything placed on a page is stored in *view space*: PDF points with the page rotation applied, origin at the top-left of the visible page (`src/model/types.ts`). `src/lib/pdf/geometry.ts` converts to PDF user space and is tested against pdf.js' own viewport math for every rotation and crop offset.
- **Shared text layout** — `src/lib/text/layout.ts` computes line positions and baselines for both the editor and the exporter, using the bundled Arimo / Tinos / Cousine fonts (Latin, Greek, Cyrillic and Hebrew) with pinned metrics.
- **Export** — [pdf-lib](https://pdf-lib.js.org/) writes form values into the original AcroForm and draws the placed items under a single transformation matrix per page, so they stay upright and in place on rotated pages. Text is embedded as real, selectable text (subset fonts, bidi-aware, letter spacing per grapheme cluster like the browser). Encrypted or damaged files are first rewritten through pdf.js, then their layers, page labels and field tree are restored. The export engine is a separate chunk, loaded in the background once a document is open.
- **State** — a single [zustand](https://zustand.docs.pmnd.rs/) store (`src/store/editor.ts`) with snapshot-based undo/redo. Autosave writes to IndexedDB with a compare-and-swap on each document's last save, so two tabs never overwrite each other's work unnoticed.

```
src/
  model/        types, element factories, fonts, tools
  store/        editor store (document, items, history, view)
  lib/          pdf (pdf.js, geometry, form fields), export, text layout, storage, utils
  features/     home, editor shell, viewer, elements (editing), forms, signature, export
  components/   UI kit (Radix-based) and brand
```

## Fonts

Arimo, Tinos and Cousine are bundled under the SIL Open Font License (see `src/assets/fonts/*-OFL.txt`). Interface fonts (Inter, Instrument Serif) and handwriting fonts come from [Fontsource](https://fontsource.org/).
