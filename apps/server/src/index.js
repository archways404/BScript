import { ensureAdmin } from './auth/admin.js'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { createCipher, resolveKey } from './crypto.js'
import { openDatabase } from './db/index.js'
import { createRunQueue } from './runner/queue.js'
import { createScheduler } from './triggers/scheduler.js'

const config = loadConfig()
const secretKey = resolveKey(config)
const cipher = createCipher(secretKey)
const db = openDatabase(config.dbPath)
const queue = createRunQueue({ db, cipher, config })
// The scheduler only logs once jobs fire, after app exists; route its logs through Fastify.
const scheduler = createScheduler({ db, queue, log: { info: (...a) => app.log.info(...a), warn: (...a) => app.log.warn(...a) } })
const app = await buildApp({ config, db, cipher, secretKey, queue, scheduler })
queue.setLogger(app.log)

await ensureAdmin(db, config, app.log)
await queue.start()
scheduler.sync()

async function shutdown(signal) {
  app.log.info(`${signal} received, shutting down`)
  await app.close()
  scheduler.stop()
  await queue.stop()
  db.close()
  process.exit(0)
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)

await app.listen({ port: config.port, host: config.host })
