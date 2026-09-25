import { HttpError, notFound } from '../http-error.js'
import { removeRunLogs } from '../runner/queue.js'
import { getEnvironment } from '../store/environments.js'
import { getProject } from '../store/projects.js'
import {
  createPipeline,
  deletePipeline,
  getPipeline,
  listPipelines,
  replaceSteps,
  updatePipeline,
} from '../store/pipelines.js'
import { cronError } from '../triggers/scheduler.js'
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
  branchFilter: { type: 'string', maxLength: 255 },
  environmentId: { type: ['integer', 'null'], minimum: 1 },
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

function checkEnvironment(db, projectId, environmentId) {
  if (environmentId == null) return
  if (getEnvironment(db, environmentId)?.projectId !== projectId) {
    throw new HttpError(400, 'Environment not found in this project')
  }
}

// Each script runs at most once per pipeline.
function checkScriptPaths(steps) {
  const seen = new Set()
  for (const step of steps) {
    if (step.scriptPath.startsWith('/') || step.scriptPath.split('/').includes('..')) {
      throw new HttpError(400, `Invalid script path "${step.scriptPath}"`)
    }
    if (seen.has(step.scriptPath)) throw new HttpError(400, `"${step.scriptPath}" is already a step in this pipeline`)
    seen.add(step.scriptPath)
  }
}

// The cron expression must be valid whenever it is set, and present whenever cron is on.
function checkSchedule(triggers, cronExpr) {
  if (cronExpr) {
    const error = cronError(cronExpr)
    if (error) throw new HttpError(400, `Invalid cron expression: ${error}`)
  }
  if (triggers.cron && !cronExpr) throw new HttpError(400, 'Set a cron expression to enable the schedule trigger')
}

export default async function pipelineRoutes(app, { scheduler }) {
  const { db, config } = app
  const withSchedule = (pipeline) => pipeline && { ...pipeline, nextRunAt: scheduler?.nextRunAt(pipeline.id) ?? null }

  function requirePipeline(id) {
    const pipeline = getPipeline(db, id)
    if (!pipeline) throw notFound('Pipeline')
    return pipeline
  }

  app.get('/api/projects/:id/pipelines', { schema: { params: idParams } }, async (request) => {
    if (!getProject(db, request.params.id)) throw notFound('Project')
    return listPipelines(db, request.params.id).map(withSchedule)
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
      checkSchedule(request.body.triggers ?? {}, request.body.cronExpr)
      checkEnvironment(db, request.params.id, request.body.environmentId)
      const pipeline = createPipeline(db, request.params.id, request.body)
      scheduler?.sync()
      return reply.code(201).send(withSchedule(pipeline))
    },
  )

  app.get('/api/pipelines/:id', { schema: { params: idParams } }, async (request) =>
    withSchedule(requirePipeline(request.params.id)),
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
      const current = requirePipeline(request.params.id)
      checkSchedule(
        { ...current.triggers, ...request.body.triggers },
        request.body.cronExpr === undefined ? current.cronExpr : request.body.cronExpr,
      )
      checkEnvironment(db, current.projectId, request.body.environmentId)
      const pipeline = updatePipeline(db, request.params.id, request.body)
      scheduler?.sync()
      return withSchedule(pipeline)
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
    scheduler?.sync()
    return reply.code(204).send()
  })
}
