import fs from 'node:fs'
import path from 'node:path'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'

const DEFAULT_WEB_DIST = path.resolve(import.meta.dirname, '../../web/dist')

export async function buildApp({ config, db, logger = true, webDist = process.env.BSCRIPT_WEB_DIST || DEFAULT_WEB_DIST }) {
  const app = Fastify({ logger })
  app.decorate('config', config)
  app.decorate('db', db)

  app.get('/api/health', async () => ({
    ok: true,
    db: db.prepare('SELECT 1 AS ok').get().ok === 1,
  }))

  // Serve the built UI when it exists; in development Vite serves it and proxies /api here.
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist })
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' })
      return reply.sendFile('index.html')
    })
  }

  return app
}
