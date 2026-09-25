import crypto from 'node:crypto'
import { iso, now } from './util.js'

const PREFIX = 'bst_'

function hash(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function toToken(row) {
  return { id: row.id, name: row.name, createdAt: iso(row.created_at), lastUsedAt: iso(row.last_used_at) }
}

export function listTokens(db) {
  return db.prepare('SELECT * FROM api_tokens ORDER BY id DESC').all().map(toToken)
}

// The raw token is returned once; only its hash is stored.
export function createToken(db, name) {
  const token = PREFIX + crypto.randomBytes(32).toString('base64url')
  const result = db.prepare('INSERT INTO api_tokens (name, token_hash) VALUES (?, ?)').run(name, hash(token))
  return { ...toToken(db.prepare('SELECT * FROM api_tokens WHERE id = ?').get(result.lastInsertRowid)), token }
}

export function deleteToken(db, id) {
  return db.prepare('DELETE FROM api_tokens WHERE id = ?').run(id).changes > 0
}

export function verifyToken(db, token) {
  if (!token?.startsWith(PREFIX)) return null
  const row = db.prepare('SELECT * FROM api_tokens WHERE token_hash = ?').get(hash(token))
  if (!row) return null
  db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(now(), row.id)
  return toToken(row)
}
