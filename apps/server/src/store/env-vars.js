export function listEnvVars(db, cipher, scope, scopeId) {
  return db
    .prepare('SELECT key, value_enc, is_secret FROM env_vars WHERE scope = ? AND scope_id = ? ORDER BY key')
    .all(scope, scopeId)
    .map((row) => ({
      key: row.key,
      secret: Boolean(row.is_secret),
      // Secret values are write-only through the API.
      value: row.is_secret ? null : cipher.decrypt(row.value_enc),
    }))
}

export function setEnvVar(db, cipher, scope, scopeId, { key, value, secret = false }) {
  db.prepare(
    `INSERT INTO env_vars (scope, scope_id, key, value_enc, is_secret) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (scope, scope_id, key) DO UPDATE SET value_enc = excluded.value_enc, is_secret = excluded.is_secret`,
  ).run(scope, scopeId, key, cipher.encrypt(value), secret ? 1 : 0)
}

export function deleteEnvVar(db, scope, scopeId, key) {
  return db.prepare('DELETE FROM env_vars WHERE scope = ? AND scope_id = ? AND key = ?').run(scope, scopeId, key)
    .changes > 0
}

// Keys set at each level, without values: what the requirements checklist compares against.
export function listEnvKeys(db, scope, scopeId) {
  return db.prepare('SELECT key FROM env_vars WHERE scope = ? AND scope_id = ? ORDER BY key').pluck().all(scope, scopeId)
}

// Decrypted vars for a run: project, then pipeline, then environment, later levels winning.
// The environment is the per-run choice of target, so it overrides pipeline defaults.
export function resolveRunEnv(db, cipher, projectId, pipelineId, environmentId = null) {
  const rows = db
    .prepare(
      `SELECT key, value_enc, is_secret FROM env_vars
       WHERE (scope = 'project' AND scope_id = @projectId)
          OR (scope = 'pipeline' AND scope_id = @pipelineId)
          OR (scope = 'environment' AND scope_id = @environmentId)
       ORDER BY CASE scope WHEN 'project' THEN 0 WHEN 'pipeline' THEN 1 ELSE 2 END`,
    )
    .all({ projectId, pipelineId, environmentId: environmentId ?? -1 })
  const merged = new Map()
  for (const row of rows) {
    merged.set(row.key, { key: row.key, value: cipher.decrypt(row.value_enc), secret: Boolean(row.is_secret) })
  }
  return [...merged.values()]
}
