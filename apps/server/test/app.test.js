import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { openDatabase } from '../src/db/index.js'
import { tempDir } from './helpers.js'

test('GET /api/health reports ok', async (t) => {
  const app = await buildApp({ config: loadConfig({}), db: openDatabase(':memory:'), logger: false, webDist: '/nonexistent' })
  t.after(() => app.close())
  const res = await app.inject({ method: 'GET', url: '/api/health' })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.json(), { ok: true, db: true })
})

test('serves the built UI with SPA fallback, but 404s unknown API routes', async (t) => {
  const webDist = tempDir(t)
  fs.writeFileSync(path.join(webDist, 'index.html'), '<title>BScript</title>')

  const app = await buildApp({ config: loadConfig({}), db: openDatabase(':memory:'), logger: false, webDist })
  t.after(() => app.close())

  assert.match((await app.inject({ url: '/' })).body, /BScript/)
  assert.match((await app.inject({ url: '/projects/1' })).body, /BScript/)
  const api = await app.inject({ url: '/api/nope' })
  assert.equal(api.statusCode, 404)
  assert.deepEqual(api.json(), { error: 'Not found' })
})
