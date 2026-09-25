import path from 'node:path'

function int(env, name, fallback) {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number.parseInt(raw, 10)
  if (Number.isNaN(value)) throw new Error(`${name} must be an integer, got "${raw}"`)
  return value
}

export function loadConfig(env = process.env) {
  const dataDir = path.resolve(env.BSCRIPT_DATA_DIR || './.data')
  return {
    production: env.NODE_ENV === 'production',
    port: int(env, 'PORT', 3000),
    host: env.HOST || '0.0.0.0',
    publicUrl: env.BSCRIPT_PUBLIC_URL || `http://localhost:${int(env, 'PORT', 3000)}`,
    secretKey: env.BSCRIPT_SECRET_KEY || '',
    adminUser: env.BSCRIPT_ADMIN_USER || 'admin',
    adminPassword: env.BSCRIPT_ADMIN_PASSWORD || '',
    maxConcurrentRuns: int(env, 'MAX_CONCURRENT_RUNS', 2),
    runRetention: int(env, 'RUN_RETENTION', 50),
    dataDir,
    dbPath: path.join(dataDir, 'bscript.db'),
    reposDir: path.join(dataDir, 'repos'),
    workDir: path.join(dataDir, 'work'),
    logsDir: path.join(dataDir, 'logs'),
  }
}
