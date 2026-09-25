import { iso, now, setClause } from './util.js'

const FINISHED = "('success', 'failed', 'cancelled')"

function toStepRun(row) {
  return {
    position: row.position,
    name: row.name,
    scriptPath: row.script_path,
    status: row.status,
    exitCode: row.exit_code,
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
  }
}

function toRun(row) {
  if (!row) return null
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    pipelineName: row.pipeline_name,
    projectId: row.project_id,
    projectName: row.project_name,
    status: row.status,
    trigger: row.trigger,
    ref: row.ref,
    commitSha: row.commit_sha,
    fromFork: Boolean(row.from_fork),
    triggeredBy: row.triggered_by,
    error: row.error,
    queuedAt: iso(row.queued_at),
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
  }
}

const SELECT_RUN = `
  SELECT r.*, p.name AS pipeline_name, p.project_id, pr.name AS project_name
  FROM runs r
  JOIN pipelines p ON p.id = r.pipeline_id
  JOIN projects pr ON pr.id = p.project_id`

export function createRun(db, { pipelineId, trigger, ref, fromFork = false, triggeredBy = null }) {
  const result = db
    .prepare(
      `INSERT INTO runs (pipeline_id, trigger, ref, from_fork, triggered_by, queued_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(pipelineId, trigger, ref, fromFork ? 1 : 0, triggeredBy, now())
  return getRun(db, result.lastInsertRowid)
}

export function getRun(db, id, { withSteps = false } = {}) {
  const run = toRun(db.prepare(`${SELECT_RUN} WHERE r.id = ?`).get(id))
  if (run && withSteps) run.steps = getStepRuns(db, id)
  return run
}

export function getStepRuns(db, runId) {
  return db.prepare('SELECT * FROM step_runs WHERE run_id = ? ORDER BY position').all(runId).map(toStepRun)
}

export function getStepLogPath(db, runId, position) {
  return db.prepare('SELECT log_path FROM step_runs WHERE run_id = ? AND position = ?').pluck().get(runId, position)
}

export function listRuns(db, { pipelineId, projectId, status, before, limit = 50 } = {}) {
  const where = []
  const params = {}
  if (pipelineId) (where.push('r.pipeline_id = @pipelineId'), (params.pipelineId = pipelineId))
  if (projectId) (where.push('p.project_id = @projectId'), (params.projectId = projectId))
  if (status) (where.push('r.status = @status'), (params.status = status))
  if (before) (where.push('r.id < @before'), (params.before = before))
  const sql = `${SELECT_RUN} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.id DESC LIMIT @limit`
  return db.prepare(sql).all({ ...params, limit }).map(toRun)
}

// The oldest queued run whose pipeline has nothing running: one active run per pipeline.
export function nextStartableRun(db) {
  return db
    .prepare(
      `SELECT id FROM runs r WHERE status = 'queued'
       AND NOT EXISTS (SELECT 1 FROM runs x WHERE x.pipeline_id = r.pipeline_id AND x.status = 'running')
       ORDER BY id LIMIT 1`,
    )
    .pluck()
    .get()
}

export function updateRun(db, id, patch) {
  const { sql, params } = setClause(patch, {
    status: 'status',
    commitSha: 'commit_sha',
    error: 'error',
    startedAt: 'started_at',
    finishedAt: 'finished_at',
  })
  if (sql) db.prepare(`UPDATE runs SET ${sql} WHERE id = @id`).run({ ...params, id })
}

export function createStepRuns(db, runId, steps, logPathFor) {
  const insert = db.prepare(
    `INSERT INTO step_runs (run_id, step_id, position, name, script_path, log_path)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  steps.forEach((step, position) =>
    insert.run(runId, step.id ?? null, position, step.name, step.scriptPath, logPathFor(position)),
  )
}

export function updateStepRun(db, runId, position, patch) {
  const { sql, params } = setClause(patch, {
    status: 'status',
    exitCode: 'exit_code',
    startedAt: 'started_at',
    finishedAt: 'finished_at',
  })
  if (sql) {
    db.prepare(`UPDATE step_runs SET ${sql} WHERE run_id = @runId AND position = @position`).run({
      ...params,
      runId,
      position,
    })
  }
}

// Runs left 'running' by a crash or restart can never finish; close them out.
export function failInterruptedRuns(db) {
  return db.transaction(() => {
    const ids = db.prepare("SELECT id FROM runs WHERE status = 'running'").pluck().all()
    const at = now()
    for (const id of ids) {
      db.prepare("UPDATE step_runs SET status = 'failed', finished_at = ? WHERE run_id = ? AND status = 'running'").run(at, id)
      db.prepare("UPDATE step_runs SET status = 'skipped' WHERE run_id = ? AND status = 'pending'").run(id)
      db.prepare("UPDATE runs SET status = 'failed', error = 'Interrupted by server restart', finished_at = ? WHERE id = ?").run(at, id)
    }
    return ids
  })()
}

// Keeps the newest `keep` finished runs of a pipeline; returns the ids it deleted.
export function pruneRuns(db, pipelineId, keep) {
  return db.transaction(() => {
    const ids = db
      .prepare(`SELECT id FROM runs WHERE pipeline_id = ? AND status IN ${FINISHED} ORDER BY id DESC LIMIT -1 OFFSET ?`)
      .pluck()
      .all(pipelineId, keep)
    const remove = db.prepare('DELETE FROM runs WHERE id = ?')
    for (const id of ids) remove.run(id)
    return ids
  })()
}
