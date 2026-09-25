import { Loader2 } from 'lucide-react'
import { RunsTable } from '@/components/runs-table'
import { Button } from '@/components/ui/button'
import { useRunPages } from '@/lib/queries'

export function PagedRuns({ filters, showPipeline = true }) {
  const runs = useRunPages(filters)
  return (
    <div className="grid gap-4">
      <RunsTable runs={runs.data?.pages.flat()} isPending={runs.isPending} showPipeline={showPipeline} />
      {runs.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => runs.fetchNextPage()} disabled={runs.isFetchingNextPage}>
            {runs.isFetchingNextPage && <Loader2 className="animate-spin" />} Load older runs
          </Button>
        </div>
      )}
    </div>
  )
}
