import type { ShellMessages } from '../en/shell'

export const shell: ShellMessages = {
  title: 'FillFlow — מילוי וחתימה על קובצי PDF בדפדפן',
  description:
    'מילוי טופסי PDF והוספת טקסט, סימני וי וחתימות ישירות בדפדפן. בחינם ובפרטיות — הקבצים שלכם לא יוצאים מהמכשיר.',
  notifications: 'הודעות',
  alerts: 'התראות',
  crash: {
    title: 'משהו השתבש',
    body: 'אירעה ב-FillFlow בעיה לא צפויה. טענו מחדש את הדף כדי להמשיך — העבודה ששמורה במכשיר הזה לא תאבד.',
    reload: 'טעינה מחדש',
  },
  language: {
    label: 'שפה',
  },
  theme: {
    label: 'ערכת נושא',
    light: 'בהירה',
    dark: 'כהה',
    system: 'לפי המערכת',
    lightName: 'ערכת נושא בהירה',
    darkName: 'ערכת נושא כהה',
    systemName: 'ערכת נושא לפי המערכת',
  },
  ui: {
    dialog: 'חלון דו-שיח',
    decrease: (what) => `הקטנת ${what}`,
    increase: (what) => `הגדלת ${what}`,
    color: 'צבע',
    noColor: 'ללא צבע',
    customColor: 'צבע מותאם אישית',
    colors: {
      black: 'שחור',
      blue: 'כחול',
      red: 'אדום',
      green: 'ירוק',
      purple: 'סגול',
      white: 'לבן',
      yellow: 'צהוב',
    },
  },
  topBar: {
    backHome: 'חזרה לדף הבית',
    download: 'הורדה',
    undo: 'ביטול פעולה',
    redo: 'ביצוע מחדש',
    pages: 'עמודים',
    formAndItems: 'טופס ופריטים',
    items: 'פריטים',
    more: 'עוד',
  },
  menu: {
    openAnother: 'פתיחת PDF אחר…',
    pages: 'עמודים',
    formAndItems: 'טופס ופריטים',
    items: 'פריטים',
    zoomIn: 'הגדלה',
    zoomOut: 'הקטנה',
    fitWidth: 'התאמה לרוחב',
    shortcuts: 'קיצורי מקלדת',
    closeDocument: 'סגירת המסמך',
    clearEverything: 'ניקוי הכול…',
    clearTitle: 'לנקות את כל מה שהוספתם?',
    clearBody: (locked) =>
      'כל הפריטים יוסרו מכל העמודים, והשדות בטופס יחזרו למצבם המקורי.' +
      (locked ? (locked === 1 ? ' פריט נעול אחד יישאר.' : ` ${locked} פריטים נעולים יישארו.`) : '') +
      ' אפשר לבטל את הפעולה.',
    clearConfirm: 'ניקוי הכול',
  },
  home: {
    homeLink: 'דף הבית של FillFlow',
    nav: 'אתר',
    github: 'FillFlow ב-GitHub',
    badge: 'חינמי וקוד פתוח',
    titleStart: 'מלאו וחתמו על כל PDF,',
    titleEnd: 'ישירות בדפדפן.',
    lead: 'הקלידו בכל טופס, סמנו תיבות, הוסיפו חתימה והורידו. בחינם, בלי הרשמה — הקבצים שלכם לא יוצאים מהמכשיר.',
    openSource: 'קוד פתוח ב-GitHub',
    noAccounts: 'בלי חשבונות',
    noTracking: 'בלי מעקב',
    builtWith: 'מבוסס על {pdfjs} ו-{pdflib}',
  },
}
