import crypto from 'node:crypto'
import { iso, now, setClause } from './util.js'

function toProject(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    repoUrl: row.repo_url,
    defaultBranch: row.default_branch,
    authType: row.auth_type,
    hasCredential: Boolean(row.credential_enc),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

export function listProjects(db) {
  return db.prepare('SELECT * FROM projects ORDER BY name COLLATE NOCASE').all().map(toProject)
}

export function getProject(db, id) {
  return toProject(db.prepare('SELECT * FROM projects WHERE id = ?').get(id))
}

// Decrypted credentials for git; never returned by the API.
export function getProjectAuth(db, cipher, id) {
  const row = db.prepare('SELECT auth_type, credential_enc FROM projects WHERE id = ?').get(id)
  if (!row || row.auth_type === 'none' || !row.credential_enc) return { type: 'none' }
  const credential = cipher.decrypt(row.credential_enc)
  return row.auth_type === 'token'
    ? { type: 'token', token: credential }
    : { type: 'ssh', privateKey: credential }
}

export function getWebhookSecret(db, cipher, id) {
  const row = db.prepare('SELECT webhook_secret_enc FROM projects WHERE id = ?').get(id)
  return row ? cipher.decrypt(row.webhook_secret_enc) : null
}

export function rotateWebhookSecret(db, cipher, id) {
  const secret = crypto.randomBytes(24).toString('hex')
  db.prepare('UPDATE projects SET webhook_secret_enc = ?, updated_at = ? WHERE id = ?').run(
    cipher.encrypt(secret),
    now(),
    id,
  )
  return secret
}

export function createProject(db, cipher, { name, repoUrl, defaultBranch = 'main', authType = 'none', credential }) {
  const result = db
    .prepare(
      `INSERT INTO projects (name, repo_url, default_branch, auth_type, credential_enc, webhook_secret_enc)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      name,
      repoUrl,
      defaultBranch,
      authType,
      credential ? cipher.encrypt(credential) : null,
      cipher.encrypt(crypto.randomBytes(24).toString('hex')),
    )
  return getProject(db, result.lastInsertRowid)
}

// `credential: undefined` keeps the stored one; `null` or '' clears it.
export function updateProject(db, cipher, id, patch) {
  const values = { ...patch }
  if (patch.credential !== undefined) {
    values.credentialEnc = patch.credential ? cipher.encrypt(patch.credential) : null
  }
  const { sql, params } = setClause(values, {
    name: 'name',
    repoUrl: 'repo_url',
    defaultBranch: 'default_branch',
    authType: 'auth_type',
    credentialEnc: 'credential_enc',
  })
  if (sql) {
    db.prepare(`UPDATE projects SET ${sql}, updated_at = @updated_at WHERE id = @id`).run({
      ...params,
      updated_at: now(),
      id,
    })
  }
  return getProject(db, id)
}

// Returns the ids of the runs that went with it, so the caller can remove their logs.
export function deleteProject(db, id) {
  return db.transaction(() => {
    const pipelineIds = db.prepare('SELECT id FROM pipelines WHERE project_id = ?').pluck().all(id)
    const runIds = db
      .prepare('SELECT r.id FROM runs r JOIN pipelines p ON p.id = r.pipeline_id WHERE p.project_id = ?')
      .pluck()
      .all(id)
    const environmentIds = db.prepare('SELECT id FROM environments WHERE project_id = ?').pluck().all(id)
    const deleteEnv = db.prepare('DELETE FROM env_vars WHERE scope = ? AND scope_id = ?')
    deleteEnv.run('project', id)
    for (const pipelineId of pipelineIds) deleteEnv.run('pipeline', pipelineId)
    for (const environmentId of environmentIds) deleteEnv.run('environment', environmentId)
    const { changes } = db.prepare('DELETE FROM projects WHERE id = ?').run(id)
    return changes ? runIds : null
  })()
}
