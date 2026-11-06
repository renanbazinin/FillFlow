import { bidiIsolate } from '../../lib/utils/misc'
import type { ToolsMessages } from '../en/tools'

export const tools: ToolsMessages = {
  select: {
    label: 'בחירה',
    hint: 'בחירה, הזזה ושינוי גודל של פריטים',
    touchHint: 'בחירה, הזזה ושינוי גודל של פריטים',
  },
  hand: {
    label: 'הזזת תצוגה',
    hint: 'גררו כדי לגלול במסמך (או החזיקו את מקש הרווח)',
    touchHint: 'גררו כדי לגלול במסמך',
  },
  text: { label: 'טקסט', hint: 'לחצו במקום כלשהו כדי להקליד', touchHint: 'הקישו במקום כלשהו כדי להקליד' },
  check: { label: 'סימן וי', hint: 'לחצו כדי להוסיף ✓', touchHint: 'הקישו כדי להוסיף ✓' },
  cross: { label: 'איקס', hint: 'לחצו כדי להוסיף ✗', touchHint: 'הקישו כדי להוסיף ✗' },
  dot: { label: 'נקודה', hint: 'לחצו כדי להוסיף •', touchHint: 'הקישו כדי להוסיף •' },
  date: { label: 'תאריך', hint: 'לחצו כדי להוסיף את תאריך היום', touchHint: 'הקישו כדי להוסיף את תאריך היום' },
  signature: {
    label: 'חתימה',
    hint: 'ציירו, הקלידו או העלו את החתימה שלכם',
    touchHint: 'ציירו, הקלידו או העלו את החתימה שלכם',
  },
  initials: { label: 'ראשי תיבות', hint: 'הוסיפו את ראשי התיבות שלכם', touchHint: 'הוסיפו את ראשי התיבות שלכם' },
  image: { label: 'תמונה', hint: 'הוסיפו תמונה או חותמת', touchHint: 'הוסיפו תמונה או חותמת' },
  ink: { label: 'ציור', hint: 'ציור חופשי בעט', touchHint: 'ציור חופשי בעט' },
  highlight: { label: 'הדגשה', hint: 'גררו מעל טקסט כדי להדגיש אותו', touchHint: 'גררו מעל טקסט כדי להדגיש אותו' },
  whiteout: { label: 'מחיקון', hint: 'גררו כדי לכסות תוכן בלבן', touchHint: 'גררו כדי לכסות תוכן בלבן' },
  rect: { label: 'מלבן', hint: 'גררו כדי לצייר מלבן', touchHint: 'גררו כדי לצייר מלבן' },
  ellipse: { label: 'אליפסה', hint: 'גררו כדי להקיף משהו', touchHint: 'גררו כדי להקיף משהו' },
  line: {
    label: 'קו',
    // The angle keeps its own (left-to-right) order: "45°", not "°45".
    hint: `גררו כדי לצייר קו (Shift מיישר בזוויות של ${bidiIsolate('45°')})`,
    touchHint: 'גררו כדי לצייר קו',
  },
}
