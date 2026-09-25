import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { resolveKey } from './crypto.js'
import { openDatabase } from './db/index.js'

const config = loadConfig()
resolveKey(config)
const db = openDatabase(config.dbPath)
const app = await buildApp({ config, db })

async function shutdown(signal) {
  app.log.info(`${signal} received, shutting down`)
  await app.close()
  db.close()
  process.exit(0)
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)

await app.listen({ port: config.port, host: config.host })
