import crypto from 'node:crypto'
import { checkCredentials, getAdmin } from '../auth/admin.js'
import { verifyToken } from '../store/tokens.js'

const ADMIN_CACHE_MS = 60_000
export const RUN_USER = 'bscript-run'

function decodeBasic(header) {
  const encoded = header?.match(/^Basic\s+(.+)$/i)?.[1]
  if (!encoded) return null
  const decoded = Buffer.from(encoded, 'base64').toString('utf8')
  const colon = decoded.indexOf(':')
  return colon === -1 ? null : { user: decoded.slice(0, colon), password: decoded.slice(colon + 1) }
}

/**
 * Who may use the registry, via HTTP Basic (what `docker login` sends):
 *   - the admin user and password,
 *   - any user name with an API token (bst_…) as the password,
 *   - `bscript-run` with a token issued to one run, valid until it ends.
 *
 * Docker sends credentials on every request of a push, and scrypt is deliberately slow, so a
 * verified admin password is cached briefly, keyed to the session version so a password change
 * takes effect at once. API tokens are a cheap hash lookup and are never cached.
 */
export function createRegistryAuth({ db }) {
  const adminCache = new Map()
  const runTokens = new Map()

  return {
    issueRunToken(runId) {
      const token = `bsr_${crypto.randomBytes(24).toString('base64url')}`
      runTokens.set(token, runId)
      return token
    },

    revokeRunToken(token) {
      runTokens.delete(token)
    },

    async check(header) {
      const credentials = decodeBasic(header)
      if (!credentials) return null
      const { user, password } = credentials

      if (password.startsWith('bsr_')) {
        return user === RUN_USER && runTokens.has(password) ? { kind: 'run', runId: runTokens.get(password) } : null
      }
      if (password.startsWith('bst_')) {
        const token = verifyToken(db, password)
        return token ? { kind: 'token', name: token.name } : null
      }

      const key = crypto.createHash('sha256').update(`${getAdmin(db).sessionVersion}:${header}`).digest('hex')
      const cached = adminCache.get(key)
      if (cached && cached > Date.now()) return { kind: 'admin' }
      if (!(await checkCredentials(db, user, password))) return null
      adminCache.set(key, Date.now() + ADMIN_CACHE_MS)
      return { kind: 'admin' }
    },
  }
}
