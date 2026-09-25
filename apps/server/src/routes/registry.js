import crypto from 'node:crypto'
import { HttpError, notFound } from '../http-error.js'
import { pingRegistry } from '../registry/ping.js'
import {
  createExternalRegistry,
  deleteExternalRegistry,
  getExternalRegistry,
  getExternalRegistryCredentials,
  getRegistrySettings,
  listCleanups,
  listExternalRegistries,
  listTags,
  saveRegistrySettings,
  updateExternalRegistry,
} from '../store/registry.js'
import { cronError } from '../triggers/scheduler.js'
import { idParams, name } from './schemas.js'

const limit = { type: ['integer', 'null'], minimum: 0, maximum: 100000 }
const ruleSchema = {
  type: 'object',
  required: ['repository'],
  additionalProperties: false,
  properties: {
    repository: { type: 'string', minLength: 1, maxLength: 255 },
    keepForever: { type: 'boolean' },
    keepLast: limit,
    olderThanDays: limit,
    protect: { type: 'string', maxLength: 500 },
  },
}
const settingsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    enabled: { type: 'boolean' },
    publicPull: { type: 'boolean' },
    retention: {
      type: 'object',
      additionalProperties: false,
      properties: {
        enabled: { type: 'boolean' },
        keepLast: limit,
        olderThanDays: limit,
        protect: { type: 'string', maxLength: 500 },
        schedule: { type: 'string', maxLength: 100 },
        rules: { type: 'array', maxItems: 50, items: ruleSchema },
      },
    },
  },
}
const registryFields = {
  name,
  url: { type: 'string', minLength: 1, maxLength: 500 },
  username: { type: ['string', 'null'], maxLength: 255 },
  password: { type: ['string', 'null'], maxLength: 10000 },
}
const tagItems = {
  type: 'array',
  minItems: 1,
  maxItems: 1000,
  items: {
    type: 'object',
    required: ['repository', 'tag'],
    additionalProperties: false,
    properties: { repository: { type: 'string', minLength: 1 }, tag: { type: 'string', minLength: 1 } },
  },
}

export default async function registryRoutes(app, { registry }) {
  const { db, cipher } = app
  const sessionOnly = { sessionOnly: true }

  // ---- Bundled registry ----------------------------------------------------

  app.get('/api/registry', async () => registry.overview())

  app.get(
    '/api/registry/tags',
    { schema: { querystring: { type: 'object', required: ['repository'], properties: { repository: { type: 'string' } } } } },
    async (request) => listTags(db, request.query.repository),
  )

  app.post('/api/registry/sync', async () => registry.sync())

  app.post('/api/registry/tags/delete', { schema: { body: { type: 'object', required: ['items'], properties: { items: tagItems } } } }, async (request) =>
    registry.deleteTags(request.body.items),
  )

  app.put('/api/registry/settings', { config: sessionOnly, schema: { body: settingsSchema } }, async (request) => {
    const schedule = request.body.retention?.schedule
    if (schedule) {
      const error = cronError(schedule)
      if (error) throw new HttpError(400, `Invalid cleanup schedule: ${error}`)
    }
    const saved = saveRegistrySettings(db, request.body)
    await registry.applySettings()
    return saved
  })

  app.get('/api/registry/cleanup/preview', async () => registry.planCleanup())

  // Starts in the background; poll /api/registry/cleanups for the result.
  app.post(
    '/api/registry/cleanup',
    { schema: { body: { type: ['object', 'null'], properties: { garbageOnly: { type: 'boolean' } } } } },
    async (request, reply) => {
      if (registry.process.status().state !== 'running') throw new HttpError(503, 'The registry is not running')
      if ((await registry.overview()).cleanupRunning) throw new HttpError(409, 'A cleanup is already running')
      registry.cleanup({ trigger: 'manual', plan: !request.body?.garbageOnly }).catch(() => {})
      return reply.code(202).send({ ok: true })
    },
  )

  app.get('/api/registry/cleanups', async () => listCleanups(db))

  // Called by the registry process itself, authenticated with a per-process secret.
  app.register(async (internal) => {
    internal.addContentTypeParser('application/vnd.docker.distribution.events.v2+json', { parseAs: 'string' }, internal.getDefaultJsonParser('ignore', 'ignore'))
    internal.post('/api/internal/registry/events', async (request, reply) => {
      const expected = Buffer.from(`Bearer ${registry.process.notifySecret}`)
      const actual = Buffer.from(request.headers.authorization ?? '')
      if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
        return reply.code(401).send({ error: 'Invalid notification secret' })
      }
      for (const event of request.body?.events ?? []) registry.handleEvent(event)
      return { ok: true }
    })
  })

  // ---- External registries -------------------------------------------------

  function requireExternal(id) {
    const external = getExternalRegistry(db, id)
    if (!external) throw notFound('Registry')
    return external
  }

  app.get('/api/registries', { config: sessionOnly }, async () => listExternalRegistries(db))

  app.post(
    '/api/registries',
    { config: sessionOnly, schema: { body: { type: 'object', required: ['name', 'url'], additionalProperties: false, properties: registryFields } } },
    async (request, reply) => reply.code(201).send(createExternalRegistry(db, cipher, request.body)),
  )

  app.patch(
    '/api/registries/:id',
    { config: sessionOnly, schema: { params: idParams, body: { type: 'object', additionalProperties: false, properties: registryFields } } },
    async (request) => {
      requireExternal(request.params.id)
      return updateExternalRegistry(db, cipher, request.params.id, request.body)
    },
  )

  app.delete('/api/registries/:id', { config: sessionOnly, schema: { params: idParams } }, async (request, reply) => {
    requireExternal(request.params.id)
    deleteExternalRegistry(db, request.params.id)
    return reply.code(204).send()
  })

  app.post('/api/registries/:id/test', { config: sessionOnly, schema: { params: idParams } }, async (request) => {
    requireExternal(request.params.id)
    return pingRegistry(getExternalRegistryCredentials(db, cipher, request.params.id))
  })

  // Tests unsaved form values; an omitted password falls back to the stored one when editing.
  app.post(
    '/api/registries/test',
    {
      config: sessionOnly,
      schema: {
        body: {
          type: 'object',
          required: ['url'],
          properties: { ...registryFields, id: { type: 'integer', minimum: 1 } },
        },
      },
    },
    async (request) => {
      const stored = request.body.id ? getExternalRegistryCredentials(db, cipher, request.body.id) : null
      return pingRegistry({
        url: request.body.url,
        username: request.body.username ?? stored?.username,
        password: request.body.password || stored?.password,
      })
    },
  )

  app.get('/api/registry/settings', async () => getRegistrySettings(db))
}
