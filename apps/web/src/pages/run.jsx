import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, ChevronRight, ExternalLink, GitBranch, GitCommitHorizontal, Loader2, RotateCcw, Square, User } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { LogView } from '@/components/log-view'
import { PageHeader } from '@/components/page-header'
import { StatusBadge, StatusIcon } from '@/components/status'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useNow } from '@/hooks/use-now'
import { useRunStream } from '@/hooks/use-run-stream'
import { api } from '@/lib/api'
import { duration, FINISHED, shortSha, timeAgo } from '@/lib/format'
import { keys, useRun } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { NotFoundPage } from '@/pages/not-found'

const REPLAY_CAP = 5000 // matches the server's per-step replay buffer

export function RunPage() {
  const runId = Number(useParams().runId)
  const query = useRun(runId)
  const stream = useRunStream(runId, query.data?.status)

  if (query.error?.status === 404) return <NotFoundPage what="Run" />
  if (query.isPending) return <Skeleton className="h-10 w-64" />

  // The stream drives the page while the run is active; once the saved run is finished it
  // is authoritative (it has the final step states, including skipped ones).
  const run = FINISHED.has(query.data.status) || !stream.run ? query.data : stream.run
  return <RunView run={run} lines={stream.live ? stream.lines : null} />
}

function RunView({ run, lines }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const active = !FINISHED.has(run.status)
  const now = useNow(active)

  const cancel = useMutation({
    mutationFn: () => api.post(`/runs/${run.id}/cancel`),
    onSuccess: () => toast('Cancelling run…'),
  })
  const rerun = useMutation({
    mutationFn: () => api.post(`/runs/${run.id}/rerun`),
    onSuccess: (next) => {
      queryClient.invalidateQueries({ queryKey: ['runs'] })
      navigate(`/runs/${next.id}`)
    },
  })

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Dashboard', to: '/' },
          { label: run.projectName, to: `/projects/${run.projectId}` },
          { label: run.pipelineName, to: `/pipelines/${run.pipelineId}` },
        ]}
        title={
          <span className="flex items-center gap-3">
            Run #{run.id} <StatusBadge status={run.status} />
          </span>
        }
        description={
          <span className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="flex items-center gap-1.5 font-mono">
              <GitBranch className="size-3.5" />
              {run.ref.length === 40 ? shortSha(run.ref) : run.ref}
            </span>
            {run.commitSha && (
              <span className="flex items-center gap-1.5 font-mono">
                <GitCommitHorizontal className="size-3.5" />
                {shortSha(run.commitSha)}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <User className="size-3.5" />
              {run.triggeredBy ?? run.trigger}
            </span>
            <span title={run.queuedAt}>queued {timeAgo(run.queuedAt, now)}</span>
            {run.startedAt && <span className="tabular-nums">took {duration(run.startedAt, run.finishedAt, now)}</span>}
            {run.fromFork && <span className="text-warning">fork: secrets withheld</span>}
          </span>
        }
        actions={
          active ? (
            <Button variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              <Square /> Cancel
            </Button>
          ) : (
            <Button variant="outline" onClick={() => rerun.mutate()} disabled={rerun.isPending}>
              <RotateCcw /> Re-run
            </Button>
          )
        }
      />

      {run.error && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive mb-6 flex items-start gap-3 rounded-xl border p-4 text-sm">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span className="break-words">{run.error}</span>
        </div>
      )}

      {run.status === 'queued' && (
        <div className="glass text-muted-foreground mb-6 flex items-center gap-3 rounded-xl p-4 text-sm">
          <Loader2 className="size-4 animate-spin" /> Waiting for a free runner slot…
        </div>
      )}

      <div className="grid gap-2">
        {run.steps?.map((step) => (
          <StepSection key={step.position} runId={run.id} step={step} lines={lines?.[step.position]} live={lines !== null} now={now} />
        ))}
      </div>
    </>
  )
}

function StepSection({ runId, step, lines, live, now }) {
  // Running and failed steps open by themselves and stay open once finished, so the log you
  // were watching doesn't collapse under you. A click always wins.
  const autoOpen = step.status === 'running' || step.status === 'failed'
  const [override, setOverride] = useState(null)
  useEffect(() => {
    if (autoOpen) setOverride((current) => current ?? true)
  }, [autoOpen])
  const open = override ?? autoOpen
  const hasLog = step.status !== 'pending' && step.status !== 'skipped'

  return (
    <section className="glass overflow-hidden rounded-xl">
      <button
        type="button"
        onClick={() => setOverride(!open)}
        disabled={!hasLog}
        className="hover:bg-accent/50 flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors disabled:cursor-default disabled:hover:bg-transparent"
        aria-expanded={open}
      >
        <ChevronRight className={cn('text-muted-foreground size-4 transition-transform', open && 'rotate-90', !hasLog && 'opacity-0')} />
        <StatusIcon status={step.status} />
        <span className="font-medium">{step.name}</span>
        <span className="text-muted-foreground hidden font-mono text-xs sm:inline">.BScript/{step.scriptPath}</span>
        <span className="text-muted-foreground ml-auto flex items-center gap-3 text-xs tabular-nums">
          {step.exitCode !== null && step.exitCode !== 0 && <span className="text-destructive">exit {step.exitCode}</span>}
          {step.startedAt && duration(step.startedAt, step.finishedAt, now)}
        </span>
      </button>
      {open && hasLog && (
        <div className="px-3 pb-3">
          {live ? <LiveLog runId={runId} step={step} lines={lines ?? []} /> : <SavedLog runId={runId} step={step} />}
        </div>
      )}
    </section>
  )
}

function RawLogLink({ runId, position }) {
  return (
    <a
      href={`/api/runs/${runId}/steps/${position}/log`}
      target="_blank"
      rel="noreferrer"
      className="text-muted-foreground hover:text-foreground mt-2 inline-flex items-center gap-1 text-xs"
    >
      Raw log <ExternalLink className="size-3" />
    </a>
  )
}

function LiveLog({ runId, step, lines }) {
  return (
    <>
      {lines.length >= REPLAY_CAP && (
        <p className="text-muted-foreground mb-2 text-xs">Showing the most recent lines. The raw log has everything.</p>
      )}
      <LogView lines={lines} empty={step.status === 'running' ? 'Waiting for output…' : 'No output.'} />
      {step.status !== 'running' && <RawLogLink runId={runId} position={step.position} />}
    </>
  )
}

function parseLog(text) {
  const body = String(text).replace(/\n$/, '')
  return body === '' ? [] : body.split('\n').map((line) => ({ stream: 'stdout', line }))
}

function SavedLog({ runId, step }) {
  const log = useQuery({
    queryKey: [...keys.run(runId), 'log', step.position],
    queryFn: () => api.get(`/runs/${runId}/steps/${step.position}/log`),
    select: parseLog,
    staleTime: Infinity,
  })

  if (log.isPending) return <Skeleton className="h-24 rounded-lg" />
  if (log.error) return <p className="text-muted-foreground p-2 text-sm">{log.error.status === 404 ? 'No log was recorded.' : log.error.message}</p>
  return (
    <>
      <LogView lines={log.data} />
      <RawLogLink runId={runId} position={step.position} />
    </>
  )
}
