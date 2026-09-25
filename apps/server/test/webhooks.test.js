import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { test } from 'node:test'
import { makePipeline, makeServer, waitForRun } from './server-helpers.js'

async function setup(t, opts) {
  const server = await makeServer(t, {
    scripts: { 'env.sh': 'echo "branch=$BSCRIPT_BRANCH pr=${BSCRIPT_PR_NUMBER:-} trigger=$BSCRIPT_TRIGGER token=${TOKEN:-none}"' },
    ...opts,
  })
  const { project, pipeline } = await makePipeline(server, [{ scriptPath: 'env.sh' }], 'ci')
  const { secret } = (await server.api('GET', `/api/projects/${project.id}/webhook`)).body
  await server.api('PUT', `/api/projects/${project.id}/env/TOKEN`, { value: 'tok-12345', secret: true })

  // Sends a signed webhook with no session cookie, like GitHub would.
  async function hook(event, payload, { sign = secret, form = false } = {}) {
    const body = form ? `payload=${encodeURIComponent(JSON.stringify(payload))}` : JSON.stringify(payload)
    const res = await server.app.inject({
      method: 'POST',
      url: `/api/hooks/github/${project.id}`,
      payload: body,
      headers: {
        'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json',
        'x-github-event': event,
        'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', sign).update(body).digest('hex')}`,
      },
    })
    return { status: res.statusCode, body: res.json() }
  }
  return { ...server, project, pipeline, hook }
}

const push = (sha, branch = 'main', extra = {}) => ({
  ref: `refs/heads/${branch}`,
  after: sha,
  head_commit: { message: 'change things' },
  pusher: { name: 'octocat' },
  ...extra,
})

const pullRequest = (sha, { fork = false, action = 'opened', base = 'main' } = {}) => ({
  action,
  sender: { login: 'contributor' },
  pull_request: {
    number: 42,
    head: { sha, ref: 'feature/login', repo: { full_name: fork ? 'someone/fork' : 'acme/web' } },
    base: { ref: base, repo: { full_name: 'acme/web' } },
  },
})

const log = async (server, runId) => (await server.api('GET', `/api/runs/${runId}/steps/0/log`)).body

test('rejects a bad signature and answers ping', async (t) => {
  const s = await setup(t)
  assert.equal((await s.hook('push', push(s.repo.sha), { sign: 'wrong' })).status, 401)
  assert.deepEqual((await s.hook('ping', { zen: 'Keep it logically awesome.' })).body, {
    ok: true,
    zen: 'Keep it logically awesome.',
  })
})

test('push only triggers when the pipeline has push on and the branch matches', async (t) => {
  const s = await setup(t)
  assert.deepEqual((await s.hook('push', push(s.repo.sha))).body.triggered, [], 'push trigger is off by default')

  await s.api('PATCH', `/api/pipelines/${s.pipeline.id}`, { triggers: { push: true }, branchFilter: 'main' })
  assert.deepEqual((await s.hook('push', push(s.repo.sha, 'feature/x'))).body.triggered, [])

  const res = await s.hook('push', push(s.repo.sha))
  assert.equal(res.status, 202)
  const run = await waitForRun(s.db, res.body.triggered[0].runId)
  assert.equal(run.status, 'success', run.error)
  assert.equal(run.ref, s.repo.sha)
  assert.equal(run.branch, 'main')
  assert.equal(run.triggeredBy, 'octocat')
  assert.equal(await log(s, run.id), 'branch=main pr= trigger=push token=***\n')
})

test('push events that should not run are ignored with a reason', async (t) => {
  const s = await setup(t)
  await s.api('PATCH', `/api/pipelines/${s.pipeline.id}`, { triggers: { push: true } })
  const cases = [
    [push(s.repo.sha, 'main', { deleted: true }), /deleted/],
    [push(s.repo.sha, 'main', { ref: 'refs/tags/v1' }), /not a branch/],
    [push(s.repo.sha, 'main', { head_commit: { message: 'docs [skip ci]' } }), /skip CI/],
  ]
  for (const [payload, reason] of cases) assert.match((await s.hook('push', payload)).body.ignored, reason)
  assert.match((await s.hook('issues', {})).body.ignored, /not handled/)
})

test('same-repo pull requests run with secrets, filtered on the target branch', async (t) => {
  const s = await setup(t)
  await s.api('PATCH', `/api/pipelines/${s.pipeline.id}`, { triggers: { pull_request: true }, branchFilter: 'main' })
  assert.deepEqual((await s.hook('pull_request', pullRequest(s.repo.sha, { base: 'develop' }))).body.triggered, [])
  assert.match((await s.hook('pull_request', pullRequest(s.repo.sha, { action: 'closed' }))).body.ignored, /closed/)

  const res = await s.hook('pull_request', pullRequest(s.repo.sha), { form: true })
  const run = await waitForRun(s.db, res.body.triggered[0].runId)
  assert.equal(run.prNumber, 42)
  assert.equal(await log(s, run.id), 'branch=feature/login pr=42 trigger=pull_request token=***\n')
})

test('fork pull requests are ignored unless allowed, and never get secrets', async (t) => {
  const blocked = await setup(t)
  await blocked.api('PATCH', `/api/pipelines/${blocked.pipeline.id}`, { triggers: { pull_request: true } })
  assert.match((await blocked.hook('pull_request', pullRequest(blocked.repo.sha, { fork: true }))).body.ignored, /fork/)

  const allowed = await setup(t, { env: { BSCRIPT_ALLOW_FORK_PRS: 'true' } })
  await allowed.api('PATCH', `/api/pipelines/${allowed.pipeline.id}`, { triggers: { pull_request: true } })
  const res = await allowed.hook('pull_request', pullRequest(allowed.repo.sha, { fork: true }))
  const run = await waitForRun(allowed.db, res.body.triggered[0].runId)
  assert.equal(run.fromFork, true)
  assert.match(await log(allowed, run.id), /token=none/)
})
