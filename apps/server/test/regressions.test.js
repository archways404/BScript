// Regression tests for bugs found in the September 2026 audit.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { runScript } from '../src/runner/executor/local.js'
import { syncMirror } from '../src/runner/git.js'
import { createStepLog } from '../src/runner/logs.js'
import { runPipeline } from '../src/runner/pipeline.js'
import { makeRepo, tempDir } from './helpers.js'
import { PASSWORD, makePipeline, makeServer, waitForRun } from './server-helpers.js'

test('percent-encoded API paths still require login', async (t) => {
  const { app } = await makeServer(t)
  for (const [method, url] of [['GET', '/%61pi/projects'], ['POST', '/%61pi/tokens'], ['GET', '/api%2Fprojects'], ['GET', '/%2561pi/projects']]) {
    const res = await app.inject({ method, url, payload: method === 'POST' ? { name: 'x' } : undefined })
    assert.ok([401, 404].includes(res.statusCode), `${method} ${url} -> ${res.statusCode}`)
    assert.doesNotMatch(res.body, /bst_/)
  }
})

test('login limit counts attempts before hashing and ignores spoofed X-Forwarded-For', async (t) => {
  const { app } = await makeServer(t)
  const attempt = (password, ip) =>
    app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password }, headers: ip ? { 'x-forwarded-for': ip } : {} })
  const parallel = await Promise.all(Array.from({ length: 15 }, (_, i) => attempt('wrong', `10.0.0.${i}`)))
  assert.ok(parallel.filter((r) => r.statusCode === 429).length >= 5, 'parallel guesses from one client are limited')
  assert.equal((await attempt(PASSWORD, '10.9.9.9')).statusCode, 429, 'a new X-Forwarded-For is not a new client')
})

test('a daemon that escapes the process group does not hold the step open', async (t) => {
  const dir = tempDir(t)
  const file = path.join(dir, 's.sh')
  // Forks, lets the parent exit, and detaches: like `ssh -f` or a self-daemonizing server. The
  // daemon is outside the process group, so it survives and keeps the output pipe open.
  fs.writeFileSync(file, 'python3 -c "import os,sys,time\nif os.fork(): sys.exit(0)\nos.setsid(); time.sleep(30)"\necho started')
  const started = Date.now()
  const result = await runScript({ scriptFile: file, cwd: dir, env: { PATH: process.env.PATH }, onOutput: () => {} })
  assert.equal(result.exitCode, 0)
  assert.ok(Date.now() - started < 6000, `took ${Date.now() - started}ms`)
})

test('multi-line secrets are masked line by line; split UTF-8 survives', async (t) => {
  const file = path.join(tempDir(t), 'log')
  const key = '-----BEGIN KEY-----\nAAAAsecretline1\nBBBBsecretline2\n-----END KEY-----'
  const lines = []
  const log = createStepLog({ file, secrets: [key], onLine: (l) => lines.push(l.line) })
  log.write('stdout', Buffer.from(`${key}\n`))
  const bytes = Buffer.from('héllo\n')
  log.write('stdout', bytes.subarray(0, 2))
  log.write('stdout', bytes.subarray(2))
  await log.close()
  assert.deepEqual(lines, ['***', '***', '***', '***', 'héllo'])
})

test('disabled pipelines and a turned-off manual trigger refuse manual, API and re-runs', async (t) => {
  const server = await makeServer(t)
  const { pipeline } = await makePipeline(server)
  const first = await waitForRun(server.db, (await server.api('POST', `/api/pipelines/${pipeline.id}/runs`, {})).body.id)

  await server.api('PATCH', `/api/pipelines/${pipeline.id}`, { triggers: { manual: false } })
  assert.equal((await server.api('POST', `/api/pipelines/${pipeline.id}/runs`, {})).status, 409)
  assert.equal((await server.api('POST', `/api/runs/${first.id}/rerun`)).status, 409)

  await server.api('PATCH', `/api/pipelines/${pipeline.id}`, { triggers: { manual: true }, enabled: false })
  const disabled = await server.api('POST', `/api/pipelines/${pipeline.id}/runs`, {})
  assert.equal(disabled.status, 409)
  assert.match(disabled.body.error, /disabled/)
})

test('changing the auth type needs a new credential', async (t) => {
  const { api, repoDir } = await makeServer(t)
  const project = (await api('POST', '/api/projects', { name: 'p', repoUrl: repoDir, authType: 'token', credential: 'ghp_x' })).body
  const switched = await api('PATCH', `/api/projects/${project.id}`, { authType: 'ssh' })
  assert.equal(switched.status, 400)
  assert.match(switched.body.error, /new SSH key/)
  assert.equal((await api('PATCH', `/api/projects/${project.id}`, { authType: 'ssh', credential: 'KEY' })).status, 200)
})

test('branches and tags that look like commit ids can be run', async (t) => {
  const root = tempDir(t)
  const repoDir = path.join(root, 'repo')
  const { git } = makeRepo(repoDir, { 'a.sh': 'echo "$BSCRIPT_BRANCH"' })
  git('branch', '20240101')
  const summary = await runPipeline({
    runKey: 'hex',
    repo: { url: repoDir, mirrorDir: path.join(root, 'm.git'), auth: { type: 'none' } },
    ref: '20240101',
    steps: [{ script: 'a.sh' }],
    paths: { reposDir: root, workDir: path.join(root, 'w'), logsDir: path.join(root, 'l'), tmpDir: path.join(root, 't') },
  })
  assert.equal(summary.status, 'success', summary.error)
})

test('git work honours cancellation', async (t) => {
  const root = tempDir(t)
  makeRepo(path.join(root, 'repo'), { 'a.sh': '' })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(syncMirror({ url: path.join(root, 'repo'), mirrorDir: path.join(root, 'm.git'), tmpDir: path.join(root, 't'), signal: controller.signal }))
})

test('fork PR branch names cannot satisfy an environment branch rule', async (t) => {
  const server = await makeServer(t, { env: { BSCRIPT_ALLOW_FORK_PRS: 'true' } })
  const { project, pipeline } = await makePipeline(server)
  const production = (await server.api('POST', `/api/projects/${project.id}/environments`, { name: 'production', branchFilter: 'main' })).body
  await server.api('PATCH', `/api/pipelines/${pipeline.id}`, { environmentId: production.id, triggers: { pull_request: true } })
  const { secret } = (await server.api('GET', `/api/projects/${project.id}/webhook`)).body
  const body = JSON.stringify({
    action: 'opened',
    pull_request: { number: 1, head: { sha: server.repo.sha, ref: 'main', repo: { full_name: 'evil/fork' } }, base: { ref: 'main', repo: { full_name: 'acme/web' } } },
  })
  const res = await server.app.inject({
    method: 'POST',
    url: `/api/hooks/github/${project.id}`,
    payload: body,
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'pull_request',
      'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`,
    },
  })
  assert.deepEqual(res.json().triggered, [])
  assert.match(res.json().skipped[0].reason, /not "evil\/fork:main"/)
})

test('shutdown is not held up by open event streams', { timeout: 15_000 }, async (t) => {
  const server = await makeServer(t)
  await server.app.listen({ port: 0, host: '127.0.0.1' })
  const res = await fetch(`http://127.0.0.1:${server.app.server.address().port}/api/events`, { headers: { cookie: server.cookie } })
  assert.equal(res.headers.get('content-type'), 'text/event-stream')
  const reader = res.body.getReader()
  await reader.read() // the stream is open and delivering

  const closed = await Promise.race([server.app.close().then(() => 'closed'), new Promise((r) => setTimeout(() => r('hung'), 3000))])
  assert.equal(closed, 'closed')
  reader.cancel().catch(() => {})
})

test('queue start clears leftover run credentials from tmp', async (t) => {
  const server = await makeServer(t, { start: false })
  const leftover = path.join(server.config.dataDir, 'tmp', 'run-9-docker')
  fs.mkdirSync(leftover, { recursive: true })
  fs.writeFileSync(path.join(leftover, 'config.json'), '{}')
  await server.queue.start()
  assert.equal(fs.existsSync(leftover), false)
})
