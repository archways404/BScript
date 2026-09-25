import { ensureAdmin } from './auth/admin.js'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { createCipher, resolveKey } from './crypto.js'
import { openDatabase } from './db/index.js'
import { createRegistryService } from './registry/service.js'
import { createRunQueue } from './runner/queue.js'
import { createScheduler } from './triggers/scheduler.js'

const config = loadConfig()
const secretKey = resolveKey(config)
const cipher = createCipher(secretKey)
const db = openDatabase(config.dbPath)
// Loggers route through Fastify's once `app` exists; nothing logs before that.
const log = { info: (...a) => app.log.info(...a), warn: (...a) => app.log.warn(...a), error: (...a) => app.log.error(...a) }
const registry = createRegistryService({ db, cipher, config, log })
const queue = createRunQueue({ db, cipher, config, registry })
const scheduler = createScheduler({ db, queue, log })
const app = await buildApp({ config, db, cipher, secretKey, queue, scheduler, registry })
queue.setLogger(app.log)

await ensureAdmin(db, config, app.log)
await queue.start()
scheduler.sync()

// Runs and the registry stop first (cancelled runs are recorded as such), then the HTTP
// server. A second signal, or 30 seconds, forces the exit.
const SHUTDOWN_TIMEOUT_MS = 30_000
let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) {
    app.log.warn(`${signal} again, exiting now`)
    process.exit(1)
  }
  shuttingDown = true
  app.log.info(`${signal} received, shutting down`)
  setTimeout(() => {
    app.log.error('Shutdown took too long, exiting')
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS).unref()
  scheduler.stop()
  await queue.stop()
  await registry.stop()
  await app.close()
  db.close()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

await app.listen({ port: config.port, host: config.host })
// After listen: the registry sends its notifications to this server.
await registry.start()
