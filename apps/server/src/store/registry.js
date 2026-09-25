import { getSetting, setSetting } from './settings.js'
import { iso, now, setClause } from './util.js'

// ---- Tags -----------------------------------------------------------------

function toTag(row) {
  return {
    repository: row.repository,
    tag: row.tag,
    digest: row.digest,
    mediaType: row.media_type,
    size: row.size,
    pushedAt: iso(row.pushed_at),
    lastPulledAt: iso(row.last_pulled_at),
  }
}

export function upsertTag(db, { repository, tag, digest, mediaType = null, size = null, pushedAt = now() }) {
  db.prepare(
    `INSERT INTO registry_tags (repository, tag, digest, media_type, size, pushed_at)
     VALUES (@repository, @tag, @digest, @mediaType, @size, @pushedAt)
     ON CONFLICT (repository, tag) DO UPDATE SET
       digest = excluded.digest, media_type = excluded.media_type,
       size = COALESCE(excluded.size, CASE WHEN registry_tags.digest = excluded.digest THEN registry_tags.size END),
       pushed_at = CASE WHEN registry_tags.digest = excluded.digest THEN registry_tags.pushed_at ELSE excluded.pushed_at END`,
  ).run({ repository, tag, digest, mediaType, size, pushedAt })
}

export function setDigestSize(db, repository, digest, size) {
  db.prepare('UPDATE registry_tags SET size = ? WHERE repository = ? AND digest = ?').run(size, repository, digest)
}

export function markPulled(db, repository, digest, at = now()) {
  db.prepare('UPDATE registry_tags SET last_pulled_at = ? WHERE repository = ? AND digest = ?').run(at, repository, digest)
}

export function removeTag(db, repository, tag) {
  db.prepare('DELETE FROM registry_tags WHERE repository = ? AND tag = ?').run(repository, tag)
}

export function removeDigest(db, repository, digest) {
  db.prepare('DELETE FROM registry_tags WHERE repository = ? AND digest = ?').run(repository, digest)
}

export function listTags(db, repository) {
  const rows = repository
    ? db.prepare('SELECT * FROM registry_tags WHERE repository = ? ORDER BY pushed_at DESC, tag').all(repository)
    : db.prepare('SELECT * FROM registry_tags ORDER BY repository, pushed_at DESC, tag').all()
  return rows.map(toTag)
}

// Per repository: tag count, distinct-image size, newest push. Sizes count each image once
// but shared layers between images more than once, so they overstate disk use a little.
export function listRepositories(db) {
  return db
    .prepare(
      `SELECT repository, COUNT(*) AS tags, MAX(pushed_at) AS last_pushed_at, MAX(last_pulled_at) AS last_pulled_at,
              (SELECT COALESCE(SUM(size), 0) FROM (SELECT DISTINCT digest, size FROM registry_tags d WHERE d.repository = t.repository)) AS size
       FROM registry_tags t GROUP BY repository ORDER BY repository`,
    )
    .all()
    .map((row) => ({
      repository: row.repository,
      tags: row.tags,
      size: row.size,
      lastPushedAt: iso(row.last_pushed_at),
      lastPulledAt: iso(row.last_pulled_at),
    }))
}

// Makes the metadata match what the registry actually holds (tags pushed or deleted while
// BScript was down, or notifications that never arrived).
export function syncTags(db, present, { discoveredAt = now() } = {}) {
  return db.transaction(() => {
    const known = new Map(listTags(db).map((t) => [`${t.repository}:${t.tag}`, t]))
    const seen = new Set()
    let added = 0
    for (const tag of present) {
      const key = `${tag.repository}:${tag.tag}`
      seen.add(key)
      const existing = known.get(key)
      if (!existing || existing.digest !== tag.digest) {
        upsertTag(db, { ...tag, pushedAt: discoveredAt })
        added++
      }
    }
    let removed = 0
    for (const [key, tag] of known) {
      if (!seen.has(key)) {
        removeTag(db, tag.repository, tag.tag)
        removed++
      }
    }
    return { added, removed }
  })()
}

// ---- Settings -------------------------------------------------------------

export const DEFAULT_RETENTION = {
  enabled: false,
  keepLast: 10,
  olderThanDays: 30,
  protect: 'latest, v*',
  schedule: '0 4 * * *',
  rules: [],
}

export function getRegistrySettings(db) {
  const stored = JSON.parse(getSetting(db, 'registry') ?? '{}')
  return {
    enabled: stored.enabled ?? true,
    publicPull: stored.publicPull ?? false,
    retention: { ...DEFAULT_RETENTION, ...stored.retention },
  }
}

export function saveRegistrySettings(db, patch) {
  const current = getRegistrySettings(db)
  const next = { ...current, ...patch, retention: { ...current.retention, ...patch.retention } }
  setSetting(db, 'registry', JSON.stringify(next))
  return next
}

// ---- External registries ---------------------------------------------------

function toRegistry(row) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    username: row.username,
    hasPassword: Boolean(row.password_enc),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

export function listExternalRegistries(db) {
  return db.prepare('SELECT * FROM registries ORDER BY name COLLATE NOCASE').all().map(toRegistry)
}

export function getExternalRegistry(db, id) {
  const row = db.prepare('SELECT * FROM registries WHERE id = ?').get(id)
  return row ? toRegistry(row) : null
}

export function getExternalRegistryCredentials(db, cipher, id) {
  const row = db.prepare('SELECT url, username, password_enc FROM registries WHERE id = ?').get(id)
  if (!row) return null
  return { url: row.url, username: row.username, password: row.password_enc ? cipher.decrypt(row.password_enc) : null }
}

export function listExternalRegistryCredentials(db, cipher) {
  return db
    .prepare('SELECT id FROM registries ORDER BY id')
    .pluck()
    .all()
    .map((id) => getExternalRegistryCredentials(db, cipher, id))
}

export function createExternalRegistry(db, cipher, { name, url, username = null, password = null }) {
  const result = db
    .prepare('INSERT INTO registries (name, url, username, password_enc) VALUES (?, ?, ?, ?)')
    .run(name, url, username || null, password ? cipher.encrypt(password) : null)
  return getExternalRegistry(db, result.lastInsertRowid)
}

// `password: undefined` keeps the stored one; null or '' clears it.
export function updateExternalRegistry(db, cipher, id, patch) {
  const values = { ...patch }
  if (patch.password !== undefined) values.passwordEnc = patch.password ? cipher.encrypt(patch.password) : null
  const { sql, params } = setClause(values, { name: 'name', url: 'url', username: 'username', passwordEnc: 'password_enc' })
  if (sql) {
    db.prepare(`UPDATE registries SET ${sql}, updated_at = @updated_at WHERE id = @id`).run({ ...params, updated_at: now(), id })
  }
  return getExternalRegistry(db, id)
}

export function deleteExternalRegistry(db, id) {
  return db.prepare('DELETE FROM registries WHERE id = ?').run(id).changes > 0
}

// ---- Cleanup history --------------------------------------------------------

function toCleanup(row) {
  return {
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    deletedTags: row.deleted_tags,
    freedBytes: row.freed_bytes,
    error: row.error,
    log: row.log,
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
  }
}

export function startCleanup(db, trigger) {
  const result = db.prepare('INSERT INTO registry_cleanups (trigger, started_at) VALUES (?, ?)').run(trigger, now())
  return result.lastInsertRowid
}

export function finishCleanup(db, id, { status, deletedTags, freedBytes = null, error = null, log = null }) {
  db.prepare(
    `UPDATE registry_cleanups SET status = ?, deleted_tags = ?, freed_bytes = ?, error = ?, log = ?, finished_at = ?
     WHERE id = ?`,
  ).run(status, deletedTags, freedBytes, error, log, now(), id)
}

export function listCleanups(db, limit = 20) {
  return db.prepare('SELECT * FROM registry_cleanups ORDER BY id DESC LIMIT ?').all(limit).map(toCleanup)
}

export function failInterruptedCleanups(db) {
  db.prepare("UPDATE registry_cleanups SET status = 'failed', error = 'Interrupted by server restart', finished_at = ? WHERE status = 'running'").run(now())
}
