import { iso, now, setClause } from './util.js'

const DEFAULT_TRIGGERS = { manual: true, push: false, pull_request: false, cron: false }

function toStep(row) {
  return {
    id: row.id,
    position: row.position,
    name: row.name,
    scriptPath: row.script_path,
    continueOnError: Boolean(row.continue_on_error),
    timeoutSec: row.timeout_sec,
  }
}

function toPipeline(row, steps) {
  if (!row) return null
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    branchFilter: row.branch_filter,
    triggers: { ...DEFAULT_TRIGGERS, ...JSON.parse(row.triggers) },
    cronExpr: row.cron_expr,
    enabled: Boolean(row.enabled),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    ...(steps && { steps }),
  }
}

export function listPipelines(db, projectId) {
  return db
    .prepare('SELECT * FROM pipelines WHERE project_id = ? ORDER BY name COLLATE NOCASE')
    .all(projectId)
    .map((row) => toPipeline(row))
}

export function getSteps(db, pipelineId) {
  return db
    .prepare('SELECT * FROM pipeline_steps WHERE pipeline_id = ? ORDER BY position')
    .all(pipelineId)
    .map(toStep)
}

export function getPipeline(db, id) {
  const row = db.prepare('SELECT * FROM pipelines WHERE id = ?').get(id)
  return row ? toPipeline(row, getSteps(db, id)) : null
}

export function replaceSteps(db, pipelineId, steps) {
  db.transaction(() => {
    db.prepare('DELETE FROM pipeline_steps WHERE pipeline_id = ?').run(pipelineId)
    const insert = db.prepare(
      `INSERT INTO pipeline_steps (pipeline_id, position, name, script_path, continue_on_error, timeout_sec)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    steps.forEach((step, position) =>
      insert.run(
        pipelineId,
        position,
        step.name || step.scriptPath,
        step.scriptPath,
        step.continueOnError ? 1 : 0,
        step.timeoutSec ?? 3600,
      ),
    )
    db.prepare('UPDATE pipelines SET updated_at = ? WHERE id = ?').run(now(), pipelineId)
  })()
  return getSteps(db, pipelineId)
}

export function createPipeline(db, projectId, { name, branchFilter = '*', triggers, cronExpr = null, enabled = true, steps = [] }) {
  return db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO pipelines (project_id, name, branch_filter, triggers, cron_expr, enabled)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(projectId, name, branchFilter, JSON.stringify({ ...DEFAULT_TRIGGERS, ...triggers }), cronExpr, enabled ? 1 : 0)
    if (steps.length) replaceSteps(db, result.lastInsertRowid, steps)
    return getPipeline(db, result.lastInsertRowid)
  })()
}

export function updatePipeline(db, id, patch) {
  const current = getPipeline(db, id)
  if (!current) return null
  const values = {
    ...patch,
    triggers: patch.triggers && JSON.stringify({ ...current.triggers, ...patch.triggers }),
    enabled: patch.enabled === undefined ? undefined : patch.enabled ? 1 : 0,
  }
  const { sql, params } = setClause(values, {
    name: 'name',
    branchFilter: 'branch_filter',
    triggers: 'triggers',
    cronExpr: 'cron_expr',
    enabled: 'enabled',
  })
  if (sql) {
    db.prepare(`UPDATE pipelines SET ${sql}, updated_at = @updated_at WHERE id = @id`).run({
      ...params,
      updated_at: now(),
      id,
    })
  }
  return getPipeline(db, id)
}

export function deletePipeline(db, id) {
  return db.transaction(() => {
    const runIds = db.prepare('SELECT id FROM runs WHERE pipeline_id = ?').pluck().all(id)
    db.prepare("DELETE FROM env_vars WHERE scope = 'pipeline' AND scope_id = ?").run(id)
    const { changes } = db.prepare('DELETE FROM pipelines WHERE id = ?').run(id)
    return changes ? runIds : null
  })()
}
