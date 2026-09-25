import http from 'node:http'
import { createLoginLimiter } from '../auth/rate-limit.js'
import { getRegistrySettings } from '../store/registry.js'

const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']
const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'upgrade', 'authorization']

function registryError(reply, status, code, message, headers = {}) {
  return reply
    .code(status)
    .headers({ 'docker-distribution-api-version': 'registry/2.0', ...headers })
    .type('application/json')
    .send({ errors: [{ code, message }] })
}

// Streams the request to the registry and its answer back, untouched, bodies included.
function forward(request, reply, upstream, onDone) {
  reply.hijack()
  const headers = { ...request.headers }
  for (const name of HOP_BY_HOP) delete headers[name]
  headers['x-forwarded-for'] = request.ip
  headers['x-forwarded-proto'] = request.protocol
  headers['x-forwarded-host'] = request.headers.host

  const proxied = http.request({ ...upstream, method: request.method, path: request.raw.url, headers }, (res) => {
    const out = { ...res.headers }
    delete out.connection
    delete out['keep-alive']
    reply.raw.writeHead(res.statusCode, out)
    res.pipe(reply.raw)
  })
  proxied.on('error', (err) => {
    if (!reply.raw.headersSent) {
      reply.raw.writeHead(502, { 'content-type': 'application/json' })
      reply.raw.end(JSON.stringify({ errors: [{ code: 'UNAVAILABLE', message: `Registry unreachable: ${err.message}` }] }))
    } else {
      reply.raw.destroy(err)
    }
  })
  reply.raw.on('close', () => {
    if (!proxied.writableFinished || !reply.raw.writableFinished) proxied.destroy()
    onDone()
  })
  request.raw.pipe(proxied)
}

/**
 * The registry API at /v2/, on BScript's own port, so `docker login bscript.example.com`
 * works. Authenticates with HTTP Basic (see registry/auth.js), optionally lets anyone pull,
 * and pauses writes while maintenance (garbage collection) runs.
 */
export default async function registryProxyRoutes(app, { registry }) {
  const limiter = createLoginLimiter({ max: 30 })

  // Bodies (layers, manifests) are streamed through, never parsed.
  app.removeAllContentTypeParsers()
  app.addContentTypeParser('*', (request, payload, done) => done(null))

  async function handler(request, reply) {
    const settings = getRegistrySettings(app.db)
    if (!settings.enabled) return registryError(reply, 404, 'UNSUPPORTED', 'The registry is turned off')

    const readOnly = request.method === 'GET' || request.method === 'HEAD'
    if (limiter.blocked(request.ip)) return registryError(reply, 429, 'TOOMANYREQUESTS', 'Too many failed logins')

    const access = request.headers.authorization ? await registry.auth.check(request.headers.authorization) : null
    if (request.headers.authorization && !access) limiter.fail(request.ip)
    if (!access && !(settings.publicPull && readOnly)) {
      return registryError(reply, 401, 'UNAUTHORIZED', 'authentication required', {
        'www-authenticate': 'Basic realm="BScript Registry"',
      })
    }
    if (access?.kind === 'run' && request.method === 'DELETE') {
      return registryError(reply, 403, 'DENIED', 'Run credentials cannot delete images')
    }

    const upstream = registry.process.upstream
    if (!upstream) {
      return registryError(reply, 503, 'UNAVAILABLE', `Registry is ${registry.process.status().state}`, { 'retry-after': '10' })
    }
    if (!readOnly && !registry.beginWrite()) {
      return registryError(reply, 503, 'UNAVAILABLE', 'Registry maintenance in progress, try again shortly', { 'retry-after': '30' })
    }
    forward(request, reply, upstream, readOnly ? () => {} : once(() => registry.endWrite()))
  }

  for (const url of ['/v2', '/v2/', '/v2/*']) {
    app.route({ method: METHODS, url, handler, exposeHeadRoute: false })
  }
}

function once(fn) {
  let called = false
  return () => {
    if (!called) {
      called = true
      fn()
    }
  }
}
