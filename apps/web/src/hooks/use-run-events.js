import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

// Keeps run lists fresh: the server pushes every run status change on /api/events and we
// refetch the run queries that are on screen.
export function useRunEvents() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const source = new EventSource('/api/events')
    source.addEventListener('run', () => queryClient.invalidateQueries({ queryKey: ['runs'] }))
    return () => source.close()
  }, [queryClient])
}
