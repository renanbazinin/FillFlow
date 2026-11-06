import { bidiIsolate } from '../../lib/utils/misc'
import type { ExportMessages } from '../en/export'

export const exportDialog: ExportMessages = {
  title: 'הורדת PDF',
  description: 'העותק הממולא נוצר כאן, במכשיר שלכם — הקובץ לא יוצא ממנו.',
  fileName: 'שם הקובץ',
  nameSuffix: 'ממולא',
  summary: {
    pages: (n) => (n === 1 ? 'עמוד אחד' : `${n.toLocaleString()} עמודים`),
    placed: (n) => (n === 0 ? 'לא נוספו פריטים' : n === 1 ? 'פריט אחד נוסף' : `${n.toLocaleString()} פריטים נוספו`),
    filled: (n) => (n === 0 ? 'לא מולאו שדות' : n === 1 ? 'שדה אחד מולא' : `${n.toLocaleString()} שדות מולאו`),
    ready: 'מוכן',
    readySize: (size) => `מוכן · ${size}`,
  },
  progress: {
    preparing: 'מכין את קובץ ה-PDF…',
    forms: 'ממלא את השדות בטופס…',
    pages: 'מוסיף את השינויים שלכם…',
    page: (page, total) => `מוסיף את השינויים שלכם… עמוד ${page} מתוך ${total}`,
    saving: 'שומר…',
  },
  size: {
    bytes: (n) => (n === 1 ? 'בית אחד' : `${n} בתים`),
    kb: (n) => `${n} ק״ב`,
    mb: (n) => `${n} מ״ב`,
  },
  flatten: 'שיטוח השדות בטופס',
  flattenHint: 'מומלץ לפני שליחה — לא יהיה אפשר עוד לערוך את הערכים',
  // Every name is isolated: a name in Latin letters (or ending in digits) keeps its own order in the
  // sentence. The prefix ו comes before the quote mark: "שם" ו"עיר".
  list: (names, max) => {
    const quoted = names.map((name) => `"${bidiIsolate(name)}"`)
    if (quoted.length <= max) return quoted.length > 1 ? `${quoted.slice(0, -1).join(', ')} ו${quoted.at(-1)}` : (quoted[0] ?? '')
    const more = quoted.length - max
    return `${quoted.slice(0, max).join(', ')} ועוד ${more === 1 ? 'אחד' : more}`
  },
  covered: (list, fields) =>
    fields === 1
      ? `השדה ${list} ישוטח בכל זאת, כדי שמה שהוספתם עליו יישאר גלוי.`
      : `השדות ${list} ישוטחו בכל זאת, כדי שמה שהוספתם עליהם יישאר גלוי.`,
  nothingAdded: {
    flattened: 'עדיין לא הוספתם כלום. השדות בטופס ישוטחו, כך שלא יהיה אפשר עוד למלא אותם.',
    unchanged: 'עדיין לא הוספתם כלום, כך שהקובץ שתורידו יהיה זהה לקובץ המקורי.',
  },
  passwordDropped: 'העותק שתורידו לא יהיה מוגן בסיסמה: כל מי שיקבל את הקובץ יוכל לפתוח אותו.',
  unwritten: {
    title: (fields) => (fields === 1 ? 'לא ניתן היה למלא שדה אחד' : 'לא ניתן היה למלא כמה שדות'),
    body: (list, fields) => `קובץ ה-PDF לא יכלול את מה שהזנתם ${fields === 1 ? 'בשדה' : 'בשדות'} ${list}.`,
  },
  failed: 'לא ניתן היה ליצור את קובץ ה-PDF',
  shareAgain: 'קובץ ה-PDF מוכן — הקישו שוב על "שיתוף" כדי לשלוח אותו.',
  actions: {
    print: 'הדפסה',
    share: 'שיתוף…',
    preparing: 'מכין…',
    download: 'הורדת PDF',
  },
  delivered: {
    downloaded: 'קובץ ה-PDF הורד',
    printTab: { title: 'נפתח בכרטיסייה חדשה', description: 'הדפיסו אותו ממציג ה-PDF של הדפדפן.' },
    printDownloaded: {
      title: 'קובץ ה-PDF הורד במקום הדפסה',
      description: 'הדפדפן הזה לא יכול להדפיס קובצי PDF ישירות — הדפיסו אותו מתוך הקבצים שלכם.',
    },
  },
  printFrame: 'תצוגה מקדימה להדפסה',
  errors: {
    encrypted:
      'קובץ ה-PDF הזה מוצפן, ולכן FillFlow לא יכול לשמור עותק עם השינויים שלכם. הסירו קודם את ההגנה (למשל, הדפיסו אותו ל-PDF חדש), ואז פתחו את העותק.',
    damaged: 'קובץ ה-PDF הזה פגום באופן ש-FillFlow לא יכול לתקן, ולכן לא ניתן היה ליצור עותק ממולא.',
    fonts: 'לא ניתן היה לטעון את הגופנים הדרושים לטקסט שלכם. בדקו את החיבור לאינטרנט ונסו שוב.',
    forms: 'לא ניתן היה לכתוב את ערכי השדות בטופס לתוך קובץ ה-PDF.',
    aborted: 'הייצוא בוטל.',
    unknown: 'משהו השתבש ביצירת קובץ ה-PDF.',
    passwordProtected: 'קובץ ה-PDF הזה מוגן בסיסמה. פתחו אותו ב-FillFlow עם הסיסמה שלו ונסו שוב.',
    noDocument: 'פתחו קודם מסמך.',
    generic: 'משהו השתבש ביצירת קובץ ה-PDF. נסו שוב.',
  },
}
