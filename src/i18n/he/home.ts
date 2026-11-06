import { bidiIsolate } from '../../lib/utils/misc'
import type { HomeMessages } from '../en/home'
import { common } from './common'

export const home: HomeMessages = {
  dropzone: {
    title: 'גררו קובץ PDF לכאן',
    titleDragging: 'שחררו כדי לפתוח את ה-PDF',
    titleTouch: 'פתחו קובץ PDF למילוי',
    hint: 'טפסים, חוזים, בקשות\u00a0— כל קובץ PDF מתאים.',
    choose: 'בחירת PDF',
    paste: 'או הדביקו קובץ עם {keys}',
    private: 'הקבצים נשארים במכשיר שלכם — שום דבר לא מועלה',
    sample: 'או נסו טופס לדוגמה',
  },
  features: {
    heading: 'למה FillFlow',
    fill: {
      title: 'מילוי כל טופס',
      body: 'שדות למילוי מזוהים אוטומטית — או לחצו בכל מקום בעמוד כדי להקליד.',
    },
    sign: {
      title: 'חתימה בשניות',
      body: 'ציירו, הקלידו או העלו את החתימה שלכם. היא נשמרת לפעם הבאה.',
    },
    private: {
      title: 'פרטיות מובנית',
      body: 'הכול קורה במכשיר שלכם. הקבצים שלכם אף פעם לא מועלים.',
    },
    resume: {
      title: 'המשך מאיפה שעצרתם',
      body: 'ההתקדמות שלכם נשמרת אוטומטית בדפדפן הזה תוך כדי עבודה.',
    },
  },
  dropOverlay: {
    title: 'שחררו את ה-PDF כדי לפתוח אותו',
    workSaved: 'העבודה שלכם על {name} שמורה במכשיר הזה.',
    saveFailed: 'השינויים האחרונים שלכם במסמך {name} לא נשמרו במכשיר הזה.',
    notPdf: 'אפשר לפתוח רק קובצי PDF',
  },
  recent: {
    title: 'מסמכים אחרונים',
    subtitle: 'נשמרים רק בדפדפן הזה.',
    edited: (when) => `נערך ${when}`,
    opened: (when) => `נפתח ${when}`,
    fileNotStored: 'הקובץ לא שמור',
    fileNotStoredHint: 'הקובץ של המסמך לא שמור במכשיר הזה. פתחו שוב את אותו קובץ כדי להמשיך.',
    filled: (n) => (n === 1 ? '1 מולא' : `${n} מולאו`),
    openNamed: (name) => `פתיחת ${name}`,
    moreFor: (name) => `אפשרויות נוספות עבור ${name}`,
    open: 'פתיחה',
    remove: {
      menu: 'הסרה מהמכשיר הזה',
      title: 'להסיר את "{name}"?',
      body: 'הקובץ והעבודה שעשיתם עליו יימחקו מהמכשיר הזה. אי אפשר לבטל את הפעולה.',
      confirm: 'הסרה',
      done: 'המסמך הוסר מהמכשיר הזה',
      failed: 'לא ניתן היה להסיר את המסמך',
    },
    clear: {
      button: 'ניקוי הכול',
      title: 'לנקות את כל המסמכים האחרונים?',
      body: (n) =>
        n === 1
          ? 'מסמך אחד והעבודה שעשיתם עליו יימחקו מהמכשיר הזה. אי אפשר לבטל את הפעולה.'
          : `${common.documents(n)} והעבודה שעשיתם עליהם יימחקו מהמכשיר הזה. אי אפשר לבטל את הפעולה.`,
      confirm: 'ניקוי הכול',
      done: 'רשימת המסמכים האחרונים נוקתה',
      failed: 'לא ניתן היה להסיר חלק מהמסמכים',
    },
    olderWork: {
      notice: 'העבודה שלכם על מסמכים שכבר לא מופיעים ברשימה עדיין שמורה במכשיר הזה. פתחו שוב את אותו קובץ כדי להמשיך.',
      delete: 'מחיקת העבודה',
      title: 'למחוק את העבודה שלכם על מסמכים שכבר לא מופיעים ברשימה?',
      body: 'כל מה שמילאתם, הקלדתם או חתמתם במסמכים האלה יימחק מהמכשיר הזה. אי אפשר לבטל את הפעולה.',
      confirm: 'מחיקה',
      done: 'העבודה נמחקה מהמכשיר הזה',
      failed: 'לא ניתן היה למחוק את העבודה',
    },
  },
  // Written out rather than through Intl.RelativeTimeFormat: recent ICU data (ICU 78) gives one and
  // two with the number added ("לפני דקה (1)", "לפני שעתיים (2)").
  time: {
    justNow: 'הרגע',
    minutesAgo: (n) => (n === 1 ? 'לפני דקה' : `לפני ${n} דקות`),
    hoursAgo: (n) => (n === 1 ? 'לפני שעה' : n === 2 ? 'לפני שעתיים' : `לפני ${n} שעות`),
    // By the calendar: "אתמול" is yesterday's date, however many hours ago.
    daysAgo: (days, calendarDays = days) =>
      calendarDays === 0
        ? 'היום'
        : calendarDays === 1
          ? 'אתמול'
          : calendarDays === 2
            ? 'שלשום'
            : `לפני ${calendarDays} ימים`,
    // After "נערך" / "נפתח": "ב-4 במרץ".
    date: (date, withYear) =>
      `ב-${date.toLocaleDateString('he', { day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}) })}`,
  },
  open: {
    notPdf: (name) => `"${bidiIsolate(name)}" אינו קובץ PDF`,
    noPdfs: 'אף אחד מהקבצים האלה אינו קובץ PDF',
    pdfOnly: 'FillFlow פותח רק קובצי PDF.',
    useImageTool: 'כדי להוסיף תמונה לעמוד, השתמשו בכלי התמונה.',
    workSaved: (name) => `העבודה שלכם על "${bidiIsolate(name)}" נשמרה`,
    reopen: 'אפשר לחזור אליו בכל עת מדף הבית.',
    sampleFailed: 'לא ניתן היה לטעון את הטופס לדוגמה',
    checkConnection: 'בדקו את החיבור לאינטרנט ונסו שוב.',
  },
  loading: {
    title: 'פותח…',
  },
  password: {
    title: 'קובץ ה-PDF הזה מוגן בסיסמה',
    body: 'הזינו את הסיסמה כדי לפתוח את {name}.',
    label: 'סיסמה',
    show: 'הצגת הסיסמה',
    hide: 'הסתרת הסיסמה',
    incorrect: 'הסיסמה שגויה. נסו שוב.',
    open: 'פתיחה',
  },
  openError: {
    title: 'לא ניתן היה לפתוח את הקובץ',
    unavailableTitle: 'טעינת FillFlow לא הושלמה',
    tryAgain: 'ניסיון חוזר',
    chooseFile: 'בחירת קובץ',
    tryAnother: 'בחירת קובץ אחר',
    offline: 'אין חיבור לאינטרנט, ו-FillFlow צריך לסיים להיטען לפני שאפשר לפתוח קבצים. התחברו לאינטרנט ונסו שוב.',
    notDownloaded: 'FillFlow צריך לסיים להיטען לפני שאפשר לפתוח קבצים. בדקו את החיבור לאינטרנט ונסו שוב.',
    downloadFailed: 'FillFlow לא הצליח להוריד את מה שנדרש כדי לפתוח קבצים. טענו מחדש את הדף ונסו שוב.',
    invalid: 'קובץ ה-PDF הזה פגום, או שאינו קובץ PDF תקין.',
    unreadable: 'לא ניתן היה לקרוא את קובץ ה-PDF הזה. ייתכן שהוא פגום, או שהוא משתמש בתכונות ש-FillFlow לא תומך בהן.',
    notPdf: 'נראה שהקובץ הזה אינו קובץ PDF.',
    readFailed: 'לא ניתן היה לקרוא את הקובץ.',
    storageReadFailed: 'לא ניתן היה לקרוא את המסמך הזה מהאחסון של המכשיר.',
    missingWithWork: 'הקובץ לא שמור במכשיר הזה, אבל העבודה שלכם עליו כן. בחרו את אותו קובץ כדי להמשיך מאיפה שעצרתם.',
    missing: 'הקובץ לא שמור במכשיר הזה. בחרו אותו שוב כדי לפתוח אותו.',
  },
}
