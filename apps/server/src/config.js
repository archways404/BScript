import path from 'node:path'

// false (default): use the connection's address. Behind a reverse proxy set true, a hop
// count, or the proxy's addresses/CIDRs, so X-Forwarded-For is only trusted from it.
function trustProxy(raw) {
  if (!raw || raw === 'false') return false
  if (raw === 'true') return true
  return /^\d+$/.test(raw) ? Number(raw) : raw
}

function int(env, name, fallback) {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number.parseInt(raw, 10)
  if (Number.isNaN(value)) throw new Error(`${name} must be an integer, got "${raw}"`)
  return value
}

// Fixed default so the server (run from apps/server) and the CLI (run from the repo root)
// always share one database. Docker sets BSCRIPT_DATA_DIR=/data explicitly.
const DEFAULT_DATA_DIR = path.resolve(import.meta.dirname, '../.data')

export function loadConfig(env = process.env) {
  const dataDir = env.BSCRIPT_DATA_DIR ? path.resolve(env.BSCRIPT_DATA_DIR) : DEFAULT_DATA_DIR
  return {
    production: env.NODE_ENV === 'production',
    port: int(env, 'PORT', 3000),
    host: env.HOST || '0.0.0.0',
    trustProxy: trustProxy(env.BSCRIPT_TRUST_PROXY),
    publicUrl: env.BSCRIPT_PUBLIC_URL || `http://localhost:${int(env, 'PORT', 3000)}`,
    secretKey: env.BSCRIPT_SECRET_KEY || '',
    adminUser: env.BSCRIPT_ADMIN_USER || 'admin',
    adminPassword: env.BSCRIPT_ADMIN_PASSWORD || '',
    maxConcurrentRuns: int(env, 'MAX_CONCURRENT_RUNS', 2),
    runRetention: int(env, 'RUN_RETENTION', 50),
    // Fork PRs run untrusted code inside this container; opt in only if you accept that.
    allowForkPrs: env.BSCRIPT_ALLOW_FORK_PRS === 'true',
    // The bundled registry (CNCF Distribution). The Docker image ships it at /usr/local/bin.
    registryBin: env.BSCRIPT_REGISTRY_BIN || 'registry',
    // host[:port] clients use for `docker login` / image names; defaults to the public URL's host.
    registryAddress: env.BSCRIPT_REGISTRY_ADDRESS || new URL(env.BSCRIPT_PUBLIC_URL || `http://localhost:${int(env, 'PORT', 3000)}`).host,
    dataDir,
    dbPath: path.join(dataDir, 'bscript.db'),
    reposDir: path.join(dataDir, 'repos'),
    workDir: path.join(dataDir, 'work'),
    logsDir: path.join(dataDir, 'logs'),
  }
}
