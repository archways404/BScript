import crypto from 'node:crypto'
import path from 'node:path'
import { ensureAdmin } from '../src/auth/admin.js'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { createCipher } from '../src/crypto.js'
import { openDatabase } from '../src/db/index.js'
import { createRunQueue } from '../src/runner/queue.js'
import { createScheduler } from '../src/triggers/scheduler.js'
import { getRun } from '../src/store/runs.js'
import { makeRepo, tempDir } from './helpers.js'

export const PASSWORD = 'correct horse battery'
const silent = { error() {}, warn() {}, info() {} }

export async function makeServer(t, { env = {}, scripts = { 'build.sh': 'echo built' }, start = true } = {}) {
  const root = tempDir(t)
  const repoDir = path.join(root, 'repo')
  const repo = makeRepo(repoDir, scripts)
  const config = loadConfig({
    BSCRIPT_DATA_DIR: path.join(root, 'data'),
    BSCRIPT_ADMIN_PASSWORD: PASSWORD,
    MAX_CONCURRENT_RUNS: '2',
    ...env,
  })
  const secretKey = crypto.randomBytes(32)
  const cipher = createCipher(secretKey)
  const db = openDatabase(':memory:')
  const queue = createRunQueue({ db, cipher, config, log: silent })
  const scheduler = createScheduler({ db, queue, log: silent })
  const app = await buildApp({ config, db, cipher, secretKey, queue, scheduler, logger: false, webDist: '/nonexistent' })
  await ensureAdmin(db, config, silent)
  if (start) await queue.start()
  t.after(async () => {
    scheduler.stop()
    await queue.stop()
    await app.close()
  })

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'admin', password: PASSWORD },
  })
  const cookie = login.headers['set-cookie'].split(';')[0]

  // Authenticated request helper: api('POST', '/api/projects', body)
  async function api(method, url, payload, headers = { cookie }) {
    const res = await app.inject({ method, url, payload, headers })
    return { status: res.statusCode, body: res.body ? safeJson(res.body) : null, raw: res }
  }

  return { app, db, queue, scheduler, config, cipher, repoDir, repo, cookie, api }
}

function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export async function waitForRun(db, id, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const run = getRun(db, id, { withSteps: true })
    if (['success', 'failed', 'cancelled'].includes(run?.status)) return run
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error(`Run ${id} did not finish in ${timeoutMs}ms`)
}

export async function waitFor(check, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = check()
    if (value) return value
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('Condition not met in time')
}

// Creates a project for the test repo and a pipeline with the given steps.
export async function makePipeline(server, steps = [{ scriptPath: 'build.sh' }], name = 'ci') {
  let project = (await server.api('GET', '/api/projects')).body[0]
  if (!project) {
    project = (await server.api('POST', '/api/projects', { name: 'demo', repoUrl: server.repoDir })).body
  }
  const pipeline = (await server.api('POST', `/api/projects/${project.id}/pipelines`, { name, steps })).body
  return { project, pipeline }
}
