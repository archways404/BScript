import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import http from 'node:http'
import path from 'node:path'
import { test } from 'node:test'
import { ensureAdmin } from '../src/auth/admin.js'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { createCipher } from '../src/crypto.js'
import { openDatabase } from '../src/db/index.js'
import { pingRegistry } from '../src/registry/ping.js'
import { planCleanup } from '../src/registry/retention.js'
import { createRegistryService } from '../src/registry/service.js'
import { createRunQueue } from '../src/runner/queue.js'
import { listTags } from '../src/store/registry.js'
import { makeRepo, tempDir } from './helpers.js'
import { PASSWORD, waitFor, waitForRun } from './server-helpers.js'

const FAKE_REGISTRY = path.resolve(import.meta.dirname, 'fixtures/fake-registry.mjs')
const silent = { error() {}, warn() {}, info() {} }
const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
const ADMIN = basic('admin', PASSWORD)

async function poll(check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await check()
    if (value) return value
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('Condition not met in time')
}

// A real listening server: the registry process sends its notifications over HTTP.
async function startServer(t, { scripts = { 'noop.sh': 'true' } } = {}) {
  const root = tempDir(t)
  const repoDir = path.join(root, 'repo')
  makeRepo(repoDir, scripts)
  const config = loadConfig({
    BSCRIPT_DATA_DIR: path.join(root, 'data'),
    BSCRIPT_ADMIN_PASSWORD: PASSWORD,
    BSCRIPT_REGISTRY_BIN: FAKE_REGISTRY,
  })
  const secretKey = crypto.randomBytes(32)
  const cipher = createCipher(secretKey)
  const db = openDatabase(':memory:')
  await ensureAdmin(db, config, silent)
  const registry = createRegistryService({ db, cipher, config, log: silent })
  const queue = createRunQueue({ db, cipher, config, registry, log: silent })
  const app = await buildApp({ config, db, cipher, secretKey, queue, registry, logger: false, webDist: '/nonexistent' })
  await app.listen({ port: 0, host: '127.0.0.1' })
  config.port = app.server.address().port
  config.registryAddress = `127.0.0.1:${config.port}`
  config.registryQuietMs = 0
  await queue.start()
  await registry.start()
  t.after(async () => {
    await queue.stop()
    await registry.stop()
    await app.close()
  })

  const base = `http://127.0.0.1:${config.port}`
  const cookie = (await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: PASSWORD }),
  })).headers.get('set-cookie').split(';')[0]

  async function api(method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: { cookie, ...(body !== undefined && { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }

  // Pushes a fake image manifest through the proxy.
  async function push(repository, tag, { layers = [1000, 2000], auth = ADMIN } = {}) {
    const manifest = {
      schemaVersion: 2,
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      config: { mediaType: 'application/vnd.oci.image.config.v1+json', size: 100, digest: `sha256:${'c'.repeat(64)}` },
      layers: layers.map((size, i) => ({ mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip', size, digest: `sha256:${String(i).repeat(64)}`, n: crypto.randomUUID() })),
    }
    return fetch(`${base}/v2/${repository}/manifests/${tag}`, {
      method: 'PUT',
      headers: { authorization: auth, 'content-type': manifest.mediaType },
      body: JSON.stringify(manifest),
    })
  }

  return { app, db, registry, queue, config, base, api, push, repoDir }
}

test('the registry starts, and /v2/ needs credentials: admin, API token or nothing for public pulls', async (t) => {
  const s = await startServer(t)
  assert.equal((await s.api('GET', '/api/registry')).body.state, 'running')

  const anonymous = await fetch(`${s.base}/v2/`)
  assert.equal(anonymous.status, 401)
  assert.equal(anonymous.headers.get('www-authenticate'), 'Basic realm="BScript Registry"')
  assert.equal(anonymous.headers.get('docker-distribution-api-version'), 'registry/2.0')

  assert.equal((await fetch(`${s.base}/v2/`, { headers: { authorization: ADMIN } })).status, 200)
  assert.equal((await fetch(`${s.base}/v2/`, { headers: { authorization: basic('admin', 'wrong') } })).status, 401)
  const { token } = (await s.api('POST', '/api/tokens', { name: 'k8s' })).body
  assert.equal((await fetch(`${s.base}/v2/`, { headers: { authorization: basic('anything', token) } })).status, 200)

  await s.api('PUT', '/api/registry/settings', { publicPull: true })
  assert.equal((await fetch(`${s.base}/v2/_catalog`)).status, 200, 'anonymous pulls allowed')
  assert.equal((await s.push('team/app', 'v1', { auth: '' })).status, 401, 'anonymous pushes still refused')
})

test('pushes and pulls are recorded with size and times; deletes remove the tag only', async (t) => {
  const s = await startServer(t)
  assert.equal((await s.push('team/app', 'v1')).status, 201)
  assert.equal((await s.push('team/app', 'latest')).status, 201)

  const recorded = await waitFor(() => listTags(s.db, 'team/app').filter((tag) => tag.size != null).length === 2 && listTags(s.db, 'team/app'))
  assert.deepEqual(recorded.map((tag) => [tag.tag, tag.size]).sort(), [['latest', 3100], ['v1', 3100]])
  assert.equal(recorded[0].lastPulledAt, null, "sizing an image isn't a pull")

  await fetch(`${s.base}/v2/team/app/manifests/v1`, { headers: { authorization: ADMIN, accept: 'application/vnd.oci.image.manifest.v1+json' } })
  await waitFor(() => listTags(s.db, 'team/app').find((tag) => tag.tag === 'v1').lastPulledAt)

  const overview = (await s.api('GET', '/api/registry')).body
  assert.deepEqual(overview.usage.repositories, 1)
  assert.deepEqual(overview.repositories.map((r) => [r.repository, r.tags]), [['team/app', 2]])

  const deleted = await s.api('POST', '/api/registry/tags/delete', { items: [{ repository: 'team/app', tag: 'v1' }] })
  assert.deepEqual(deleted.body.map((r) => r.ok), [true])
  assert.deepEqual(listTags(s.db, 'team/app').map((tag) => tag.tag), ['latest'])
  const tags = await (await fetch(`${s.base}/v2/team/app/tags/list`, { headers: { authorization: ADMIN } })).json()
  assert.deepEqual(tags.tags, ['latest'])
})

test('sync picks up tags the notifications missed and drops stale ones', async (t) => {
  const s = await startServer(t)
  await s.push('app', 'one')
  await waitFor(() => listTags(s.db).length === 1)
  s.db.prepare('DELETE FROM registry_tags').run()
  s.db.prepare("INSERT INTO registry_tags (repository, tag, digest, pushed_at) VALUES ('gone', 'x', 'sha256:x', '2020-01-01')").run()

  assert.deepEqual((await s.api('POST', '/api/registry/sync')).body, { added: 1, removed: 1 })
  assert.deepEqual(listTags(s.db).map((tag) => `${tag.repository}:${tag.tag}`), ['app:one'])
})

test('planCleanup keeps protected and recent tags, per-repo rules win, and estimates space', () => {
  const day = 24 * 60 * 60 * 1000
  const now = Date.parse('2026-09-25T00:00:00Z')
  const tag = (repository, name, ageDays, digest = `${repository}-${name}`) => ({
    repository,
    tag: name,
    digest,
    size: 100,
    pushedAt: new Date(now - ageDays * day).toISOString(),
  })
  const tags = [
    tag('web', 'latest', 90, 'shared'),
    tag('web', 'v1.0', 80),
    tag('web', 'build-1', 60, 'shared'),
    tag('web', 'build-2', 50),
    tag('web', 'build-3', 40),
    tag('web', 'build-4', 2),
    tag('infra/db', 'build-1', 100),
    tag('infra/db', 'build-2', 99),
  ]
  const retention = { keepLast: 2, olderThanDays: 30, protect: 'latest, v*', rules: [{ repository: 'infra/**', keepForever: true }] }
  const { tags: doomed, reclaimableBytes } = planCleanup(tags, retention, now)
  assert.deepEqual(doomed.map((t) => `${t.repository}:${t.tag}`), ['web:build-2', 'web:build-1'])
  assert.equal(reclaimableBytes, 100, 'build-1 shares its image with latest, so only build-2 frees space')
  assert.match(doomed[0].reason, /beyond the newest 2, older than 30 days/)

  const countOnly = planCleanup(tags, { keepLast: 1, olderThanDays: null, protect: '', rules: [] }, now)
  assert.equal(countOnly.tags.filter((t) => t.repository === 'web').length, 5)
  assert.deepEqual(planCleanup(tags, { keepLast: null, olderThanDays: null, rules: [] }, now).tags, [])
})

test('cleanup deletes what the policy picks, garbage-collects, and records the result', async (t) => {
  const s = await startServer(t)
  for (const name of ['latest', 'b1', 'b2', 'b3']) await s.push('web', name, { layers: [5000 + name.length] })
  await waitFor(() => listTags(s.db, 'web').length === 4)
  s.db.prepare("UPDATE registry_tags SET pushed_at = '2020-01-01T00:00:00Z' WHERE tag != 'b3'").run()
  await s.api('PUT', '/api/registry/settings', { retention: { keepLast: 1, olderThanDays: 7, protect: 'latest' } })

  const preview = (await s.api('GET', '/api/registry/cleanup/preview')).body
  assert.deepEqual(preview.tags.map((t) => t.tag).sort(), ['b1', 'b2'])

  assert.equal((await s.api('POST', '/api/registry/cleanup', {})).status, 202)
  const [cleanup] = await poll(async () => {
    const list = (await s.api('GET', '/api/registry/cleanups')).body
    return list[0]?.status !== 'running' && list
  })
  assert.equal(cleanup.status, 'success', cleanup.error)
  assert.equal(cleanup.deletedTags, 2)
  assert.ok(cleanup.freedBytes >= 10000, `freed ${cleanup.freedBytes}`)
  assert.match(cleanup.log, /2 manifests eligible for deletion/)
  assert.deepEqual(listTags(s.db, 'web').map((t) => t.tag).sort(), ['b3', 'latest'])
  await waitFor(() => s.registry.process.status().state === 'running')
})

test('runs get registry credentials that expire with the run; passwords are masked', async (t) => {
  const s = await startServer(t, {
    scripts: {
      'use.sh': [
        'set -euo pipefail',
        'echo "user=$BSCRIPT_REGISTRY_USER registry=$BSCRIPT_REGISTRY"',
        'echo "pw=$BSCRIPT_REGISTRY_PASSWORD"',
        'curl -s -o /dev/null -w "catalog=%{http_code}\\n" -u "$BSCRIPT_REGISTRY_USER:$BSCRIPT_REGISTRY_PASSWORD" "http://$BSCRIPT_REGISTRY/v2/_catalog"',
        'node -e "console.log(\'auths=\' + Object.keys(require(process.env.DOCKER_CONFIG + \'/config.json\').auths).join(\',\'))"',
        'echo "$BSCRIPT_REGISTRY_PASSWORD" > "$BSCRIPT_WORKSPACE/../token.txt"',
        'grep -o "\\"auth\\": \\"[^\\"]*" "$DOCKER_CONFIG/config.json" | head -1 | cut -c10- | base64 -d; echo',
      ].join('\n'),
    },
  })
  await s.api('POST', '/api/registries', { name: 'GHCR', url: 'ghcr.io', username: 'octo', password: 'ghp_supersecret' })
  const project = (await s.api('POST', '/api/projects', { name: 'p', repoUrl: s.repoDir })).body
  const pipeline = (await s.api('POST', `/api/projects/${project.id}/pipelines`, { name: 'ci', steps: [{ scriptPath: 'use.sh' }] })).body

  const run = await waitForRun(s.db, (await s.api('POST', `/api/pipelines/${pipeline.id}/runs`, {})).body.id)
  assert.equal(run.status, 'success', run.error)
  const log = (await fetch(`${s.base}/api/runs/${run.id}/steps/0/log`, { headers: { cookie: (await s.api('GET', '/api/auth/me')) && '' } })).status
  assert.ok(log)
  const text = await (await fetch(`${s.base}/api/runs/${run.id}/steps/0/log`, {
    headers: { authorization: `Bearer ${(await s.api('POST', '/api/tokens', { name: 'read' })).body.token}` },
  })).text()
  assert.match(text, new RegExp(`user=bscript-run registry=${s.config.registryAddress}`))
  assert.match(text, /pw=\*\*\*/)
  assert.match(text, /catalog=200/)
  assert.match(text, new RegExp(`auths=ghcr.io,${s.config.registryAddress.replace('.', '\\.')}`))
  assert.match(text, /octo:\*\*\*/, 'external registry password masked too')

  const token = (await import('node:fs')).readFileSync(path.join(s.config.workDir, 'token.txt'), 'utf8').trim()
  assert.equal((await fetch(`${s.base}/v2/`, { headers: { authorization: basic('bscript-run', token) } })).status, 401, 'token revoked after the run')
})

test('external registries: credentials stay hidden and connections can be tested', async (t) => {
  const s = await startServer(t)
  const created = await s.api('POST', '/api/registries', { name: 'self', url: `http://127.0.0.1:${s.config.port}`, username: 'admin', password: PASSWORD })
  assert.equal(created.status, 201)
  assert.equal(created.body.hasPassword, true)
  assert.equal(JSON.stringify(created.body).includes(PASSWORD), false)

  assert.equal((await s.api('POST', `/api/registries/${created.body.id}/test`)).body.ok, true)
  const bad = await s.api('POST', '/api/registries/test', { url: `http://127.0.0.1:${s.config.port}`, username: 'admin', password: 'nope' })
  assert.deepEqual(bad.body, { ok: false, message: 'Credentials were rejected' })
  const reuse = await s.api('POST', '/api/registries/test', { id: created.body.id, url: `http://127.0.0.1:${s.config.port}`, username: 'admin' })
  assert.equal(reuse.body.ok, true, 'an empty password reuses the stored one')

  assert.equal((await s.api('DELETE', `/api/registries/${created.body.id}`)).status, 204)
})

test('pingRegistry follows Bearer token challenges like Docker Hub', async (t) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/token') {
      const ok = req.headers.authorization === basic('user', 'pass') && url.searchParams.get('service') === 'reg'
      res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(ok ? { token: 'tok' } : {}))
    }
    if (req.headers.authorization === 'Bearer tok') return res.writeHead(200).end('{}')
    res.writeHead(401, { 'www-authenticate': `Bearer realm="http://127.0.0.1:${server.address().port}/token",service="reg"` }).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const url = `http://127.0.0.1:${server.address().port}`
  assert.equal((await pingRegistry({ url, username: 'user', password: 'pass' })).ok, true)
  assert.match((await pingRegistry({ url, username: 'user', password: 'bad' })).message, /credentials were rejected/)
})

test('turning the registry off stops it and closes /v2/', async (t) => {
  const s = await startServer(t)
  await s.api('PUT', '/api/registry/settings', { enabled: false })
  assert.equal(s.registry.process.status().state, 'stopped')
  assert.equal((await fetch(`${s.base}/v2/`, { headers: { authorization: ADMIN } })).status, 404)
  await s.api('PUT', '/api/registry/settings', { enabled: true })
  assert.equal(s.registry.process.status().state, 'running')
})
