import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

// Project and pipeline lists show each one's latest run; nothing else under 'projects'.
const isRunList = (query) => {
  const [root, , kind] = query.queryKey
  return root === 'projects' && (query.queryKey.length === 1 || kind === 'pipelines')
}

/**
 * Keeps run lists fresh: the server pushes every run status change on /api/events and we
 * refetch the run queries on screen. Hidden tabs let go of the connection (browsers allow
 * only ~6 per server over HTTP/1.1) and catch up when shown again.
 */
export function useRunEvents() {
  const queryClient = useQueryClient()
  useEffect(() => {
    let source = null
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ['runs'] })
      queryClient.invalidateQueries({ predicate: isRunList })
    }
    const connect = () => {
      source = new EventSource('/api/events')
      source.addEventListener('run', refresh)
    }
    const onVisibility = () => {
      if (document.hidden) {
        source?.close()
        source = null
      } else if (!source) {
        connect()
        refresh()
      }
    }
    if (!document.hidden) connect()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      source?.close()
    }
  }, [queryClient])
}
