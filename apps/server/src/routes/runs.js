import fs from 'node:fs'
import { HttpError, notFound } from '../http-error.js'
import { getPipeline } from '../store/pipelines.js'
import { streamsFileFor } from '../runner/logs.js'
import { getRun, getStepLogPath, listRuns } from '../store/runs.js'
import { runStats } from '../store/stats.js'
import { idParams } from './schemas.js'
import { openEventStream } from './sse.js'

const FINISHED = new Set(['success', 'failed', 'cancelled'])

export default async function runRoutes(app, { queue }) {
  const { db } = app

  function requireRun(id, options) {
    const run = getRun(db, id, options)
    if (!run) throw notFound('Run')
    return run
  }

  // Webhooks and cron check their own trigger; this covers the Run button, API and re-run.
  function requireManualRuns(pipelineId) {
    const pipeline = getPipeline(db, pipelineId)
    if (!pipeline) throw notFound('Pipeline')
    if (!pipeline.enabled) throw new HttpError(409, 'This pipeline is disabled')
    if (!pipeline.triggers.manual) throw new HttpError(409, 'Manual and API runs are turned off for this pipeline')
  }

  function triggerFrom(request) {
    return request.auth.via === 'token'
      ? { trigger: 'api', triggeredBy: `token:${request.auth.tokenName}` }
      : { trigger: 'manual', triggeredBy: request.auth.user }
  }

  app.post(
    '/api/pipelines/:id/runs',
    {
      schema: {
        params: idParams,
        body: {
          type: ['object', 'null'],
          additionalProperties: false,
          properties: {
            ref: { type: 'string', minLength: 1, maxLength: 255 },
            // Omit for the pipeline's default environment; null for none.
            environmentId: { type: ['integer', 'null'], minimum: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      requireManualRuns(request.params.id)
      const run = queue.enqueue({
        pipelineId: request.params.id,
        ref: request.body?.ref,
        environmentId: request.body?.environmentId,
        ...triggerFrom(request),
      })
      return reply.code(201).send(run)
    },
  )

  app.get(
    '/api/runs',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            pipelineId: { type: 'integer', minimum: 1 },
            projectId: { type: 'integer', minimum: 1 },
            status: { type: 'string', enum: ['queued', 'running', 'success', 'failed', 'cancelled'] },
            before: { type: 'integer', minimum: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          },
        },
      },
    },
    async (request) => listRuns(db, request.query),
  )

  app.get('/api/stats', async () => runStats(db))

  app.get('/api/runs/:id', { schema: { params: idParams } }, async (request) =>
    requireRun(request.params.id, { withSteps: true }),
  )

  app.post('/api/runs/:id/cancel', { schema: { params: idParams } }, async (request, reply) => {
    queue.cancel(request.params.id)
    return reply.code(202).send({ ok: true })
  })

  // Re-runs the exact commit when it is known, so a re-run reproduces the original.
  app.post('/api/runs/:id/rerun', { schema: { params: idParams } }, async (request, reply) => {
    const run = requireRun(request.params.id)
    requireManualRuns(run.pipelineId)
    const next = queue.enqueue({
      pipelineId: run.pipelineId,
      ref: run.commitSha ?? run.ref,
      branch: run.branch,
      prNumber: run.prNumber,
      environmentId: run.environmentId,
      fromFork: run.fromFork,
      ...triggerFrom(request),
    })
    return reply.code(201).send(next)
  })

  app.get(
    '/api/runs/:id/steps/:position/log',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id', 'position'],
          properties: { id: idParams.properties.id, position: { type: 'integer', minimum: 0 } },
        },
        querystring: { type: 'object', properties: { format: { type: 'string', enum: ['text', 'lines'] } } },
      },
    },
    async (request, reply) => {
      const logPath = getStepLogPath(db, request.params.id, request.params.position)
      if (!logPath || !fs.existsSync(logPath)) throw notFound('Log')
      if (request.query.format !== 'lines') return reply.type('text/plain; charset=utf-8').send(fs.createReadStream(logPath))

      // [{ stream, line }] for the UI, with stderr/info restored from the sidecar file.
      const text = (await fs.promises.readFile(logPath, 'utf8')).replace(/\n$/, '')
      const streams = JSON.parse(await fs.promises.readFile(streamsFileFor(logPath), 'utf8').catch(() => '{}'))
      const byLine = new Map()
      for (const stream of ['stderr', 'info']) for (const index of streams[stream] ?? []) byLine.set(index, stream)
      return text === '' ? [] : text.split('\n').map((line, i) => ({ stream: byLine.get(i) ?? 'stdout', line }))
    },
  )

  // Live run updates. Sends a `snapshot` first, then buffered `step:log` lines for an active
  // run, then events as they happen. Closes once the run has finished.
  app.get('/api/runs/:id/stream', { schema: { params: idParams } }, async (request, reply) => {
    requireRun(request.params.id)
    const stream = openEventStream(reply)
    const { replay, unsubscribe } = queue.subscribe(request.params.id, (event) => {
      stream.send(event.type, event)
      if (event.type === 'run:end') stream.end()
    })
    stream.onClose(unsubscribe)

    const snapshot = getRun(db, request.params.id, { withSteps: true })
    stream.send('snapshot', snapshot)
    for (const event of replay) stream.send(event.type, event)
    if (FINISHED.has(snapshot.status)) stream.end()
  })

  // Run status changes across all pipelines, for lists and dashboards.
  app.get('/api/events', async (request, reply) => {
    const stream = openEventStream(reply)
    const listener = (event) => stream.send('run', event)
    queue.events.on('run', listener)
    stream.onClose(() => queue.events.off('run', listener))
    stream.send('ready', {})
  })
}
