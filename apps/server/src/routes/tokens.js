import { notFound } from '../http-error.js'
import { createToken, deleteToken, listTokens } from '../store/tokens.js'
import { idParams, name } from './schemas.js'

export default async function tokenRoutes(app) {
  const { db } = app
  const sessionOnly = { sessionOnly: true }

  app.get('/api/tokens', { config: sessionOnly }, async () => listTokens(db))

  app.post(
    '/api/tokens',
    {
      config: sessionOnly,
      schema: {
        body: { type: 'object', required: ['name'], additionalProperties: false, properties: { name } },
      },
    },
    async (request, reply) => reply.code(201).send(createToken(db, request.body.name)),
  )

  app.delete('/api/tokens/:id', { config: sessionOnly, schema: { params: idParams } }, async (request, reply) => {
    if (!deleteToken(db, request.params.id)) throw notFound('Token')
    return reply.code(204).send()
  })
}
