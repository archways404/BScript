import { GitCommitHorizontal, Play } from 'lucide-react'
import { useNavigate } from 'react-router'
import { EmptyState } from '@/components/empty-state'
import { StatusIcon } from '@/components/status'
import { Skeleton } from '@/components/ui/skeleton'
import { useNow } from '@/hooks/use-now'
import { duration, runRefLabel, shortSha, timeAgo } from '@/lib/format'

const TRIGGER_LABEL = { manual: 'Manual', push: 'Push', pull_request: 'Pull request', cron: 'Schedule', api: 'API' }

export function RunsTable({ runs, isPending, showPipeline = true, emptyAction }) {
  const navigate = useNavigate()
  const now = useNow(runs?.some((r) => r.status === 'running'))

  if (isPending) {
    return (
      <div className="glass divide-border divide-y rounded-xl">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3.5">
            <Skeleton className="size-4 rounded-full" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="ml-auto h-4 w-20" />
          </div>
        ))}
      </div>
    )
  }

  if (!runs?.length) {
    return <EmptyState icon={Play} title="No runs yet" description="Runs show up here once a pipeline is triggered." action={emptyAction} />
  }

  return (
    <div className="glass divide-border divide-y overflow-hidden rounded-xl">
      {runs.map((run) => (
        <button
          key={run.id}
          type="button"
          onClick={() => navigate(`/runs/${run.id}`)}
          className="hover:bg-accent/60 flex w-full items-center gap-4 px-4 py-3 text-left text-sm transition-colors"
        >
          <StatusIcon status={run.status} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="truncate font-medium">
                {showPipeline ? `${run.projectName} / ${run.pipelineName}` : `Run #${run.id}`}
              </span>
              {showPipeline && <span className="text-muted-foreground text-xs">#{run.id}</span>}
            </div>
            <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 text-xs">
              <span className="font-mono">{runRefLabel(run)}</span>
              {run.prNumber && <span>PR #{run.prNumber}</span>}
              {run.environmentName && <span className="text-foreground/80">{run.environmentName}</span>}
              {run.commitSha && (
                <span className="flex items-center gap-1 font-mono">
                  <GitCommitHorizontal className="size-3" />
                  {shortSha(run.commitSha)}
                </span>
              )}
              <span>{TRIGGER_LABEL[run.trigger] ?? run.trigger}</span>
            </div>
          </div>
          <div className="text-muted-foreground hidden text-right text-xs sm:block">
            <div>{timeAgo(run.queuedAt, now)}</div>
            <div className="tabular-nums">{duration(run.startedAt, run.finishedAt, now)}</div>
          </div>
        </button>
      ))}
    </div>
  )
}
