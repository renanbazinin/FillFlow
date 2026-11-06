# Interface languages

The interface comes in English and Hebrew. Hebrew reads right to left: the app's frame mirrors, the
document pages never do.

## How it works

- **Which language** (`locale.ts`): the one picked on this device (`localStorage['fillflow:locale']`),
  else the first of the browser's languages the interface comes in, else English. It sets
  `<html lang dir>`; an inline copy in `index.html` does the same before the first paint. Switch with
  `setLocale()` (the home header's button, the editor's ⋯ menu).
- **Strings** live in one module per area: `en/<area>.ts` is the source and defines the shape;
  `he/<area>.ts` is typed with it (`export const home: HomeMessages = {…}`), so a missing or extra key
  fails the type check. `i18n.test.tsx` also catches English left untranslated.
- **Reading them**: in a component, `const t = useT()` and `t.home.dropzone.title`; `useT()` also
  re-renders the component when the language changes, so call it in every component that shows text,
  even text from a helper. Outside React, `getT()` *when the text is used* — never at module load (the
  language can change later). A list of options defined once (tools, themes) reads its words through
  getters or `(t) => t.x` functions, not stored strings.
- **Values**: plain strings, or functions for counts and inserted values (`(n: number) => …`). A
  sentence with a link or emphasis inside is one message with `{slots}`, filled by `richText()`.
  Never build a sentence out of separate keys: word order differs between languages.
- English text stays exactly as it was (same characters: ’ “ ” …); the end-to-end tests match it.
  Tests run in English (`playwright.config.ts` pins `en-US`; unit tests run outside a browser).

## Right to left

- The frame mirrors through CSS: use logical utilities — `ms-/me-` (not `ml-/mr-`), `ps-/pe-`,
  `start-/end-` (not `left-/right-`), `rounded-s/e`, `border-s/e`, `text-start/end`, `scroll-ms-`,
  `ps-safe-*/pe-safe-*` (safe areas). Centering (`left-1/2 -translate-x-1/2`) needs no change.
- What logical properties can't express takes an `rtl:` variant. Ours goes by the element's own
  direction (`:dir(rtl)`), so it does not apply inside the left-to-right pages.
- Icons that point along the reading direction mirror with `rtl:-scale-x-100`: back/forward,
  previous/next chevrons, undo/redo, the panel-side icons, "open in new" arrows. Others don't:
  checkmarks, text alignment (it shows where text sits on the page), media, logos.
- Arrow keys that move along a row follow what's on screen: right to left, ArrowLeft goes to the next
  item. Radix components do this themselves (`Direction.Provider` in `App.tsx`).
- Horizontal scrolling: right to left, `scrollLeft` is 0 at the start (the right edge) and negative
  toward the end; edge fades and "scrolled to the end" checks use `Math.abs(scrollLeft)` and swap their
  sides.
- Keys and shortcuts read left to right in both: `Kbd` and `MenuShortcut` are `dir="ltr"`; a row of
  key caps for one combination sits in a `dir="ltr"` box.
- Text from outside the interface (file names, field names, what people typed) keeps its own
  direction: in JSX put it in `<bdi>` (or `dir="auto"` on its own element); inside a string message,
  `bidiIsolate()` (lib/utils/misc) — in the Hebrew strings, where it sits in a sentence.
- Tooltips take logical sides too: `side="start" | "end"` (Tooltip, IconButton's `tooltipSide`), and
  a Sheet slides in from `side="start" | "end"`. Radix `align="start"` already mirrors.
- **The document pages stay left to right.** The viewer's scroll container is `dir="ltr"`: pages,
  placed items, form fields, selection handles, guides, text editing and their geometry are exactly as
  in English. Interface text shown inside the pages (a label, a placeholder) gets the interface's
  direction on its own element (`dir={useDir()}`).

## Hebrew style

- **Voice**: plural imperative for instructions and hints ("גררו קובץ לכאן", "לחצו כדי להוסיף…";
  on touch screens "הקישו" for tap). Nouns for buttons, menu items, tabs and titles ("הורדה", "ביטול",
  "שמירה", "פתיחת PDF אחר…"). A confirmation asks with an infinitive ("למחוק את המסמך?"). Status
  in the past ("נשמר", "נמחק"). Speak to people in the plural ("שלכם"), never in a gendered singular.
- Plain and short, like the English; translate the meaning, not word by word. No "אנא".
- Straight double quotes around names: "טופס 101.pdf" (not “ ”). Ellipsis …, em dash — with spaces.
- A Hebrew prefix before Latin letters or digits takes a hyphen: "ב-PDF", "ה-PDF", "ל-45°", "ב-GitHub".
- Western digits. Counts: one is "עמוד אחד", "שדה אחד", "חתימה אחת" (the number word agrees with
  the noun's gender), otherwise "3 עמודים". Dual forms where Hebrew uses them: "יומיים", "שעתיים",
  "פעמיים".
- Names stay in Latin letters: FillFlow, PDF, GitHub, PDF.js, pdf-lib, and keys (Ctrl, Shift, Alt,
  Esc, Enter, Tab, ⌘). In a sentence, Space is "מקש הרווח".

### Glossary

| English | Hebrew |
| --- | --- |
| document / file | מסמך / קובץ |
| page, pages | עמוד, עמודים |
| form / form field, field / required | טופס / שדה (בטופס), שדות / חובה |
| item (anything placed on a page) | פריט, פריטים |
| tool | כלי |
| text / text box | טקסט / תיבת טקסט |
| checkbox / radio button, option / dropdown / list box / comb field | תיבת סימון / לחצן בחירה, אפשרות / רשימה נפתחת / תיבת רשימה / שדה משבצות |
| checkmark ✓ / cross ✗ / dot • | סימן וי / איקס / נקודה |
| date / today's date | תאריך / תאריך היום |
| signature, sign / initials | חתימה, לחתום / ראשי תיבות |
| image, picture / stamp | תמונה / חותמת |
| draw, drawing (ink) / highlight / whiteout | ציור / הדגשה / מחיקון |
| shape / rectangle / ellipse / line | צורה / מלבן / אליפסה / קו |
| download / export (making the PDF) | הורדה (להוריד) / ייצוא |
| save, saved, saving… | שמירה, נשמר, שומר… |
| upload / open / close | העלאה / פתיחה / סגירה |
| delete / remove / clear / reset | מחיקה / הסרה / ניקוי / איפוס |
| undo / redo | ביטול פעולה / ביצוע מחדש |
| copy / cut / paste / duplicate | העתקה / גזירה / הדבקה / שכפול |
| select / select all / deselect | בחירה / בחירת הכול / ביטול הבחירה |
| lock / unlock / locked | נעילה / ביטול נעילה / נעול |
| bring to front / send to back | הבאה לחזית / שליחה לרקע |
| zoom in / zoom out / fit to width | הגדלה / הקטנה / התאמה לרוחב |
| thumbnails / panel / tab (in a panel) / browser tab | תמונות ממוזערות / חלונית / לשונית / כרטיסייה |
| theme / language / keyboard shortcuts | ערכת נושא / שפה / קיצורי מקלדת |
| font / size / color / bold / alignment | גופן / גודל / צבע / מודגש / יישור |
| letter spacing / line spacing / opacity / thickness / fill / border | ריווח אותיות / ריווח שורות / אטימות / עובי / מילוי / מסגרת |
| flatten (the form) | שיטוח הטופס |
| password / password-protected | סיסמה / מוגן בסיסמה |
| device / browser / storage | מכשיר / דפדפן / אחסון |
| recent documents / sample form | מסמכים אחרונים / טופס לדוגמה |
| click / tap / double-click / right-click | לחיצה / הקשה / לחיצה כפולה / לחיצה ימנית |
| drag / scroll / pinch | גרירה / גלילה / צביטה |
| share / print | שיתוף / הדפסה |
| "3 of 10 filled" / next empty field | "3 מתוך 10 מולאו" / השדה הריק הבא |
