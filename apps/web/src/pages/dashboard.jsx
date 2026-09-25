import { FolderGit2, GitBranch } from 'lucide-react'
import { Link } from 'react-router'
import { EmptyState } from '@/components/empty-state'
import { NewProjectDialog } from '@/components/new-project-dialog'
import { PageHeader } from '@/components/page-header'
import { RunsTable } from '@/components/runs-table'
import { StatusIcon } from '@/components/status'
import { Skeleton } from '@/components/ui/skeleton'
import { usePageTitle } from '@/hooks/use-page-title'
import { useProjects, useRuns } from '@/lib/queries'

export function DashboardPage() {
  usePageTitle('Dashboard')
  const projects = useProjects()
  const runs = useRuns({ limit: 10 })

  return (
    <>
      <PageHeader title="Dashboard" description="Your projects and what ran recently." actions={<NewProjectDialog />} />

      <section className="mb-10">
        <h2 className="text-muted-foreground mb-3 text-sm font-medium">Projects</h2>
        {projects.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
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
            {projects.data?.map((project) => {
              const run = project.lastRun
              return (
                <Link
                  key={project.id}
                  to={`/projects/${project.id}`}
                  className="glass group hover:bg-accent/40 flex flex-col gap-3 rounded-xl p-5 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <FolderGit2 className="text-muted-foreground group-hover:text-foreground size-4 transition-colors" />
                    <span className="truncate font-medium">{project.name}</span>
                    {run ? (
                      <StatusIcon status={run.status} className="ml-auto" />
                    ) : (
                      <span className="text-muted-foreground ml-auto text-xs">never run</span>
                    )}
                  </div>
                  <p className="text-muted-foreground truncate font-mono text-xs">{project.repoUrl}</p>
                  <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                    <GitBranch className="size-3" /> {project.defaultBranch}
                  </p>
                </Link>
              )
            })}
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
        <RunsTable runs={runs.data} isPending={runs.isPending} />
      </section>
    </>
  )
}
