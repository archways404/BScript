import { useSearchParams } from 'react-router'
import { PageHeader } from '@/components/page-header'
import { RunsTable } from '@/components/runs-table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useRuns } from '@/lib/queries'

const STATUSES = ['queued', 'running', 'success', 'failed', 'cancelled']

export function RunsPage() {
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? 'all'
  const runs = useRuns({ limit: 100, status: status === 'all' ? undefined : status })

  return (
    <>
      <PageHeader
        title="Runs"
        description="Every pipeline run, newest first."
        actions={
          <Select value={status} onValueChange={(v) => setParams(v === 'all' ? {} : { status: v })}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s} className="capitalize">
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <RunsTable runs={runs.data} isPending={runs.isPending} />
    </>
  )
}
