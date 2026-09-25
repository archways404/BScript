import { spawn, execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'

const MAX_BACKOFF_MS = 30_000
const READY_TIMEOUT_MS = 15_000

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

async function binaryExists(bin) {
  if (bin.includes('/')) {
    return fs.access(bin, fs.constants.X_OK).then(() => true, () => false)
  }
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (await fs.access(path.join(dir, bin), fs.constants.X_OK).then(() => true, () => false)) return true
  }
  return false
}

/**
 * Runs the bundled CNCF Distribution registry as a child process on a private localhost port.
 * BScript proxies /v2/ to it (see proxy.js) and receives its push/pull/delete notifications.
 *
 * The config is written as JSON, which is valid YAML, so tests can use a small fake registry
 * that reads the same file. Restarts with backoff if the process dies while enabled.
 */
export function createRegistryProcess({ config, log = console }) {
  const dir = path.join(config.dataDir, 'registry')
  const configFile = path.join(dir, 'config.yml')
  const storageDir = path.join(dir, 'storage')
  const notifySecret = crypto.randomBytes(24).toString('hex')

  let child = null
  let port = null
  let state = 'stopped' // stopped | unavailable | starting | running | maintenance | crashed
  let lastError = null
  let wanted = false
  let backoff = 1000
  let restartTimer = null
  const recentLog = []

  function remember(line) {
    recentLog.push(line)
    if (recentLog.length > 200) recentLog.shift()
  }

  async function writeConfig() {
    const registryConfig = {
      version: 0.1,
      log: { level: 'info', formatter: 'text', fields: { service: 'registry' } },
      storage: {
        filesystem: { rootdirectory: storageDir },
        delete: { enabled: true },
        maintenance: { uploadpurging: { enabled: true, age: '168h', interval: '24h', dryrun: false } },
      },
      http: {
        addr: `127.0.0.1:${port}`,
        relativeurls: true,
        secret: crypto.randomBytes(24).toString('hex'),
        headers: { 'X-Content-Type-Options': ['nosniff'] },
      },
      notifications: {
        events: { includereferences: true },
        endpoints: [
          {
            name: 'bscript',
            url: `http://127.0.0.1:${config.port}/api/internal/registry/events`,
            headers: { Authorization: [`Bearer ${notifySecret}`] },
            timeout: '5s',
            threshold: 5,
            backoff: '2s',
          },
        ],
      },
    }
    await fs.mkdir(storageDir, { recursive: true })
    await fs.writeFile(configFile, JSON.stringify(registryConfig, null, 2), { mode: 0o600 })
  }

  async function waitUntilReady() {
    const deadline = Date.now() + READY_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (!child) throw new Error(lastError ?? 'Registry exited during startup')
      try {
        const res = await fetch(`http://127.0.0.1:${port}/v2/`, { signal: AbortSignal.timeout(1000) })
        if (res.ok) return
      } catch {
        // not listening yet
      }
      await new Promise((r) => setTimeout(r, 150))
    }
    throw new Error('Registry did not become ready in time')
  }

  async function launch() {
    clearTimeout(restartTimer)
    if (!(await binaryExists(config.registryBin))) {
      state = 'unavailable'
      lastError = `Registry binary "${config.registryBin}" not found. It ships in the Docker image; locally set BSCRIPT_REGISTRY_BIN.`
      return
    }
    state = 'starting'
    port = await freePort()
    await writeConfig()

    const proc = spawn(config.registryBin, ['serve', configFile], { stdio: ['ignore', 'pipe', 'pipe'] })
    child = proc
    for (const stream of [proc.stdout, proc.stderr]) {
      stream.setEncoding('utf8')
      stream.on('data', (chunk) => chunk.split('\n').filter(Boolean).forEach(remember))
    }
    proc.on('error', (err) => {
      lastError = err.message
    })
    proc.on('exit', (code, signal) => {
      if (child === proc) child = null
      if (!wanted || state === 'maintenance') return
      state = 'crashed'
      lastError = `Registry exited (${signal ?? `code ${code}`}); restarting in ${backoff / 1000}s`
      log.warn(lastError)
      restartTimer = setTimeout(() => launch().catch((err) => log.error({ err }, 'Registry restart failed')), backoff)
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
    })

    try {
      await waitUntilReady()
      state = 'running'
      lastError = null
      backoff = 1000
    } catch (err) {
      lastError = err.message
      proc.kill('SIGTERM')
      throw err
    }
  }

  function terminate() {
    clearTimeout(restartTimer)
    const proc = child
    if (!proc) return Promise.resolve()
    return new Promise((resolve) => {
      const force = setTimeout(() => proc.kill('SIGKILL'), 10_000)
      proc.once('exit', () => {
        clearTimeout(force)
        resolve()
      })
      proc.kill('SIGTERM')
    })
  }

  return {
    notifySecret,

    async start() {
      wanted = true
      if (child) return
      await launch().catch((err) => log.error({ err: err.message }, 'Registry failed to start'))
    },

    async stop() {
      wanted = false
      await terminate()
      if (state !== 'unavailable') state = 'stopped'
    },

    // Runs `fn` with the registry stopped: garbage collection must not race with pushes, and
    // a restart also drops any cached blob state. Pulls get 503 for the duration.
    async whileStopped(fn) {
      const wasWanted = wanted
      state = 'maintenance'
      await terminate()
      try {
        return await fn({ bin: config.registryBin, configFile, storageDir })
      } finally {
        if (wasWanted) {
          state = 'starting'
          await launch().catch((err) => log.error({ err: err.message }, 'Registry failed to restart after maintenance'))
        } else {
          state = 'stopped'
        }
      }
    },

    runCommand(args) {
      return new Promise((resolve) => {
        execFile(config.registryBin, args, { maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
          resolve({ ok: !err, output: `${stdout}${stderr}`.trim(), error: err?.message ?? null })
        })
      })
    },

    // For internal API calls (catalog, manifests, tag deletes) that bypass the auth proxy.
    url(pathname) {
      return `http://127.0.0.1:${port}${pathname}`
    },

    get upstream() {
      return state === 'running' ? { host: '127.0.0.1', port } : null
    },

    status() {
      return { state, error: lastError, storageDir, log: recentLog.slice(-50) }
    },
  }
}
