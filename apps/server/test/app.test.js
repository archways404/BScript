import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { createCipher } from '../src/crypto.js'
import { openDatabase } from '../src/db/index.js'
import { tempDir } from './helpers.js'

function build(t, webDist) {
  const secretKey = crypto.randomBytes(32)
  return buildApp({
    config: loadConfig({}),
    db: openDatabase(':memory:'),
    cipher: createCipher(secretKey),
    secretKey,
    queue: null,
    logger: false,
    webDist,
  }).then((app) => {
    t.after(() => app.close())
    return app
  })
}

test('GET /api/health reports ok without login', async (t) => {
  const app = await build(t, '/nonexistent')
  const res = await app.inject({ url: '/api/health' })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.json(), { ok: true, db: true })
})

test('serves the built UI with SPA fallback; API paths never get the UI', async (t) => {
  const webDist = tempDir(t)
  fs.writeFileSync(path.join(webDist, 'index.html'), '<title>BScript</title>')
  const app = await build(t, webDist)

  assert.match((await app.inject({ url: '/' })).body, /BScript/)
  assert.match((await app.inject({ url: '/projects/1' })).body, /BScript/)
  const api = await app.inject({ url: '/api/nope' })
  assert.equal(api.statusCode, 401)
  assert.doesNotMatch(api.body, /BScript/)
})
