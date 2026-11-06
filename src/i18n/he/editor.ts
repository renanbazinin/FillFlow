import { bidiIsolate } from '../../lib/utils/misc'
import type { EditorMessages } from '../en/editor'

export const editor: EditorMessages = {
  tabTitle: (name) => `${name} — FillFlow`,

  dock: {
    label: 'כלים',
    shapes: 'צורות',
    shapesHint: 'מלבן, אליפסה או קו',
    dateFormat: 'תבנית תאריך',
  },

  hint: {
    place: {
      signature: 'לחצו כדי למקם את החתימה שלכם',
      initials: 'לחצו כדי למקם את ראשי התיבות שלכם',
      image: 'לחצו כדי למקם את התמונה',
    },
    placeTouch: {
      signature: 'הקישו כדי למקם את החתימה שלכם',
      initials: 'הקישו כדי למקם את ראשי התיבות שלכם',
      image: 'הקישו כדי למקם את התמונה',
    },
    keys: {
      add: 'להוספה',
      place: 'למיקום',
      cancel: 'לביטול',
      finish: 'לסיום',
    },
    staysOn: 'נשאר פעיל',
  },

  formHint: {
    found: (count, touch) =>
      `${count === 1 ? 'נמצא שדה אחד למילוי' : `נמצאו ${count} שדות למילוי`} — ${touch ? 'הקישו' : 'לחצו'} על שדה כדי להקליד`,
    show: 'הצגת הטופס',
    xfa: 'אי אפשר למלא בדפדפן את טופס ה-XFA הדינמי הזה',
    xfaBody: 'עדיין אפשר להקליד, לסמן ולחתום על גבי העמודים.',
    details: 'פרטים',
  },

  shortcuts: {
    title: 'קיצורי מקלדת',
    intro: 'לחצו על {key} בכל רגע כדי לראות אותם שוב.',
    list: 'רשימת הקיצורים',
    or: 'או',
    groups: {
      tools: 'כלים',
      editing: 'עריכה',
      view: 'תצוגה',
      file: 'קובץ',
    },
    pointer: {
      click: 'לחיצה',
      'double-click': 'לחיצה כפולה',
      'right-click': 'לחיצה ימנית',
      drag: 'גרירה',
      scroll: 'גלילה',
      pinch: 'צביטה',
    },
    rows: {
      undo: 'ביטול פעולה',
      redo: 'ביצוע מחדש',
      copy: 'העתקה',
      cut: 'גזירה',
      paste: 'הדבקה',
      duplicate: 'שכפול',
      delete: 'מחיקה',
      selectAll: 'בחירת הכול בעמוד',
      addToSelection: 'הוספה לבחירה',
      addInView: 'הוספת פריט של הכלי הפעיל במרכז התצוגה',
      // The measurement keeps its own (left-to-right) order: "10 pt", not "pt 10".
      nudge: `הזזה קלה (עם Shift: צעדים של ${bidiIsolate('10 pt')})`,
      editText: 'עריכת טקסט',
      finishText: 'סיום עריכת הטקסט',
      bold: 'טקסט מודגש',
      toFront: 'הבאה לחזית',
      toBack: 'שליחה לרקע',
      lock: 'נעילה / ביטול נעילה',
      deselect: 'סיום / ביטול הבחירה',
      keepTool: 'השארת כלי פעיל',
      itemMenu: 'תפריט הפריט',
      proportions: `שמירה על יחסי הגודל, קווים בזוויות של ${bidiIsolate('45°')}`,
      noSnap: 'הזזה בלי הצמדה',
      cancelDrag: 'ביטול גרירה',
      zoomIn: 'הגדלה',
      zoomOut: 'הקטנה',
      fitWidth: 'התאמה לרוחב',
      zoom: 'זום',
      pan: 'הזזת תצוגה',
      download: 'הורדת ה-PDF',
      open: 'פתיחת PDF אחר',
      shortcuts: 'קיצורי מקלדת',
    },
  },

  panels: {
    pages: 'עמודים',
    hidePages: 'הסתרת חלונית העמודים',
    closePages: 'סגירת חלונית העמודים',
    hidePanel: 'הסתרת החלונית',
    closePanel: 'סגירת החלונית',
    tabs: 'חלונית',
    form: 'טופס',
    items: 'פריטים',
    formAndItems: 'טופס ופריטים',
  },

  viewer: {
    label: 'עמודי המסמך',
    page: (n, count) => `עמוד ${n} מתוך ${count}`,
    renderError: 'לא ניתן היה להציג את העמוד הזה.',
  },

  zoom: {
    label: 'זום',
    in: 'הגדלה',
    out: 'הקטנה',
    level: (percent, fit) =>
      `רמת זום ${percent}%${fit === 'width' ? ', מותאם לרוחב' : fit === 'page' ? ', מותאם לעמוד' : ''}`,
    fitWidth: 'התאמה לרוחב',
    fitPage: 'התאמה לעמוד',
  },

  thumbnails: {
    label: 'עמודים',
    page: (n, count, edits) =>
      `עמוד ${n} מתוך ${count}${edits ? (edits === 1 ? ', שינוי אחד' : `, ${edits} שינויים`) : ''}`,
  },

  save: {
    saving: 'שומר…',
    saved: 'נשמר במכשיר הזה',
    savedShort: 'נשמר',
    notSaved: 'לא נשמר',
    notSavedTip: (reason) => `${reason} כדי לא לאבד את השינויים, הורידו את ה-PDF.`,
    refused: 'הדפדפן סירב לאחסן את השינויים שלכם.',
    failed: 'לא ניתן היה לשמור את ההתקדמות שלכם במכשיר הזה',
    unavailable: 'אי אפשר לשמור את ההתקדמות שלכם במכשיר הזה',
    downloadToKeep: (reason) => `${reason} כדי לא לאבד את השינויים, הורידו את ה-PDF.`,
    fileNotStored: 'לא ניתן היה לאחסן את קובץ ה-PDF במכשיר הזה',
    fileNotStoredBody: (reason) => `${reason} שמרו אצלכם את הקובץ: כדי להמשיך בעבודה תצטרכו לפתוח אותו שוב.`,
    gotIt: 'הבנתי',
    outdated: {
      changedElsewhere: 'המסמך הזה שונה בכרטיסייה אחרת',
      notLoaded: 'העבודה השמורה שלכם על המסמך הזה לא נטענה',
      removed: 'המסמך הוסר מהמכשיר הזה',
    },
    outdatedBody: 'טענו אותו מחדש כדי לקבל את הגרסה השמורה האחרונה. שינויים שנעשים כאן לא נשמרים.',
    removedBody: 'שינויים שנעשים כאן לא נשמרים, אלא אם תשמרו את המסמך.',
    notLoadedBody: 'טענו אותו מחדש כדי לנסות שוב, לפני שתבצעו שינויים.',
    reload: 'טעינה מחדש',
    keep: 'שמירת המסמך',
    lost: (name) => `השינויים האחרונים שלכם במסמך "${bidiIsolate(name)}" לא נשמרו`,
    lostBecause: {
      changedElsewhere: 'הוא שונה בכרטיסייה אחרת.',
      notLoaded: 'העבודה השמורה שלו לא נטענה.',
      removed: 'הוא הוסר מהמכשיר הזה.',
    },
  },

  storage: {
    blocked: 'הדפדפן הזה חוסם אחסון עבור האתר הזה.',
    full: 'האחסון במכשיר הזה מלא.',
    window: 'האחסון לא זמין בחלון הדפדפן הזה.',
    content: 'לא ניתן היה לאחסן את התוכן הזה.',
    other: 'האחסון במכשיר הזה דיווח על שגיאה.',
  },

  unsaved: {
    body: 'לא ניתן היה לשמור אותם במכשיר הזה. אם תרצו לשמור אותם, הורידו קודם את ה-PDF.',
    leaveTitle: 'לצאת בלי השינויים האחרונים שלכם?',
    leave: 'יציאה בכל זאת',
    stay: 'חזרה למסמך',
    reloadTitle: 'לטעון מחדש בלי השינויים האחרונים שלכם?',
    reload: 'טעינה מחדש בכל זאת',
  },
}
