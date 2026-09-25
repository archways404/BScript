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

// Project vars overlaid with pipeline vars, decrypted, for a run.
export function resolveRunEnv(db, cipher, projectId, pipelineId) {
  const rows = db
    .prepare(
      `SELECT key, value_enc, is_secret FROM env_vars
       WHERE (scope = 'project' AND scope_id = ?) OR (scope = 'pipeline' AND scope_id = ?)
       ORDER BY scope = 'pipeline'`,
    )
    .all(projectId, pipelineId)
  const merged = new Map()
  for (const row of rows) {
    merged.set(row.key, { key: row.key, value: cipher.decrypt(row.value_enc), secret: Boolean(row.is_secret) })
  }
  return [...merged.values()]
}
