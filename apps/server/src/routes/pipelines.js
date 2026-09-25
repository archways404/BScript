import { HttpError, notFound } from '../http-error.js'
import { removeRunLogs } from '../runner/queue.js'
import { getProject } from '../store/projects.js'
import {
  createPipeline,
  deletePipeline,
  getPipeline,
  listPipelines,
  replaceSteps,
  updatePipeline,
} from '../store/pipelines.js'
import { hasRunningRun } from './projects.js'
import { idParams, name } from './schemas.js'

const stepSchema = {
  type: 'object',
  required: ['scriptPath'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', maxLength: 100 },
    scriptPath: { type: 'string', minLength: 1, maxLength: 500 },
    continueOnError: { type: 'boolean' },
    timeoutSec: { type: 'integer', minimum: 1, maximum: 86400 },
  },
}

const pipelineFields = {
  name,
  branchFilter: { type: 'string', minLength: 1, maxLength: 255 },
  triggers: {
    type: 'object',
    additionalProperties: false,
    properties: {
      manual: { type: 'boolean' },
      push: { type: 'boolean' },
      pull_request: { type: 'boolean' },
      cron: { type: 'boolean' },
    },
  },
  cronExpr: { type: ['string', 'null'], maxLength: 100 },
  enabled: { type: 'boolean' },
}

function checkScriptPaths(steps) {
  for (const step of steps) {
    if (step.scriptPath.startsWith('/') || step.scriptPath.split('/').includes('..')) {
      throw new HttpError(400, `Invalid script path "${step.scriptPath}"`)
    }
  }
}

export default async function pipelineRoutes(app) {
  const { db, config } = app

  function requirePipeline(id) {
    const pipeline = getPipeline(db, id)
    if (!pipeline) throw notFound('Pipeline')
    return pipeline
  }

  app.get('/api/projects/:id/pipelines', { schema: { params: idParams } }, async (request) => {
    if (!getProject(db, request.params.id)) throw notFound('Project')
    return listPipelines(db, request.params.id)
  })

  app.post(
    '/api/projects/:id/pipelines',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: { ...pipelineFields, steps: { type: 'array', items: stepSchema, maxItems: 100 } },
        },
      },
    },
    async (request, reply) => {
      if (!getProject(db, request.params.id)) throw notFound('Project')
      checkScriptPaths(request.body.steps ?? [])
      return reply.code(201).send(createPipeline(db, request.params.id, request.body))
    },
  )

  app.get('/api/pipelines/:id', { schema: { params: idParams } }, async (request) =>
    requirePipeline(request.params.id),
  )

  app.patch(
    '/api/pipelines/:id',
    {
      schema: {
        params: idParams,
        body: { type: 'object', additionalProperties: false, properties: pipelineFields },
      },
    },
    async (request) => {
      requirePipeline(request.params.id)
      return updatePipeline(db, request.params.id, request.body)
    },
  )

  app.put(
    '/api/pipelines/:id/steps',
    {
      schema: {
        params: idParams,
        body: { type: 'array', items: stepSchema, maxItems: 100 },
      },
    },
    async (request) => {
      requirePipeline(request.params.id)
      checkScriptPaths(request.body)
      return replaceSteps(db, request.params.id, request.body)
    },
  )

  app.delete('/api/pipelines/:id', { schema: { params: idParams } }, async (request, reply) => {
    requirePipeline(request.params.id)
    if (hasRunningRun(db, 'r.pipeline_id', request.params.id)) {
      throw new HttpError(409, 'Cancel the running run before deleting this pipeline')
    }
    await removeRunLogs(config, deletePipeline(db, request.params.id))
    return reply.code(204).send()
  })
}
