import assert from 'node:assert/strict'
import { test } from 'node:test'
import { listRuns } from '../src/store/runs.js'
import { makePipeline, makeServer, waitForRun } from './server-helpers.js'

test('cron expressions are validated when saving', async (t) => {
  const server = await makeServer(t)
  const { pipeline } = await makePipeline(server)
  const url = `/api/pipelines/${pipeline.id}`

  const missing = await server.api('PATCH', url, { triggers: { cron: true } })
  assert.equal(missing.status, 400)
  assert.match(missing.body.error, /Set a cron expression/)

  const invalid = await server.api('PATCH', url, { triggers: { cron: true }, cronExpr: 'every day' })
  assert.equal(invalid.status, 400)
  assert.match(invalid.body.error, /Invalid cron expression/)

  const ok = await server.api('PATCH', url, { triggers: { cron: true }, cronExpr: '0 3 * * *' })
  assert.equal(ok.status, 200)
  assert.ok(Date.parse(ok.body.nextRunAt) > Date.now())

  const off = await server.api('PATCH', url, { enabled: false })
  assert.equal(off.body.nextRunAt, null, 'disabled pipelines are unscheduled')
})

test('a scheduled tick runs the default branch, and skips while one is still queued', async (t) => {
  const server = await makeServer(t, { start: false })
  const { pipeline } = await makePipeline(server)

  server.scheduler.fire(pipeline.id)
  server.scheduler.fire(pipeline.id)
  const queued = listRuns(server.db, { pipelineId: pipeline.id })
  assert.equal(queued.length, 1)
  assert.equal(queued[0].trigger, 'cron')
  assert.equal(queued[0].branch, 'main')

  await server.queue.start()
  assert.equal((await waitForRun(server.db, queued[0].id)).status, 'success')
})
