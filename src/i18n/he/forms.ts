import { bidiIsolate } from '../../lib/utils/misc'
import type { FormsMessages } from '../en/forms'

export const forms: FormsMessages = {
  progress: {
    filled: (filled) => (filled === 1 ? '{filled} מתוך {total} מולא' : '{filled} מתוך {total} מולאו'),
    requiredLeft: (count) => (count === 1 ? 'נותר שדה חובה אחד' : 'נותרו {count} שדות חובה'),
    requiredDone: 'שדות החובה מולאו',
    bar: 'התקדמות מילוי הטופס',
    barValue: (filled, total) => `שדות שמולאו: ${filled} מתוך ${total}`,
    filter: 'הצגת שדות',
    all: 'הכול',
    required: 'חובה',
    empty: 'ריקים',
    reset: 'איפוס הטופס',
    next: 'השדה הריק הבא',
    allFilled: 'כל השדות מולאו',
  },
  reset: {
    title: 'לאפס את הטופס?',
    body: 'כל שדה יחזור לערך שהיה בו כשפתחתם את ה-PDF. הפריטים שהוספתם לעמודים יישארו.',
    confirm: 'איפוס הטופס',
    done: 'הטופס אופס',
    undo: 'ביטול פעולה',
  },
  panel: {
    page: (n) => `עמוד ${n}`,
    readOnly: '(לקריאה בלבד)',
    select: 'בחרו…',
    chooseOrType: 'בחרו או הקלידו…',
    pickAny: 'בחרו כמה שתרצו',
    signed: 'נחתם',
    notSigned: 'עדיין לא נחתם',
    sign: 'חתימה',
    signAgain: 'חתימה מחדש',
  },
  states: {
    noFieldsTitle: 'אין שדות למילוי',
    noFieldsBody: 'ב-PDF הזה אין שדות טופס מובנים — אבל אפשר למלא אותו בכל זאת. בחרו כלי ולחצו במקום כלשהו בעמוד.',
    xfaTitle: 'טופס XFA דינמי',
    xfaBody:
      'ה-PDF הזה הוא טופס XFA דינמי של Adobe, שאי אפשר למלא בדפדפן. עדיין אפשר להקליד, לסמן ולחתום מעל העמודים, או לפתוח אותו ב-Adobe Acrobat Reader כדי להשתמש בשדות שלו.',
    requiredDoneTitle: 'שדות החובה מולאו',
    requiredDoneBody: 'לכל שדות החובה יש ערך.',
    allDoneTitle: 'לא נשאר מה למלא',
    allDoneBody: 'לכל השדות יש ערך. בדקו את הטופס, ואז הורידו אותו.',
    noRequiredTitle: 'אין שדות חובה',
    noRequiredBody: 'בטופס הזה אף שדה לא מסומן כשדה חובה.',
  },
  onPage: {
    option: (field, option) => `${bidiIsolate(field)}: ${bidiIsolate(option)}`,
    signHere: 'חתמו כאן',
    unsigned: (field) => `${bidiIsolate(field)}: חתמו כאן`,
    signed: (field) => `${bidiIsolate(field)}: נחתם — חתמו שוב`,
  },
  names: {
    untitled: 'שדה ללא שם',
    unnamed: (id) => `(ללא שם ${id})`,
    blank: '(ריק)',
  },
}
