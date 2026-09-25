import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { runScript } from '../src/runner/executor/local.js'
import { tempDir } from './helpers.js'

function script(t, body) {
  const dir = tempDir(t)
  const file = path.join(dir, 's.sh')
  fs.writeFileSync(file, body)
  return { dir, file }
}

function exec(t, body, opts = {}) {
  const { dir, file } = script(t, body)
  const output = []
  return runScript({
    scriptFile: file,
    cwd: dir,
    env: { PATH: process.env.PATH, ...opts.env },
    onOutput: (stream, chunk) => output.push([stream, chunk.toString()]),
    ...opts,
  }).then((result) => ({ ...result, output }))
}

test('reports exit code and captures stdout and stderr', async (t) => {
  const result = await exec(t, 'echo out; echo err >&2; exit 3')
  assert.equal(result.exitCode, 3)
  assert.ok(result.output.some(([s, c]) => s === 'stdout' && c.includes('out')))
  assert.ok(result.output.some(([s, c]) => s === 'stderr' && c.includes('err')))
})

test('timeout kills the script and its children', async (t) => {
  const { dir } = script(t, '')
  const marker = path.join(dir, 'child-survived')
  const started = Date.now()
  const result = await exec(t, `(sleep 2; touch "${marker}") & sleep 30`, { timeoutSec: 1 })
  assert.equal(result.timedOut, true)
  assert.ok(Date.now() - started < 5000)
  await new Promise((r) => setTimeout(r, 2500))
  assert.equal(fs.existsSync(marker), false)
})

test('abort signal cancels a running script', async (t) => {
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 200)
  const result = await exec(t, 'sleep 30', { signal: controller.signal })
  assert.equal(result.cancelled, true)
})

test('background processes left behind do not hang the step', async (t) => {
  const started = Date.now()
  const result = await exec(t, 'sleep 30 & echo done')
  assert.equal(result.exitCode, 0)
  assert.ok(Date.now() - started < 3000)
})
