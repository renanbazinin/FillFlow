/**
 * Compact, English-only relative time for the recents list ("just now", "5m ago", "2h ago",
 * "3d ago", "Mar 4"). The UI is English, so this ignores the browser locale.
 */
export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 45) return `${Math.max(1, m)}m ago`
  const h = Math.round(m / 60)
  if (h < 22) return `${h}h ago`
  const d = Math.max(1, Math.round(h / 24))
  if (d < 7) return `${d}d ago`
  const date = new Date(ts)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleDateString('en', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "3 pages · edited 2 hours ago" */
export function recentMetaLine(pageCount: number, editedAt: number, now = Date.now()): string {
  return `${pluralize(pageCount, 'page')} · edited ${relativeTime(editedAt, now)}`
}
