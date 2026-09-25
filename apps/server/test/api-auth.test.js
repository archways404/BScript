import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PASSWORD, makeServer } from './server-helpers.js'

test('API routes require login; health does not', async (t) => {
  const { app } = await makeServer(t)
  assert.equal((await app.inject({ url: '/api/health' })).statusCode, 200)
  assert.equal((await app.inject({ url: '/api/projects' })).statusCode, 401)
  assert.equal((await app.inject({ url: '/api/nope' })).statusCode, 401)
  const me = await app.inject({ url: '/api/auth/me' })
  assert.equal(me.statusCode, 200)
  assert.deepEqual(me.json(), { via: null })
})

test('login sets a working session cookie; wrong password is refused', async (t) => {
  const { app, api } = await makeServer(t)
  const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'nope' } })
  assert.equal(bad.statusCode, 401)
  assert.deepEqual((await api('GET', '/api/auth/me')).body, { via: 'session', user: 'admin' })
})

test('login is rate limited after repeated failures', async (t) => {
  const { app } = await makeServer(t)
  const attempt = (password) =>
    app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password } })
  for (let i = 0; i < 10; i++) await attempt('wrong')
  assert.equal((await attempt(PASSWORD)).statusCode, 429)
})

test('changing the password logs out other sessions', async (t) => {
  const { app, api, cookie } = await makeServer(t)
  const res = await api('POST', '/api/auth/password', { currentPassword: PASSWORD, newPassword: 'another-password' })
  assert.equal(res.status, 200)
  const fresh = res.raw.headers['set-cookie'].split(';')[0]
  assert.equal((await app.inject({ url: '/api/projects', headers: { cookie } })).statusCode, 401)
  assert.equal((await app.inject({ url: '/api/projects', headers: { cookie: fresh } })).statusCode, 200)
})

test('API tokens work for normal routes but not for token management', async (t) => {
  const { app, api } = await makeServer(t)
  const created = await api('POST', '/api/tokens', { name: 'ci-bot' })
  assert.equal(created.status, 201)
  assert.match(created.body.token, /^bst_/)
  const auth = { authorization: `Bearer ${created.body.token}` }

  assert.equal((await app.inject({ url: '/api/projects', headers: auth })).statusCode, 200)
  assert.equal((await app.inject({ url: '/api/tokens', headers: auth })).statusCode, 403)
  assert.equal((await app.inject({ url: '/api/projects', headers: { authorization: 'Bearer bst_bogus' } })).statusCode, 401)

  const listed = await api('GET', '/api/tokens')
  assert.equal(listed.body[0].token, undefined, 'raw token is never listed')
  assert.ok(listed.body[0].lastUsedAt)
})
