import { Cron } from 'croner'
import { hasQueuedRun } from '../store/runs.js'

export function cronError(expr) {
  try {
    new Cron(expr, { paused: true }).stop()
    return null
  } catch (err) {
    return err.message
  }
}

/**
 * Runs pipelines on their cron expression, in the server's time zone (TZ). Call sync() after
 * any pipeline change; it diffs the wanted schedules against the running jobs.
 *
 * A tick is skipped while an earlier scheduled run of the same pipeline is still queued, so a
 * slow pipeline on a tight schedule doesn't pile up runs.
 */
export function createScheduler({ db, queue, log = console }) {
  const jobs = new Map()

  function fire(pipelineId) {
    if (hasQueuedRun(db, pipelineId, 'cron')) {
      log.info({ pipelineId }, 'Scheduled run skipped: previous one still queued')
      return
    }
    try {
      queue.enqueue({ pipelineId, trigger: 'cron', triggeredBy: 'schedule' })
    } catch (err) {
      log.warn({ pipelineId, err: err.message }, 'Scheduled run not started')
    }
  }

  function wantedSchedules() {
    const wanted = new Map()
    for (const row of db.prepare('SELECT id, cron_expr, triggers, enabled FROM pipelines').all()) {
      if (row.enabled && row.cron_expr && JSON.parse(row.triggers).cron) wanted.set(row.id, row.cron_expr)
    }
    return wanted
  }

  return {
    sync() {
      const wanted = wantedSchedules()
      for (const [id, { expr, job }] of jobs) {
        if (wanted.get(id) !== expr) {
          job.stop()
          jobs.delete(id)
        }
      }
      for (const [id, expr] of wanted) {
        if (jobs.has(id)) continue
        try {
          jobs.set(id, { expr, job: new Cron(expr, { protect: true }, () => fire(id)) })
        } catch (err) {
          log.warn({ pipelineId: id, err: err.message }, 'Invalid cron expression')
        }
      }
    },

    nextRunAt(pipelineId) {
      return jobs.get(pipelineId)?.job.nextRun()?.toISOString() ?? null
    },

    stop() {
      for (const { job } of jobs.values()) job.stop()
      jobs.clear()
    },

    // Exposed for tests.
    fire,
  }
}
