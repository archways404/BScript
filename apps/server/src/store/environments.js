import { iso, now, setClause } from './util.js'

function toEnvironment(row) {
  if (!row) return null
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    branchFilter: row.branch_filter,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

export function listEnvironments(db, projectId) {
  return db
    .prepare('SELECT * FROM environments WHERE project_id = ? ORDER BY name COLLATE NOCASE')
    .all(projectId)
    .map(toEnvironment)
}

export function getEnvironment(db, id) {
  return toEnvironment(db.prepare('SELECT * FROM environments WHERE id = ?').get(id))
}

export function createEnvironment(db, projectId, { name, branchFilter = '' }) {
  const result = db
    .prepare('INSERT INTO environments (project_id, name, branch_filter) VALUES (?, ?, ?)')
    .run(projectId, name, branchFilter)
  return getEnvironment(db, result.lastInsertRowid)
}

export function updateEnvironment(db, id, patch) {
  const { sql, params } = setClause(patch, { name: 'name', branchFilter: 'branch_filter' })
  if (sql) {
    db.prepare(`UPDATE environments SET ${sql}, updated_at = @updated_at WHERE id = @id`).run({
      ...params,
      updated_at: now(),
      id,
    })
  }
  return getEnvironment(db, id)
}

// Pipelines defaulting to it fall back to no environment (ON DELETE SET NULL).
export function deleteEnvironment(db, id) {
  return db.transaction(() => {
    db.prepare("DELETE FROM env_vars WHERE scope = 'environment' AND scope_id = ?").run(id)
    return db.prepare('DELETE FROM environments WHERE id = ?').run(id).changes > 0
  })()
}
