import { CheckCircle2, Circle, FolderGit2, GitBranch, Play, Workflow, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { ActivityChart } from '@/components/activity-chart'
import { EmptyState } from '@/components/empty-state'
import { NewProjectDialog } from '@/components/new-project-dialog'
import { PageHeader } from '@/components/page-header'
import { RunsTable } from '@/components/runs-table'
import { StatTile } from '@/components/stat-tile'
import { StatusIcon } from '@/components/status'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { usePageTitle } from '@/hooks/use-page-title'
import { duration, plural, timeAgo } from '@/lib/format'
import { useProjects, useRuns, useStats } from '@/lib/queries'
import { cn } from '@/lib/utils'

const DISMISS_KEY = 'bscript-onboarding-dismissed'

function formatSeconds(seconds) {
  if (seconds == null) return '—'
  return duration(new Date(0).toISOString(), new Date(seconds * 1000).toISOString())
}

export function DashboardPage() {
  usePageTitle('Dashboard')
  const projects = useProjects()
  const stats = useStats()
  const recent = useRuns({ limit: 8 })
  const running = useRuns({ status: 'running', limit: 10 })
  const queued = useRuns({ status: 'queued', limit: 10 })
  const active = [...(running.data ?? []), ...(queued.data ?? [])]
  const s = stats.data

  return (
    <>
      <PageHeader title="Dashboard" description="Your projects and what ran recently." actions={<NewProjectDialog />} />

      <GettingStarted projects={projects.data} hasRuns={(recent.data?.length ?? 0) > 0} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Running now" value={s ? s.running : '—'} hint={s?.queued ? `${s.queued} queued` : 'Nothing waiting'} />
        <StatTile label="Runs, last 24 hours" value={s ? s.last24h.total : '—'} hint={s ? (s.last24h.failed ? `${s.last24h.failed} failed` : 'None failed') : null} />
        <StatTile
          label="Success rate, 7 days"
          value={s?.successRate7d == null ? '—' : `${Math.round(s.successRate7d * 100)}%`}
          hint="Of runs that succeeded or failed"
        />
        <StatTile label="Typical run, 7 days" value={formatSeconds(s?.medianDurationSec7d)} hint="Median of successful runs" />
      </div>

      <div className="mb-10 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">{s ? <ActivityChart daily={s.daily} /> : <Skeleton className="h-52 rounded-xl" />}</div>
        <div className="glass flex flex-col rounded-xl p-4">
          <h2 className="mb-3 text-sm font-medium">Running now</h2>
          {active.length === 0 ? (
            <p className="text-muted-foreground m-auto py-6 text-sm">Nothing running.</p>
          ) : (
            <ul className="divide-border -mx-2 divide-y">
              {active.map((run) => (
                <li key={run.id}>
                  <Link to={`/runs/${run.id}`} className="hover:bg-accent/60 flex items-center gap-3 rounded-md px-2 py-2 text-sm">
                    <StatusIcon status={run.status} />
                    <span className="min-w-0 flex-1 truncate">
                      {run.projectName} / {run.pipelineName}
                    </span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {run.status === 'queued' ? 'queued' : duration(run.startedAt, null)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <section className="mb-10">
        <h2 className="text-muted-foreground mb-3 text-sm font-medium">Projects</h2>
        {projects.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        ) : projects.data?.length === 0 ? (
          <EmptyState
            icon={FolderGit2}
            title="No projects yet"
            description="Connect a repository that has a .BScript/ folder, then build a pipeline from its scripts."
            action={<NewProjectDialog />}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.data?.map((project) => (
              <Link
                key={project.id}
                to={`/projects/${project.id}`}
                className="glass group hover:bg-accent/40 flex flex-col gap-3 rounded-xl p-5 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <FolderGit2 className="text-muted-foreground group-hover:text-foreground size-4 transition-colors" />
                  <span className="truncate font-medium">{project.name}</span>
                  {project.lastRun && <StatusIcon status={project.lastRun.status} className="ml-auto" />}
                </div>
                <p className="text-muted-foreground truncate font-mono text-xs">{project.repoUrl}</p>
                <div className="text-muted-foreground mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="flex items-center gap-1">
                    <GitBranch className="size-3" /> {project.defaultBranch}
                  </span>
                  <span className="flex items-center gap-1">
                    <Workflow className="size-3" /> {plural(project.pipelineCount, 'pipeline')}
                  </span>
                  <span className="ml-auto">{project.lastRun ? `ran ${timeAgo(project.lastRun.queuedAt)}` : 'never run'}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-muted-foreground text-sm font-medium">Recent runs</h2>
          <Link to="/runs" className="text-muted-foreground hover:text-foreground text-sm">
            View all
          </Link>
        </div>
        <RunsTable runs={recent.data} isPending={recent.isPending} />
      </section>
    </>
  )
}

// Shown until the first project, pipeline and run exist, or until dismissed.
function GettingStarted({ projects, hasRuns }) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })
  if (!projects || dismissed) return null
  const firstProject = projects[0]
  const steps = [
    { done: projects.length > 0, label: 'Connect a repository with a .BScript/ folder', action: <NewProjectDialog trigger={<Button size="sm">New project</Button>} /> },
    {
      done: projects.some((p) => p.pipelineCount > 0),
      label: 'Create a pipeline from its scripts',
      action: firstProject && (
        <Button asChild size="sm" variant="outline">
          <Link to={`/projects/${firstProject.id}`}>Open {firstProject.name}</Link>
        </Button>
      ),
    },
    { done: hasRuns, label: 'Run it, from the pipeline page or a GitHub push', action: null },
  ]
  if (steps.every((step) => step.done)) return null
  const next = steps.findIndex((step) => !step.done)

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // private mode: it just comes back next visit
    }
    setDismissed(true)
  }

  return (
    <div className="glass mb-6 rounded-xl p-5">
      <div className="mb-3 flex items-center gap-2">
        <Play className="size-4" />
        <h2 className="font-medium">Get started</h2>
        <Button variant="ghost" size="icon" className="ml-auto size-7" onClick={dismiss} aria-label="Hide getting started">
          <X />
        </Button>
      </div>
      <ol className="grid gap-2">
        {steps.map((step, i) => (
          <li key={step.label} className={cn('flex flex-wrap items-center gap-3 text-sm', step.done && 'text-muted-foreground')}>
            {step.done ? <CheckCircle2 className="text-success size-4" /> : <Circle className="text-muted-foreground size-4" />}
            <span className={cn(step.done && 'line-through')}>{step.label}</span>
            {i === next && step.action}
          </li>
        ))}
      </ol>
    </div>
  )
}
