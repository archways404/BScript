import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { getRun } from '../src/store/runs.js'
import { makePipeline, makeServer, waitFor, waitForRun } from './server-helpers.js'

test('manual run executes, records steps and serves logs; env merges with pipeline winning', async (t) => {
  const server = await makeServer(t, {
    scripts: { 'show.sh': 'echo "mode=$MODE token=$TOKEN trigger=$BSCRIPT_TRIGGER branch=$BSCRIPT_BRANCH"' },
  })
  const { project, pipeline } = await makePipeline(server, [{ scriptPath: 'show.sh' }])
  await server.api('PUT', `/api/projects/${project.id}/env/MODE`, { value: 'project' })
  await server.api('PUT', `/api/projects/${project.id}/env/TOKEN`, { value: 'tok-12345', secret: true })
  await server.api('PUT', `/api/pipelines/${pipeline.id}/env/MODE`, { value: 'pipeline' })

  const created = await server.api('POST', `/api/pipelines/${pipeline.id}/runs`, {})
  assert.equal(created.status, 201)
  assert.equal(created.body.trigger, 'manual')

  const run = await waitForRun(server.db, created.body.id)
  assert.equal(run.status, 'success', run.error)
  assert.equal(run.commitSha, server.repo.sha)
  assert.equal(run.steps[0].status, 'success')

  const log = await server.api('GET', `/api/runs/${run.id}/steps/0/log`)
  assert.equal(log.body, 'mode=pipeline token=*** trigger=manual branch=main\n')

  const [listedProject] = (await server.api('GET', '/api/projects')).body
  assert.deepEqual(listedProject.lastRun, { id: run.id, status: 'success', queuedAt: run.queuedAt })
  const [listedPipeline] = (await server.api('GET', `/api/projects/${project.id}/pipelines`)).body
  assert.equal(listedPipeline.lastRun.id, run.id)

  const listed = await server.api('GET', `/api/runs?pipelineId=${pipeline.id}`)
  assert.deepEqual(listed.body.map((r) => r.id), [run.id])
  assert.equal(listed.body[0].projectName, 'demo')
})

test('fork runs get no secrets', async (t) => {
  const server = await makeServer(t, { scripts: { 'show.sh': 'echo "token=${TOKEN:-none}"' } })
  const { project, pipeline } = await makePipeline(server, [{ scriptPath: 'show.sh' }])
  await server.api('PUT', `/api/projects/${project.id}/env/TOKEN`, { value: 'tok-12345', secret: true })
  const run = server.queue.enqueue({ pipelineId: pipeline.id, trigger: 'pull_request', fromFork: true })
  await waitForRun(server.db, run.id)
  assert.equal((await server.api('GET', `/api/runs/${run.id}/steps/0/log`)).body, 'token=none\n')
})

test('an empty pipeline cannot be run', async (t) => {
  const server = await makeServer(t)
  const { pipeline } = await makePipeline(server, [])
  assert.equal((await server.api('POST', `/api/pipelines/${pipeline.id}/runs`, {})).status, 400)
})

test('API-token runs are recorded as api triggers', async (t) => {
  const server = await makeServer(t)
  const { pipeline } = await makePipeline(server)
  const { token } = (await server.api('POST', '/api/tokens', { name: 'bot' })).body
  const res = await server.api('POST', `/api/pipelines/${pipeline.id}/runs`, { ref: 'main' }, { authorization: `Bearer ${token}` })
  assert.equal(res.body.trigger, 'api')
  assert.equal(res.body.triggeredBy, 'token:bot')
  await waitForRun(server.db, res.body.id)
})

test('a pipeline never runs twice at once; other pipelines are not blocked', async (t) => {
  const server = await makeServer(t, { scripts: { 'slow.sh': 'sleep 0.4' } })
  const a = (await makePipeline(server, [{ scriptPath: 'slow.sh' }], 'a')).pipeline
  const b = (await makePipeline(server, [{ scriptPath: 'slow.sh' }], 'b')).pipeline

  const a1 = server.queue.enqueue({ pipelineId: a.id, trigger: 'manual' })
  const a2 = server.queue.enqueue({ pipelineId: a.id, trigger: 'manual' })
  const b1 = server.queue.enqueue({ pipelineId: b.id, trigger: 'manual' })

  await waitFor(() => getRun(server.db, a1.id).status === 'running')
  await waitFor(() => getRun(server.db, b1.id).status === 'running')
  assert.equal(getRun(server.db, a2.id).status, 'queued')

  const [r1, r2] = [await waitForRun(server.db, a1.id), await waitForRun(server.db, a2.id)]
  assert.ok(r2.startedAt >= r1.finishedAt, 'second run of a pipeline starts after the first ends')
})

test('MAX_CONCURRENT_RUNS limits runs across pipelines', async (t) => {
  const server = await makeServer(t, { env: { MAX_CONCURRENT_RUNS: '1' }, scripts: { 'slow.sh': 'sleep 0.3' } })
  const a = (await makePipeline(server, [{ scriptPath: 'slow.sh' }], 'a')).pipeline
  const b = (await makePipeline(server, [{ scriptPath: 'slow.sh' }], 'b')).pipeline
  const r1 = server.queue.enqueue({ pipelineId: a.id, trigger: 'manual' })
  const r2 = server.queue.enqueue({ pipelineId: b.id, trigger: 'manual' })
  await waitFor(() => getRun(server.db, r1.id).status === 'running')
  assert.equal(getRun(server.db, r2.id).status, 'queued')
  await waitForRun(server.db, r2.id)
})

test('cancel works for queued and running runs', async (t) => {
  const server = await makeServer(t, { scripts: { 'slow.sh': 'sleep 30' } })
  const { pipeline } = await makePipeline(server, [{ scriptPath: 'slow.sh' }])
  const running = server.queue.enqueue({ pipelineId: pipeline.id, trigger: 'manual' })
  const queued = server.queue.enqueue({ pipelineId: pipeline.id, trigger: 'manual' })

  assert.equal((await server.api('POST', `/api/runs/${queued.id}/cancel`)).status, 202)
  assert.equal(getRun(server.db, queued.id).status, 'cancelled')

  await waitFor(() => getRun(server.db, running.id, { withSteps: true }).steps[0]?.status === 'running')
  await server.api('POST', `/api/runs/${running.id}/cancel`)
  const run = await waitForRun(server.db, running.id)
  assert.equal(run.status, 'cancelled')
  assert.equal((await server.api('POST', `/api/runs/${running.id}/cancel`)).status, 409)
})

test('re-run pins the original commit', async (t) => {
  const server = await makeServer(t)
  const { pipeline } = await makePipeline(server)
  const first = await waitForRun(server.db, server.queue.enqueue({ pipelineId: pipeline.id, trigger: 'manual' }).id)
  const rerun = await server.api('POST', `/api/runs/${first.id}/rerun`)
  assert.equal(rerun.body.ref, server.repo.sha)
  assert.equal((await waitForRun(server.db, rerun.body.id)).status, 'success')
})

test('retention keeps the newest N finished runs and deletes old logs', async (t) => {
  const server = await makeServer(t, { env: { RUN_RETENTION: '2' } })
  const { pipeline } = await makePipeline(server)
  const ids = []
  for (let i = 0; i < 3; i++) {
    const run = server.queue.enqueue({ pipelineId: pipeline.id, trigger: 'manual' })
    await waitForRun(server.db, run.id)
    ids.push(run.id)
  }
  await waitFor(() => !getRun(server.db, ids[0]))
  assert.ok(getRun(server.db, ids[1]) && getRun(server.db, ids[2]))
  await waitFor(() => !fs.existsSync(path.join(server.config.logsDir, String(ids[0]))))
})

test('runs interrupted by a restart are marked failed; queued runs still start', async (t) => {
  const server = await makeServer(t, { start: false })
  const { pipeline } = await makePipeline(server)
  const stale = server.queue.enqueue({ pipelineId: pipeline.id, trigger: 'manual' })
  server.db.prepare("UPDATE runs SET status = 'running' WHERE id = ?").run(stale.id)
  const queued = server.queue.enqueue({ pipelineId: pipeline.id, trigger: 'manual' })

  await server.queue.start()
  const failed = getRun(server.db, stale.id)
  assert.equal(failed.status, 'failed')
  assert.match(failed.error, /restart/)
  assert.equal((await waitForRun(server.db, queued.id)).status, 'success')
})

test('deleting a pipeline with a running run is refused', async (t) => {
  const server = await makeServer(t, { scripts: { 'slow.sh': 'sleep 30' } })
  const { pipeline } = await makePipeline(server, [{ scriptPath: 'slow.sh' }])
  const run = server.queue.enqueue({ pipelineId: pipeline.id, trigger: 'manual' })
  await waitFor(() => getRun(server.db, run.id).status === 'running')
  assert.equal((await server.api('DELETE', `/api/pipelines/${pipeline.id}`)).status, 409)
  server.queue.cancel(run.id)
  await waitForRun(server.db, run.id)
  assert.equal((await server.api('DELETE', `/api/pipelines/${pipeline.id}`)).status, 204)
})

function parseSse(body) {
  return body
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('event:'))
    .map((chunk) => {
      const [eventLine, dataLine] = chunk.split('\n')
      return { event: eventLine.slice(7), data: JSON.parse(dataLine.slice(6)) }
    })
}

test('run stream replays buffered lines to late joiners, then follows live until the end', async (t) => {
  const server = await makeServer(t, { scripts: { 'talk.sh': 'echo early; sleep 0.5; echo late' } })
  const { pipeline } = await makePipeline(server, [{ scriptPath: 'talk.sh' }])
  const run = server.queue.enqueue({ pipelineId: pipeline.id, trigger: 'manual' })

  const { subscribe } = server.queue
  await waitFor(() => subscribe(run.id, () => {}).replay.length > 0)

  const res = await server.app.inject({ url: `/api/runs/${run.id}/stream`, headers: { cookie: server.cookie } })
  const events = parseSse(res.body)
  assert.equal(events[0].event, 'snapshot')
  assert.deepEqual(
    events.filter((e) => e.event === 'step:log').map((e) => e.data.line),
    ['early', 'late'],
  )
  assert.equal(events.at(-1).event, 'run:end')
  assert.equal(events.at(-1).data.status, 'success')
})

test('run stream for a finished run sends a snapshot and closes', async (t) => {
  const server = await makeServer(t)
  const { pipeline } = await makePipeline(server)
  const run = await waitForRun(server.db, server.queue.enqueue({ pipelineId: pipeline.id, trigger: 'manual' }).id)
  const res = await server.app.inject({ url: `/api/runs/${run.id}/stream`, headers: { cookie: server.cookie } })
  const events = parseSse(res.body)
  assert.deepEqual(events.map((e) => e.event), ['snapshot'])
  assert.equal(events[0].data.steps[0].status, 'success')
})
