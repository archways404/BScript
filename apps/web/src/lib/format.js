const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const UNITS = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
]

export function timeAgo(iso, now = Date.now()) {
  if (!iso) return '—'
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
  if (Math.abs(seconds) < 10) return 'just now'
  const [unit, size] = UNITS.find(([, s]) => Math.abs(seconds) >= s) ?? UNITS.at(-1)
  return rtf.format(Math.round(seconds / size), unit)
}

export function duration(startIso, endIso, now = Date.now()) {
  if (!startIso) return '—'
  const total = Math.max(0, Math.round(((endIso ? new Date(endIso).getTime() : now) - new Date(startIso).getTime()) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m ${s}s`
  return `${s}s`
}

export function shortSha(sha) {
  return sha ? sha.slice(0, 7) : null
}

export const FINISHED = new Set(['success', 'failed', 'cancelled'])
