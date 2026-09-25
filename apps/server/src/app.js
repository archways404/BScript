import fs from 'node:fs'
import path from 'node:path'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import { getAdmin } from './auth/admin.js'
import { SESSION_COOKIE, createSessionSigner } from './auth/session.js'
import authRoutes from './routes/auth.js'
import envRoutes from './routes/env.js'
import environmentRoutes from './routes/environments.js'
import pipelineRoutes from './routes/pipelines.js'
import projectRoutes from './routes/projects.js'
import registryRoutes from './routes/registry.js'
import registryProxyRoutes from './routes/registry-proxy.js'
import requirementRoutes from './routes/requirements.js'
import runRoutes from './routes/runs.js'
import tokenRoutes from './routes/tokens.js'
import webhookRoutes from './routes/webhooks.js'
import { verifyToken } from './store/tokens.js'

const DEFAULT_WEB_DIST = path.resolve(import.meta.dirname, '../../web/dist')
// Webhooks authenticate with the project's HMAC secret instead.
const PUBLIC_ROUTES = new Set([
  '/api/health',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/hooks/github/:id',
  // Authenticated by the registry process's per-start secret.
  '/api/internal/registry/events',
])

export async function buildApp({
  config,
  db,
  cipher,
  secretKey,
  queue,
  scheduler = null,
  registry = null,
  logger = true,
  webDist = process.env.BSCRIPT_WEB_DIST || DEFAULT_WEB_DIST,
}) {
  // requestTimeout 0: image layer uploads through the registry proxy can take minutes.
  const app = Fastify({ logger, trustProxy: true, requestTimeout: 0 })
  app.decorate('config', config)
  app.decorate('db', db)
  app.decorate('cipher', cipher)
  app.decorateRequest('auth', null)
  await app.register(fastifyCookie)

  const sessions = createSessionSigner(secretKey)

  // Every /api route needs a session cookie or an API token (Authorization: Bearer bst_...),
  // except the few public ones. Routes marked sessionOnly (tokens, password) refuse tokens;
  // routes marked optionalAuth run with request.auth = null instead of getting a 401.
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/') || PUBLIC_ROUTES.has(request.routeOptions.url)) return

    const bearer = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
    if (bearer) {
      const token = verifyToken(db, bearer)
      if (!token) return reply.code(401).send({ error: 'Invalid API token' })
      if (request.routeOptions.config?.sessionOnly) {
        return reply.code(403).send({ error: 'API tokens cannot access this route' })
      }
      request.auth = { via: 'token', tokenName: token.name }
      return
    }

    const session = sessions.verify(request.cookies[SESSION_COOKIE])
    const admin = session && getAdmin(db)
    if (!session || session.user !== admin.user || session.version !== admin.sessionVersion) {
      if (request.routeOptions.config?.optionalAuth) return
      return reply.code(401).send({ error: 'Not logged in' })
    }
    request.auth = { via: 'session', user: session.user }
  })

  app.setErrorHandler((err, request, reply) => {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return reply.code(409).send({ error: 'A record with that name already exists' })
    }
    const status = err.statusCode ?? 500
    if (status >= 500) request.log.error(err)
    return reply.code(status).send({ error: status >= 500 && !err.statusCode ? 'Internal server error' : err.message })
  })

  app.get('/api/health', async () => ({
    ok: true,
    db: db.prepare('SELECT 1 AS ok').get().ok === 1,
  }))

  await app.register(authRoutes, { sessions })
  await app.register(projectRoutes, { scheduler })
  await app.register(pipelineRoutes, { scheduler })
  await app.register(envRoutes)
  await app.register(environmentRoutes)
  await app.register(requirementRoutes)
  await app.register(runRoutes, { queue })
  await app.register(tokenRoutes)
  await app.register(webhookRoutes, { queue })
  if (registry) {
    await app.register(registryRoutes, { registry })
    await app.register(registryProxyRoutes, { registry })
  }

  // Serve the built UI when it exists; in development Vite serves it and proxies /api here.
  const hasUi = fs.existsSync(path.join(webDist, 'index.html'))
  if (hasUi) await app.register(fastifyStatic, { root: webDist })
  app.setNotFoundHandler((request, reply) => {
    if (!hasUi || request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' })
    return reply.sendFile('index.html')
  })

  return app
}
