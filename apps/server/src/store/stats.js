import { iso } from './util.js'

const DAY_MS = 24 * 60 * 60 * 1000

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Dashboard numbers: what's running now, the last 24 hours, the last 7 days, and runs per
 * day for the last `days` days (UTC days, oldest first, zero-filled).
 */
export function runStats(db, { days = 14, now = Date.now() } = {}) {
  const count = (sql, ...params) => db.prepare(sql).pluck().get(...params)
  const since = (ms) => new Date(now - ms).toISOString()

  const dayStart = new Date(now)
  dayStart.setUTCHours(0, 0, 0, 0)
  const firstDay = new Date(dayStart.getTime() - (days - 1) * DAY_MS)
  const rows = db
    .prepare(
      `SELECT substr(queued_at, 1, 10) AS day, status, COUNT(*) AS n FROM runs
       WHERE queued_at >= ? GROUP BY day, status`,
    )
    .all(firstDay.toISOString())
  const daily = Array.from({ length: days }, (_, i) => {
    const date = new Date(firstDay.getTime() + i * DAY_MS).toISOString().slice(0, 10)
    return { date, total: 0, success: 0, failed: 0, cancelled: 0 }
  })
  const byDate = new Map(daily.map((d) => [d.date, d]))
  for (const row of rows) {
    const day = byDate.get(row.day)
    if (!day) continue
    day.total += row.n
    if (row.status in day) day[row.status] += row.n
  }

  const weekFinished = db
    .prepare(
      `SELECT status, started_at, finished_at FROM runs
       WHERE finished_at >= ? AND status IN ('success', 'failed')`,
    )
    .all(since(7 * DAY_MS))
  const succeeded = weekFinished.filter((r) => r.status === 'success')
  const durations = succeeded
    .filter((r) => r.started_at)
    .map((r) => (Date.parse(iso(r.finished_at)) - Date.parse(iso(r.started_at))) / 1000)

  return {
    running: count("SELECT COUNT(*) FROM runs WHERE status = 'running'"),
    queued: count("SELECT COUNT(*) FROM runs WHERE status = 'queued'"),
    last24h: {
      total: count('SELECT COUNT(*) FROM runs WHERE queued_at >= ?', since(DAY_MS)),
      failed: count("SELECT COUNT(*) FROM runs WHERE queued_at >= ? AND status = 'failed'", since(DAY_MS)),
    },
    // Cancelled runs say nothing about health, so they're left out of the rate.
    successRate7d: weekFinished.length ? succeeded.length / weekFinished.length : null,
    medianDurationSec7d: median(durations),
    daily,
  }
}
