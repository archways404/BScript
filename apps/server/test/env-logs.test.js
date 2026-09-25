import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { buildStepEnv } from '../src/runner/env.js'
import { createMasker, createStepLog } from '../src/runner/logs.js'
import { tempDir } from './helpers.js'

test('step env does not inherit server env and built-ins win over user vars', () => {
  process.env.BSCRIPT_SECRET_KEY = 'server-only'
  const { env } = buildStepEnv({
    vars: [{ key: 'BSCRIPT_RUN_ID', value: 'spoofed' }, { key: 'FOO', value: 'bar' }],
    builtins: { BSCRIPT_RUN_ID: 7 },
  })
  assert.equal(env.BSCRIPT_SECRET_KEY, undefined)
  assert.equal(env.BSCRIPT_RUN_ID, '7')
  assert.equal(env.FOO, 'bar')
  delete process.env.BSCRIPT_SECRET_KEY
})

test('secrets are dropped when includeSecrets is false (fork PRs)', () => {
  const vars = [{ key: 'TOKEN', value: 'abcd1234', secret: true }, { key: 'MODE', value: 'ci' }]
  const { env, secrets } = buildStepEnv({ vars, includeSecrets: false })
  assert.equal(env.TOKEN, undefined)
  assert.equal(env.MODE, 'ci')
  assert.deepEqual(secrets, [])
})

test('invalid env var names are rejected', () => {
  assert.throws(() => buildStepEnv({ vars: [{ key: 'BAD-NAME', value: 'x' }] }))
})

test('masker hides secrets, longest first, and skips very short values', () => {
  const mask = createMasker(['abcd', 'abcdef', 'ok'])
  assert.equal(mask('x abcdef y abcd ok'), 'x *** y *** ok')
})

test('step log masks a secret split across chunks', async (t) => {
  const file = path.join(tempDir(t), 'step.log')
  const lines = []
  const log = createStepLog({ file, secrets: ['supersecret'], onLine: (l) => lines.push(l.line) })
  log.write('stdout', Buffer.from('token=super'))
  log.write('stdout', Buffer.from('secret\nnext'))
  await log.close()
  assert.deepEqual(lines, ['token=***', 'next'])
  assert.equal(fs.readFileSync(file, 'utf8'), 'token=***\nnext\n')
})
