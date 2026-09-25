import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { test } from 'node:test'
import { getPipeline } from '../src/store/pipelines.js'
import { makePipeline, makeServer, waitForRun } from './server-helpers.js'

const SHOW = 'echo "env=${BSCRIPT_ENVIRONMENT:-none} host=${HOST:-unset} mode=${MODE:-unset} token=${TOKEN:-none}"'

async function setup(t, scripts = { 'show.sh': SHOW }, opts = {}) {
  const server = await makeServer(t, { scripts, ...opts })
  const { project, pipeline } = await makePipeline(server, [{ scriptPath: Object.keys(scripts)[0] }])
  const env = (name, body = {}) => server.api('POST', `/api/projects/${project.id}/environments`, { name, ...body })
  const set = (scope, id, key, value, secret = false) => server.api('PUT', `/api/${scope}/${id}/env/${key}`, { value, secret })
  const run = async (body = {}) => {
    const res = await server.api('POST', `/api/pipelines/${pipeline.id}/runs`, body)
    if (res.status !== 201) return res
    const finished = await waitForRun(server.db, res.body.id)
    return { status: 201, run: finished, log: (await server.api('GET', `/api/runs/${finished.id}/steps/0/log`)).body }
  }
  return { ...server, project, pipeline, env, set, run }
}

test('environments override pipeline and project vars; runs record the environment', async (t) => {
  const s = await setup(t)
  const staging = (await s.env('staging')).body
  const production = (await s.env('production')).body
  await s.set('projects', s.project.id, 'HOST', 'project-host')
  await s.set('projects', s.project.id, 'MODE', 'project-mode')
  await s.set('pipelines', s.pipeline.id, 'MODE', 'pipeline-mode')
  await s.set('environments', staging.id, 'HOST', 'staging.example.com')
  await s.set('environments', production.id, 'HOST', 'prod.example.com')
  await s.set('environments', production.id, 'MODE', 'prod-mode')

  assert.equal((await s.run()).log, 'env=none host=project-host mode=pipeline-mode token=none\n')
  assert.equal((await s.run({ environmentId: staging.id })).log, 'env=staging host=staging.example.com mode=pipeline-mode token=none\n')
  const prod = await s.run({ environmentId: production.id })
  assert.equal(prod.log, 'env=production host=prod.example.com mode=prod-mode token=none\n')
  assert.equal(prod.run.environmentName, 'production')

  const listed = (await s.api('GET', `/api/projects/${s.project.id}/environments`)).body
  assert.deepEqual(listed.map((e) => [e.name, e.keys]), [['production', ['HOST', 'MODE']], ['staging', ['HOST']]])
})

test('a pipeline default environment is used unless the run picks another or none', async (t) => {
  const s = await setup(t)
  const staging = (await s.env('staging')).body
  await s.set('environments', staging.id, 'HOST', 'staging.example.com')
  await s.api('PATCH', `/api/pipelines/${s.pipeline.id}`, { environmentId: staging.id })

  assert.match((await s.run()).log, /env=staging/)
  assert.match((await s.run({ environmentId: null })).log, /env=none/)
})

test('environment branch filters refuse other branches, for manual and webhook runs', async (t) => {
  const s = await setup(t)
  const production = (await s.env('production', { branchFilter: 'release/*' })).body

  const manual = await s.run({ environmentId: production.id, ref: 'main' })
  assert.equal(manual.status, 403)
  assert.match(manual.body.error, /only allows branches matching "release\/\*", not "main"/)
  assert.equal((await s.run({ environmentId: production.id, ref: s.repo.sha })).status, 403, 'bare commits have no branch')

  await s.api('PATCH', `/api/pipelines/${s.pipeline.id}`, { environmentId: production.id, triggers: { push: true } })
  const { secret } = (await s.api('GET', `/api/projects/${s.project.id}/webhook`)).body
  const body = JSON.stringify({ ref: 'refs/heads/main', after: s.repo.sha, head_commit: { message: 'x' } })
  const res = await s.app.inject({
    method: 'POST',
    url: `/api/hooks/github/${s.project.id}`,
    payload: body,
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'push',
      'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`,
    },
  })
  assert.deepEqual(res.json().triggered, [])
  assert.match(res.json().skipped[0].reason, /only allows branches/)
})

test('environments must belong to the project; deleting one clears pipeline defaults', async (t) => {
  const s = await setup(t)
  const other = (await s.api('POST', '/api/projects', { name: 'other', repoUrl: s.repoDir })).body
  const foreign = (await s.api('POST', `/api/projects/${other.id}/environments`, { name: 'x' })).body
  assert.equal((await s.api('PATCH', `/api/pipelines/${s.pipeline.id}`, { environmentId: foreign.id })).status, 400)
  assert.equal((await s.run({ environmentId: foreign.id })).status, 400)

  const staging = (await s.env('staging')).body
  await s.set('environments', staging.id, 'HOST', 'h')
  await s.api('PATCH', `/api/pipelines/${s.pipeline.id}`, { environmentId: staging.id })
  assert.equal((await s.api('DELETE', `/api/environments/${staging.id}`)).status, 204)
  assert.equal(getPipeline(s.db, s.pipeline.id).environmentId, null)
  assert.equal(s.db.prepare("SELECT count(*) FROM env_vars WHERE scope = 'environment'").pluck().get(), 0)
})

test('runs fail before any step when a declared required var is missing', async (t) => {
  const scripts = {
    'deploy.sh': '# @env DEPLOY_TOKEN secret\n# @env REGION optional\necho "deploying to ${REGION:-eu}"',
    'lint.sh': '# @env LINT_KEY\necho lint',
  }
  const s = await setup(t, scripts)
  await s.api('PUT', `/api/pipelines/${s.pipeline.id}/steps`, [
    { scriptPath: 'lint.sh', continueOnError: true },
    { scriptPath: 'deploy.sh', name: 'Deploy' },
  ])

  const failed = await s.run()
  assert.equal(failed.run.status, 'failed')
  assert.match(failed.run.error, /Missing required env vars: DEPLOY_TOKEN \(Deploy\)/)
  assert.doesNotMatch(failed.run.error, /LINT_KEY|REGION/, 'allow-failure steps and optional vars are not enforced')
  assert.deepEqual(failed.run.steps.map((step) => step.status), ['skipped', 'skipped'])

  const production = (await s.env('production')).body
  await s.set('environments', production.id, 'DEPLOY_TOKEN', 'tok-12345', true)
  const ok = await s.api('POST', `/api/pipelines/${s.pipeline.id}/runs`, { environmentId: production.id })
  assert.equal((await waitForRun(s.db, ok.body.id)).status, 'success')
})

test('requirements endpoint reports needs of unsaved steps and where keys are set', async (t) => {
  const s = await setup(t, {
    'build.sh': '# @env IMAGE  Image name\nsource "$(dirname "${BASH_SOURCE[0]}")/_lib/push.sh"\necho "$BUILD_ARGS"',
    '_lib/push.sh': 'require_env REGISTRY_PASSWORD',
  })
  const production = (await s.env('production')).body
  await s.set('projects', s.project.id, 'IMAGE', 'ghcr.io/acme/web')
  await s.set('environments', production.id, 'REGISTRY_PASSWORD', 'pw-12345', true)

  const res = await s.api('POST', `/api/projects/${s.project.id}/requirements`, {
    pipelineId: s.pipeline.id,
    steps: [{ name: 'Build', scriptPath: 'build.sh' }],
  })
  assert.equal(res.status, 200)
  assert.equal(res.body.commitSha, s.repo.sha)
  assert.deepEqual(res.body.variables.map((v) => [v.name, v.level, v.declared, v.secret]), [
    ['IMAGE', 'required', true, false],
    ['REGISTRY_PASSWORD', 'required', false, true],
    ['BUILD_ARGS', 'referenced', false, false],
  ])
  assert.deepEqual(res.body.configured, {
    project: ['IMAGE'],
    pipeline: [],
    environments: [{ id: production.id, name: 'production', keys: ['REGISTRY_PASSWORD'] }],
  })
})
