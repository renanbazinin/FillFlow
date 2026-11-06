import type { CommonMessages } from '../en/common'

export const common: CommonMessages = {
  cancel: 'ביטול',
  close: 'סגירה',
  continue: 'המשך',
  done: 'סיום',
  pages: (n) => (n === 1 ? 'עמוד אחד' : `${n} עמודים`),
  items: (n) => (n === 1 ? 'פריט אחד' : `${n} פריטים`),
  fields: (n) => (n === 1 ? 'שדה אחד' : `${n} שדות`),
  documents: (n) => (n === 1 ? 'מסמך אחד' : `${n} מסמכים`),
}
