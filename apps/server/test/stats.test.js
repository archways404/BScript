import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openDatabase } from '../src/db/index.js'
import { runStats } from '../src/store/stats.js'

test('runStats counts today, the week and per day, with zero-filled days', () => {
  const db = openDatabase(':memory:')
  db.prepare("INSERT INTO projects (name, repo_url) VALUES ('p', 'x')").run()
  db.prepare("INSERT INTO pipelines (project_id, name) VALUES (1, 'ci')").run()
  const now = Date.parse('2026-09-25T12:00:00Z')
  const insert = db.prepare(
    "INSERT INTO runs (pipeline_id, trigger, ref, status, queued_at, started_at, finished_at) VALUES (1, 'manual', 'main', ?, ?, ?, ?)",
  )
  const at = (hoursAgo, extraSec = 0) => new Date(now - hoursAgo * 3600_000 + extraSec * 1000).toISOString()
  insert.run('success', at(1), at(1), at(1, 60))
  insert.run('success', at(2), at(2), at(2, 120))
  insert.run('failed', at(3), at(3), at(3, 30))
  insert.run('cancelled', at(30), at(30), at(30, 5))
  insert.run('running', at(0), at(0), null)
  insert.run('success', at(24 * 20), at(24 * 20), at(24 * 20, 10))

  const stats = runStats(db, { now })
  assert.equal(stats.running, 1)
  assert.deepEqual(stats.last24h, { total: 4, failed: 1 })
  assert.equal(stats.successRate7d, 2 / 3, 'cancelled runs are not in the rate')
  assert.equal(stats.medianDurationSec7d, 90)
  assert.equal(stats.daily.length, 14)
  assert.equal(stats.daily.at(-1).date, '2026-09-25')
  assert.deepEqual(stats.daily.at(-1), { date: '2026-09-25', total: 4, success: 2, failed: 1, cancelled: 0 })
  assert.equal(stats.daily.at(-2).cancelled, 1)
  assert.equal(stats.daily.reduce((sum, d) => sum + d.total, 0), 5, 'the 20-day-old run is outside the window')
})
