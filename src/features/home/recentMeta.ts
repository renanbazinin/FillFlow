import { getT } from '../../i18n'

/** Midnights passed between two times, in local time (0: the same day, 1: the day before…). */
function calendarDaysBetween(ts: number, now: number): number {
  const day = (t: number) => {
    const d = new Date(t)
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  }
  return Math.round((day(now) - day(ts)) / 86_400_000)
}

/**
 * Compact relative time for the recents list, in the interface language, as it follows "edited" /
 * "opened" ("just now", "5m ago", "2h ago", "3d ago", "Mar 4"; "לפני 5 דקות", "אתמול", "ב-4 במרץ").
 * Dates are written the language's way, whatever the browser's locale.
 */
export function relativeTime(ts: number, now = Date.now()): string {
  const t = getT().home.time
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 45) return t.justNow
  const m = Math.round(s / 60)
  if (m < 45) return t.minutesAgo(Math.max(1, m))
  const h = Math.round(m / 60)
  if (h < 22) return t.hoursAgo(h)
  const d = Math.max(1, Math.round(h / 24))
  if (d < 7) return t.daysAgo(d, calendarDaysBetween(ts, now))
  const date = new Date(ts)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return t.date(date, !sameYear)
}

/** "3 pages" (English only: other areas still use it; new text takes `common.pages` and the like). */
export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * "3 pages · edited 2h ago": the latest of saving work on it and opening it ("· opened 5m ago"
 * when it has been opened since, or never edited).
 */
export function recentMetaLine(pageCount: number, at: { openedAt: number; editedAt?: number }, now = Date.now()): string {
  const t = getT()
  const { openedAt, editedAt } = at
  const when =
    editedAt !== undefined && editedAt >= openedAt
      ? t.home.recent.edited(relativeTime(editedAt, now))
      : t.home.recent.opened(relativeTime(openedAt, now))
  return `${t.common.pages(pageCount)} · ${when}`
}

/** "2 pages · file not stored": a recent document whose file isn't stored on this device. */
export function missingFileMetaLine(pageCount: number): string {
  const t = getT()
  return `${t.common.pages(pageCount)} · ${t.home.recent.fileNotStored}`
}
