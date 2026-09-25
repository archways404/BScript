import { HttpError, notFound } from '../http-error.js'
import { isValidEnvKey } from '../runner/env.js'
import { deleteEnvVar, listEnvVars, setEnvVar } from '../store/env-vars.js'
import { getEnvironment } from '../store/environments.js'
import { getPipeline } from '../store/pipelines.js'
import { getProject } from '../store/projects.js'
import { idParams } from './schemas.js'

const SCOPES = [
  { scope: 'project', prefix: '/api/projects/:id/env', exists: getProject, label: 'Project' },
  { scope: 'pipeline', prefix: '/api/pipelines/:id/env', exists: getPipeline, label: 'Pipeline' },
  { scope: 'environment', prefix: '/api/environments/:id/env', exists: getEnvironment, label: 'Environment' },
]

const keyParams = {
  type: 'object',
  required: ['id', 'key'],
  properties: { id: idParams.properties.id, key: { type: 'string', minLength: 1, maxLength: 200 } },
}

export default async function envRoutes(app) {
  const { db, cipher } = app

  for (const { scope, prefix, exists, label } of SCOPES) {
    const requireOwner = (id) => {
      if (!exists(db, id)) throw notFound(label)
    }

    app.get(prefix, { schema: { params: idParams } }, async (request) => {
      requireOwner(request.params.id)
      return listEnvVars(db, cipher, scope, request.params.id)
    })

    app.put(
      `${prefix}/:key`,
      {
        schema: {
          params: keyParams,
          body: {
            type: 'object',
            required: ['value'],
            additionalProperties: false,
            properties: { value: { type: 'string', maxLength: 65536 }, secret: { type: 'boolean' } },
          },
        },
      },
      async (request, reply) => {
        const { id, key } = request.params
        requireOwner(id)
        if (!isValidEnvKey(key)) throw new HttpError(400, `Invalid env var name "${key}"`)
        if (key.startsWith('BSCRIPT_')) throw new HttpError(400, 'BSCRIPT_* names are reserved')
        setEnvVar(db, cipher, scope, id, { key, ...request.body })
        return reply.code(204).send()
      },
    )

    app.delete(`${prefix}/:key`, { schema: { params: keyParams } }, async (request, reply) => {
      requireOwner(request.params.id)
      if (!deleteEnvVar(db, scope, request.params.id, request.params.key)) throw notFound('Env var')
      return reply.code(204).send()
    })
  }
}
