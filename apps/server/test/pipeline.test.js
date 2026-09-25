import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { listScriptsAtCommit, syncMirror } from '../src/runner/git.js'
import { discoverScripts } from '../src/runner/discover.js'
import { runPipeline } from '../src/runner/pipeline.js'
import { makeRepo, tempDir } from './helpers.js'

function setup(t, scripts) {
  const root = tempDir(t)
  const repoDir = path.join(root, 'repo')
  const { sha, git } = makeRepo(repoDir, scripts)
  const paths = {
    reposDir: path.join(root, 'repos'),
    workDir: path.join(root, 'work'),
    logsDir: path.join(root, 'logs'),
    tmpDir: path.join(root, 'tmp'),
  }
  const repo = { url: repoDir, mirrorDir: path.join(paths.reposDir, 'r.git'), auth: { type: 'none' } }
  return { repoDir, sha, git, paths, repo }
}

const steps = (...scripts) => scripts.map((script) => ({ script, timeoutSec: 30 }))

test('discovers scripts recursively, from a checkout and from the mirror', async (t) => {
  const ctx = setup(t, {
    'build.sh': 'echo build',
    'deploy/prod.sh': 'echo prod',
    'tools/run': '#!/bin/bash\necho exec',
    'notes.txt': 'not a script',
    '_lib/log.sh': 'log() { echo "$@"; }',
    'deploy/_helpers.sh': '',
  })
  assert.deepEqual(await discoverScripts(ctx.repoDir), ['build.sh', 'deploy/prod.sh', 'tools/run'])
  await syncMirror({ ...ctx.repo, tmpDir: ctx.paths.tmpDir })
  assert.deepEqual(await listScriptsAtCommit(ctx.repo.mirrorDir, ctx.sha), [
    'build.sh',
    'deploy/prod.sh',
    'tools/run',
  ])
})

test('runs steps in order in a shared workspace with env and built-ins', async (t) => {
  const ctx = setup(t, {
    '1-write.sh': 'echo "from step 1" > artifact.txt',
    '2-read.sh': 'cat artifact.txt; echo "greeting=$GREETING sha=$BSCRIPT_COMMIT_SHA step=$BSCRIPT_STEP_INDEX"',
  })
  const events = []
  const summary = await runPipeline({
    runKey: 'r1',
    repo: ctx.repo,
    ref: 'main',
    steps: steps('1-write.sh', '2-read.sh'),
    vars: [{ key: 'GREETING', value: 'hi' }],
    paths: ctx.paths,
    onEvent: (e) => events.push(e),
  })

  assert.equal(summary.status, 'success', summary.error)
  assert.equal(summary.commitSha, ctx.sha)
  const log = fs.readFileSync(summary.steps[1].logPath, 'utf8')
  assert.match(log, /from step 1/)
  assert.match(log, new RegExp(`greeting=hi sha=${ctx.sha} step=1`))
  assert.deepEqual(
    events.filter((e) => e.type.startsWith('step:') && e.type !== 'step:log').map((e) => `${e.type}:${e.index}`),
    ['step:start:0', 'step:end:0', 'step:start:1', 'step:end:1'],
  )
  assert.equal(fs.existsSync(summary.workspaceDir), false, 'workspace should be cleaned up')
})

test('stops at the first failure and skips the rest', async (t) => {
  const ctx = setup(t, { 'a.sh': 'exit 0', 'b.sh': 'exit 2', 'c.sh': 'echo never' })
  const summary = await runPipeline({
    runKey: 'r2',
    repo: ctx.repo,
    ref: 'main',
    steps: steps('a.sh', 'b.sh', 'c.sh'),
    paths: ctx.paths,
  })
  assert.equal(summary.status, 'failed')
  assert.deepEqual(summary.steps.map((s) => s.status), ['success', 'failed', 'skipped'])
  assert.equal(summary.steps[1].exitCode, 2)
})

test('continue-on-error lets later steps run and the run still succeeds', async (t) => {
  const ctx = setup(t, { 'lint.sh': 'exit 1', 'test.sh': 'exit 0' })
  const summary = await runPipeline({
    runKey: 'r3',
    repo: ctx.repo,
    ref: 'main',
    steps: [{ script: 'lint.sh', continueOnError: true }, { script: 'test.sh' }],
    paths: ctx.paths,
  })
  assert.equal(summary.status, 'success')
  assert.deepEqual(summary.steps.map((s) => s.status), ['failed', 'success'])
})

test('secrets are masked in logs', async (t) => {
  const ctx = setup(t, { 'leak.sh': 'echo "token is $API_TOKEN"' })
  const summary = await runPipeline({
    runKey: 'r4',
    repo: ctx.repo,
    ref: 'main',
    steps: steps('leak.sh'),
    vars: [{ key: 'API_TOKEN', value: 's3cr3t-value', secret: true }],
    paths: ctx.paths,
  })
  assert.equal(fs.readFileSync(summary.steps[0].logPath, 'utf8'), 'token is ***\n')
})

test('picks up new commits on the next run and checks out an exact sha', async (t) => {
  const ctx = setup(t, { 'v.sh': 'echo v1' })
  await runPipeline({ runKey: 'a', repo: ctx.repo, ref: 'main', steps: steps('v.sh'), paths: ctx.paths })
  fs.writeFileSync(path.join(ctx.repoDir, '.BScript/v.sh'), 'echo v2')
  ctx.git('commit', '--quiet', '-am', 'v2')

  const latest = await runPipeline({ runKey: 'b', repo: ctx.repo, ref: 'main', steps: steps('v.sh'), paths: ctx.paths })
  assert.equal(fs.readFileSync(latest.steps[0].logPath, 'utf8'), 'v2\n')

  const pinned = await runPipeline({ runKey: 'c', repo: ctx.repo, ref: ctx.sha, steps: steps('v.sh'), paths: ctx.paths })
  assert.equal(fs.readFileSync(pinned.steps[0].logPath, 'utf8'), 'v1\n')
})

test('a missing script or a script outside .BScript fails the step', async (t) => {
  const ctx = setup(t, { 'ok.sh': 'exit 0' })
  const summary = await runPipeline({
    runKey: 'r5',
    repo: ctx.repo,
    ref: 'main',
    steps: [{ script: 'missing.sh', continueOnError: true }, { script: '../README' }],
    paths: ctx.paths,
  })
  assert.deepEqual(summary.steps.map((s) => s.status), ['failed', 'failed'])
  assert.match(fs.readFileSync(summary.steps[1].logPath, 'utf8'), /outside \.BScript/)
})

test('an unknown ref fails the run before any step starts', async (t) => {
  const ctx = setup(t, { 'a.sh': 'exit 0' })
  const summary = await runPipeline({ runKey: 'r6', repo: ctx.repo, ref: 'nope', steps: steps('a.sh'), paths: ctx.paths })
  assert.equal(summary.status, 'failed')
  assert.match(summary.error, /not found/)
  assert.deepEqual(summary.steps.map((s) => s.status), ['skipped'])
})

test('cancelling mid-run cancels the current step and the run', async (t) => {
  const ctx = setup(t, { 'slow.sh': 'sleep 30', 'after.sh': 'exit 0' })
  const controller = new AbortController()
  const summary = await runPipeline({
    runKey: 'r7',
    repo: ctx.repo,
    ref: 'main',
    steps: steps('slow.sh', 'after.sh'),
    paths: ctx.paths,
    signal: controller.signal,
    onEvent: (e) => e.type === 'step:start' && setTimeout(() => controller.abort(), 200),
  })
  assert.equal(summary.status, 'cancelled')
  assert.deepEqual(summary.steps.map((s) => s.status), ['cancelled', 'cancelled'])
})
