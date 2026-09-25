import { useSearchParams } from 'react-router'
import { PageHeader } from '@/components/page-header'
import { PagedRuns } from '@/components/paged-runs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { usePageTitle } from '@/hooks/use-page-title'

const STATUSES = ['queued', 'running', 'success', 'failed', 'cancelled']

export function RunsPage() {
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? 'all'
  usePageTitle('Runs')

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
      <PagedRuns filters={{ status: status === 'all' ? undefined : status }} />
    </>
  )
}
