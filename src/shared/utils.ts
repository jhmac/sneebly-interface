export function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

export function fmtDuration(ms: number): string {
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`
}

// Converts a millisecond timestamp to a YYYY-MM-DD string in LOCAL time.
// Use this everywhere date strings are created or compared — never new Date(dateStr).getTime()
// because that parses as UTC midnight and causes off-by-one errors near midnight.
export function tsToDateKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Parse a YYYY-MM-DD date string as LOCAL midnight (not UTC midnight).
// Use this when the string came from a filename written by tsToDateKey,
// because `new Date(yyyymmdd).getTime()` parses as UTC and produces
// off-by-one-day errors near midnight in non-UTC timezones.
export function dateStrToLocalTs(s: string): number {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}
