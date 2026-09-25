import { useEffect, useState } from 'react'

// Re-renders every `intervalMs` while `active`, for live durations and "x ago" labels.
export function useNow(active = true, intervalMs = 1000) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [active, intervalMs])
  return now
}
