import { notFound } from '../http-error.js'
import { listEnvKeys } from '../store/env-vars.js'
import {
  createEnvironment,
  deleteEnvironment,
  getEnvironment,
  listEnvironments,
  updateEnvironment,
} from '../store/environments.js'
import { getProject } from '../store/projects.js'
import { idParams, name } from './schemas.js'

const fields = {
  name,
  branchFilter: { type: 'string', maxLength: 255 },
}

export default async function environmentRoutes(app) {
  const { db } = app
  const withKeys = (environment) => ({ ...environment, keys: listEnvKeys(db, 'environment', environment.id) })

  function requireEnvironment(id) {
    const environment = getEnvironment(db, id)
    if (!environment) throw notFound('Environment')
    return environment
  }

  app.get('/api/projects/:id/environments', { schema: { params: idParams } }, async (request) => {
    if (!getProject(db, request.params.id)) throw notFound('Project')
    return listEnvironments(db, request.params.id).map(withKeys)
  })

  app.post(
    '/api/projects/:id/environments',
    {
      schema: {
        params: idParams,
        body: { type: 'object', required: ['name'], additionalProperties: false, properties: fields },
      },
    },
    async (request, reply) => {
      if (!getProject(db, request.params.id)) throw notFound('Project')
      return reply.code(201).send(withKeys(createEnvironment(db, request.params.id, request.body)))
    },
  )

  app.patch(
    '/api/environments/:id',
    { schema: { params: idParams, body: { type: 'object', additionalProperties: false, properties: fields } } },
    async (request) => {
      requireEnvironment(request.params.id)
      return withKeys(updateEnvironment(db, request.params.id, request.body))
    },
  )

  app.delete('/api/environments/:id', { schema: { params: idParams } }, async (request, reply) => {
    requireEnvironment(request.params.id)
    deleteEnvironment(db, request.params.id)
    return reply.code(204).send()
  })
}
