const MAX_TRACKED = 10_000

/**
 * Fixed-window attempt counter per client IP, in memory (enough for one node). Callers count
 * an attempt *before* doing the expensive check, so parallel guesses can't all slip in before
 * the first failure is recorded, and reset() after a success. Expired windows are pruned and
 * the map is capped, so random client addresses can't grow it forever.
 */
export function createLoginLimiter({ max = 10, windowMs = 15 * 60 * 1000 } = {}) {
  const attempts = new Map()

  function prune(now) {
    for (const [ip, entry] of attempts) if (entry.resetAt <= now) attempts.delete(ip)
    while (attempts.size >= MAX_TRACKED) attempts.delete(attempts.keys().next().value)
  }

  return {
    // Records an attempt; false when this IP is over the limit for the current window.
    hit(ip) {
      const now = Date.now()
      let entry = attempts.get(ip)
      if (!entry || entry.resetAt <= now) {
        if (attempts.size >= MAX_TRACKED / 2) prune(now)
        entry = { count: 0, resetAt: now + windowMs }
        attempts.set(ip, entry)
      }
      entry.count++
      return entry.count <= max
    },
    reset: (ip) => void attempts.delete(ip),
  }
}
