const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export function isValidEnvKey(key) {
  return KEY_PATTERN.test(key)
}

// Builds a step's environment from scratch. The server's own env (secret key, admin password)
// is never inherited; only PATH/HOME/LANG pass through. Built-ins are applied last so user vars
// can't spoof BSCRIPT_*.
export function buildStepEnv({ vars = [], builtins = {}, includeSecrets = true }) {
  const env = {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env.HOME || '/tmp',
    LANG: process.env.LANG || 'C.UTF-8',
    CI: 'true',
    BSCRIPT: 'true',
  }
  const secrets = []

  for (const { key, value, secret } of vars) {
    if (!isValidEnvKey(key)) throw new Error(`Invalid env var name "${key}"`)
    if (secret && !includeSecrets) continue
    env[key] = String(value)
    if (secret) secrets.push(String(value))
  }

  for (const [key, value] of Object.entries(builtins)) {
    if (value !== undefined && value !== null) env[key] = String(value)
  }

  return { env, secrets }
}
