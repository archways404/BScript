import { apiBase } from './docker-config.js'

const TIMEOUT_MS = 10_000

function parseChallenge(header) {
  const scheme = header.split(' ')[0]?.toLowerCase()
  const params = Object.fromEntries([...header.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]))
  return { scheme, ...params }
}

/**
 * Checks that a registry is reachable and the credentials work, the way a Docker client
 * logs in: GET /v2/, and on a Bearer challenge fetch a token from the realm with the
 * credentials (Docker Hub, GHCR, GitLab, ECR-style token auth), then retry.
 */
export async function pingRegistry({ url, username, password }) {
  const base = apiBase(url)
  const basic = username && password ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` : null
  const request = (target, auth) =>
    fetch(target, { headers: auth ? { authorization: auth } : {}, signal: AbortSignal.timeout(TIMEOUT_MS) })

  try {
    let res = await request(`${base}/v2/`, basic)
    if (res.status === 401) {
      const challenge = parseChallenge(res.headers.get('www-authenticate') ?? '')
      if (challenge.scheme !== 'bearer' || !challenge.realm) {
        return { ok: false, message: basic ? 'Credentials were rejected' : 'This registry requires credentials' }
      }
      const tokenUrl = new URL(challenge.realm)
      if (challenge.service) tokenUrl.searchParams.set('service', challenge.service)
      if (challenge.scope) tokenUrl.searchParams.set('scope', challenge.scope)
      const tokenRes = await request(tokenUrl, basic)
      if (!tokenRes.ok) return { ok: false, message: `Token request failed (${tokenRes.status}): credentials were rejected` }
      const body = await tokenRes.json()
      res = await request(`${base}/v2/`, `Bearer ${body.token ?? body.access_token}`)
    }
    if (res.ok) return { ok: true, message: `Connected to ${base}` }
    return { ok: false, message: `${base}/v2/ answered ${res.status}` }
  } catch (err) {
    return { ok: false, message: err.name === 'TimeoutError' ? `No answer from ${base} within 10s` : err.cause?.message ?? err.message }
  }
}
