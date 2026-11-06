import type { SignatureMessages } from '../en/signature'

const strokesSoFar = (n: number) => (n ? `; ${n === 1 ? 'משיכה אחת' : `${n} משיכות`} עד כה` : '')

export const signature: SignatureMessages = {
  dialog: {
    title: { signature: 'הוספת חתימה', initials: 'הוספת ראשי תיבות' },
    description: 'ציירו, הקלידו או העלו — הכול נשאר במכשיר שלכם.',
    useSaved: { signature: 'שימוש בחתימה שמורה', initials: 'שימוש בראשי תיבות שמורים' },
    createNew: { signature: 'או צרו חתימה חדשה', initials: 'או צרו ראשי תיבות חדשים' },
    tabsLabel: { signature: 'אופן יצירת החתימה', initials: 'אופן יצירת ראשי התיבות' },
    tabs: { draw: 'ציור', type: 'הקלדה', upload: 'העלאה' },
    use: { signature: 'שימוש בחתימה', initials: 'שימוש בראשי התיבות' },
    nothingToUse: {
      title: 'עדיין אין במה להשתמש',
      description: { signature: 'הוסיפו קודם את החתימה שלכם.', initials: 'הוסיפו קודם את ראשי התיבות שלכם.' },
    },
    pasteFailed: { title: 'לא ניתן לקרוא את התמונה שהודבקה', description: 'נסו קודם לשמור אותה כקובץ PNG או JPEG.' },
    saveFailed: { title: 'לא ניתן היה לשמור לפעם הבאה', description: 'הדפדפן הזה לא מאפשר אחסון מקומי.' },
    failed: { title: 'משהו השתבש', description: 'נסו שוב.' },
  },
  inkColor: 'צבע הדיו',
  pen: {
    label: 'עובי העט',
    fine: 'עט דק',
    medium: 'עט בינוני',
    bold: 'עט עבה',
  },
  saveForNextTime: 'שמירה לפעם הבאה',
  draw: {
    hint: { signature: 'חתמו מעל הקו', initials: 'כתבו את ראשי התיבות מעל הקו' },
    area: {
      signature: (strokes) => `אזור הציור של החתימה. ציירו בעכבר, באצבע או בעט${strokesSoFar(strokes)}.`,
      initials: (strokes) => `אזור הציור של ראשי התיבות. ציירו בעכבר, באצבע או בעט${strokesSoFar(strokes)}.`,
    },
    undoStroke: 'ביטול המשיכה האחרונה',
    undo: 'ביטול פעולה',
    clearDrawing: 'ניקוי הציור',
    clear: 'ניקוי',
  },
  type: {
    nameLabel: { signature: 'השם המלא שלכם', initials: 'ראשי התיבות שלכם' },
    placeholder: { signature: 'לדוגמה: ישראל כהן', initials: 'לדוגמה: י״כ' },
    sample: { signature: 'השם שלכם', initials: 'א״ב' },
    styles: 'סגנון כתב יד',
  },
  upload: {
    notImage: { title: 'הקובץ הזה אינו תמונה', description: 'בחרו תמונת PNG או JPEG של החתימה שלכם.' },
    openFailed: { title: 'לא ניתן לפתוח את התמונה הזו', description: 'נסו קובץ PNG או JPEG.' },
    opening: 'פותח את התמונה…',
    dropToUpload: 'שחררו כדי להעלות',
    drop: { signature: 'גררו לכאן תמונה של החתימה שלכם', initials: 'גררו לכאן תמונה של ראשי התיבות שלכם' },
    orChoose: 'או {link}',
    chooseFile: 'בחרו קובץ',
    orPaste: ' · או הדביקו עם {keys}',
    tip: 'חתמו על דף לבן חלק וצלמו אותו באור טוב. הרקע יוסר אוטומטית.',
    previewEmpty: 'תצוגה מקדימה: לא נשאר כלום אחרי הסרת הרקע',
    preview: { signature: 'תצוגה מקדימה של החתימה שהועלתה', initials: 'תצוגה מקדימה של ראשי התיבות שהועלו' },
    nothingLeft: 'לא נשאר מה לשמור. הנמיכו את הרגישות או כבו את הסרת הרקע.',
    dropToReplace: 'שחררו כדי להחליף',
    replace: 'החלפה',
    remove: 'הסרת התמונה',
    removeBackground: 'הסרת הרקע',
    removeBackgroundHint: 'הופכת את הנייר לשקוף, כך שרק הדיו יתווסף למסמך.',
    sensitivity: 'רגישות',
    sensitivityLabel: 'רגישות הסרת הרקע',
    auto: 'אוטומטי',
  },
  saved: {
    label: { signature: 'חתימות שמורות', initials: 'ראשי תיבות שמורים' },
    title: { signature: 'החתימות שלכם', initials: 'ראשי התיבות שלכם' },
    pick: 'בחרו כדי להוסיף לעמוד',
    empty: {
      signature: 'עדיין לא נשמר כלום. צרו חתימה וסמנו "שמירה לפעם הבאה".',
      initials: 'עדיין לא נשמר כלום. צרו ראשי תיבות וסמנו "שמירה לפעם הבאה".',
    },
    new: { signature: 'חתימה חדשה', initials: 'ראשי תיבות חדשים' },
    count: {
      signature: (n) => (n === 0 ? 'אין חתימות שמורות' : n === 1 ? 'חתימה שמורה אחת' : `${n} חתימות שמורות`),
      initials: (n) => (n === 0 ? 'אין ראשי תיבות שמורים' : `ראשי תיבות שמורים: ${n}`),
    },
    // The date reads "5 במרץ 2026": a digit after the prefix, hence ב-.
    place: {
      signature: (date) => `הוספת החתימה שנשמרה ב-${date}`,
      initials: (date) => `הוספת ראשי התיבות שנשמרו ב-${date}`,
    },
    remove: {
      signature: (date) => `מחיקת החתימה שנשמרה ב-${date}`,
      initials: (date) => `מחיקת ראשי התיבות שנשמרו ב-${date}`,
    },
    confirmDelete: {
      title: { signature: 'למחוק את החתימה?', initials: 'למחוק את ראשי התיבות?' },
      description: {
        signature: 'החתימה תוסר מהמכשיר הזה. מסמכים שכבר חתמתם עליהם לא יושפעו.',
        initials: 'ראשי התיבות יוסרו מהמכשיר הזה. מסמכים שכבר חתמתם עליהם לא יושפעו.',
      },
      confirm: 'מחיקה',
    },
    deleteFailed: { title: 'לא ניתן היה למחוק', description: 'נסו שוב.' },
  },
  place: {
    hint: 'לחצו במקום הרצוי בעמוד, או על Enter',
    touchHint: 'הקישו במקום הרצוי בעמוד',
  },
  image: {
    preparing: 'מכין את התמונה…',
    openFailed: { title: 'לא ניתן לפתוח את התמונה הזו', description: 'נסו קובץ PNG, JPEG, WebP או GIF.' },
    blocked: {
      title: (tool) => `בחרו תמונה עם הלחצן "${tool}"`,
      description: 'הדפדפן חסם את פתיחת חלון בחירת הקבצים מקיצור המקלדת.',
    },
  },
}
