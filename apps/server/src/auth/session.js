import crypto from 'node:crypto'

export const SESSION_COOKIE = 'bscript_session'
export const SESSION_TTL_SEC = 7 * 24 * 60 * 60

// Stateless signed cookie: base64url(payload).hmac. `version` ties sessions to the password;
// changing it bumps the version and logs out every other session.
export function createSessionSigner(secretKey) {
  const key = crypto.createHmac('sha256', secretKey).update('bscript-session').digest()
  const sign = (data) => crypto.createHmac('sha256', key).update(data).digest('base64url')

  return {
    issue({ user, version }) {
      const payload = Buffer.from(
        JSON.stringify({ user, version, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC }),
      ).toString('base64url')
      return `${payload}.${sign(payload)}`
    },

    verify(cookie) {
      if (!cookie) return null
      const [payload, signature] = cookie.split('.')
      if (!payload || !signature) return null
      const expected = Buffer.from(sign(payload))
      const actual = Buffer.from(signature)
      if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null
      try {
        const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
        return session.exp > Date.now() / 1000 ? session : null
      } catch {
        return null
      }
    },
  }
}
