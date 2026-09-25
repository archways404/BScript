// Fixed-window counter of failed logins per IP, in memory. Enough for a single-node server.
export function createLoginLimiter({ max = 10, windowMs = 15 * 60 * 1000 } = {}) {
  const attempts = new Map()

  function entry(ip) {
    const current = attempts.get(ip)
    if (current && current.resetAt > Date.now()) return current
    const fresh = { count: 0, resetAt: Date.now() + windowMs }
    attempts.set(ip, fresh)
    return fresh
  }

  return {
    blocked: (ip) => entry(ip).count >= max,
    fail: (ip) => void entry(ip).count++,
    reset: (ip) => void attempts.delete(ip),
  }
}
