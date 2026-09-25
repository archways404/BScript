import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeServer } from './server-helpers.js'

test('projects: create, list, update, credentials stay hidden, delete', async (t) => {
  const { api, repoDir } = await makeServer(t)

  const missingCred = await api('POST', '/api/projects', { name: 'x', repoUrl: repoDir, authType: 'token' })
  assert.equal(missingCred.status, 400)

  const created = await api('POST', '/api/projects', {
    name: 'demo',
    repoUrl: repoDir,
    authType: 'token',
    credential: 'ghp_secret',
  })
  assert.equal(created.status, 201)
  assert.equal(created.body.hasCredential, true)
  assert.equal(JSON.stringify(created.body).includes('ghp_secret'), false)

  assert.equal((await api('POST', '/api/projects', { name: 'demo', repoUrl: repoDir })).status, 409)

  const updated = await api('PATCH', `/api/projects/${created.body.id}`, { authType: 'none', defaultBranch: 'dev' })
  assert.equal(updated.body.hasCredential, false)
  assert.equal(updated.body.defaultBranch, 'dev')

  const webhook = await api('GET', `/api/projects/${created.body.id}/webhook`)
  assert.match(webhook.body.url, /\/api\/hooks\/github\/\d+$/)
  assert.equal(webhook.body.secret.length, 48)

  assert.equal((await api('DELETE', `/api/projects/${created.body.id}`)).status, 204)
  assert.equal((await api('GET', `/api/projects/${created.body.id}`)).status, 404)
})

test('scripts endpoint lists .BScript scripts from the repo', async (t) => {
  const { api, repoDir, repo } = await makeServer(t, { scripts: { 'a.sh': '', 'deploy/b.sh': '' } })
  const project = (await api('POST', '/api/projects', { name: 'demo', repoUrl: repoDir })).body
  const res = await api('GET', `/api/projects/${project.id}/scripts`)
  assert.deepEqual(res.body, { ref: 'main', commitSha: repo.sha, scripts: ['a.sh', 'deploy/b.sh'] })
  assert.equal((await api('GET', `/api/projects/${project.id}/scripts?ref=nope`)).status, 502)
})

test('pipelines: create with steps, reorder, reject path traversal and duplicate steps', async (t) => {
  const { api, repoDir } = await makeServer(t)
  const project = (await api('POST', '/api/projects', { name: 'demo', repoUrl: repoDir })).body
  const created = await api('POST', `/api/projects/${project.id}/pipelines`, {
    name: 'ci',
    triggers: { push: true },
    steps: [{ scriptPath: 'a.sh' }, { scriptPath: 'b.sh', continueOnError: true, timeoutSec: 60 }],
  })
  assert.equal(created.status, 201)
  assert.deepEqual(created.body.triggers, { manual: true, push: true, pull_request: false, cron: false })
  assert.deepEqual(created.body.steps.map((s) => s.scriptPath), ['a.sh', 'b.sh'])

  const reordered = await api('PUT', `/api/pipelines/${created.body.id}/steps`, [
    { scriptPath: 'b.sh', name: 'Build' },
    { scriptPath: 'a.sh' },
  ])
  assert.deepEqual(reordered.body.map((s) => [s.position, s.name]), [[0, 'Build'], [1, 'a.sh']])

  const traversal = await api('PUT', `/api/pipelines/${created.body.id}/steps`, [{ scriptPath: '../evil.sh' }])
  assert.equal(traversal.status, 400)

  const duplicate = await api('PUT', `/api/pipelines/${created.body.id}/steps`, [{ scriptPath: 'a.sh' }, { scriptPath: 'a.sh' }])
  assert.equal(duplicate.status, 400)
  assert.match(duplicate.body.error, /already a step/)
})

test('env vars: secret values are write-only and BSCRIPT_ names are reserved', async (t) => {
  const { api, repoDir } = await makeServer(t)
  const project = (await api('POST', '/api/projects', { name: 'demo', repoUrl: repoDir })).body
  const base = `/api/projects/${project.id}/env`

  assert.equal((await api('PUT', `${base}/MODE`, { value: 'ci' })).status, 204)
  assert.equal((await api('PUT', `${base}/TOKEN`, { value: 'abc123', secret: true })).status, 204)
  assert.deepEqual((await api('GET', base)).body, [
    { key: 'MODE', secret: false, value: 'ci' },
    { key: 'TOKEN', secret: true, value: null },
  ])
  assert.equal((await api('PUT', `${base}/BSCRIPT_X`, { value: '1' })).status, 400)
  assert.equal((await api('PUT', `${base}/bad-name`, { value: '1' })).status, 400)
  assert.equal((await api('DELETE', `${base}/MODE`)).status, 204)
  assert.equal((await api('DELETE', `${base}/MODE`)).status, 404)
})
