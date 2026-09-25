import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, GitBranch, Plus, RefreshCw, Trash2, Workflow } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/components/copy-button'
import { EmptyState } from '@/components/empty-state'
import { EnvEditor } from '@/components/env-editor'
import { PageHeader } from '@/components/page-header'
import { ProjectFields } from '@/components/project-form'
import { RunsTable } from '@/components/runs-table'
import { StatusIcon } from '@/components/status'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { keys, usePipelines, useProject, useRuns, useWebhook } from '@/lib/queries'
import { NotFoundPage } from '@/pages/not-found'

const TABS = ['pipelines', 'runs', 'environment', 'settings']

export function ProjectPage() {
  const { projectId, tab = 'pipelines' } = useParams()
  const navigate = useNavigate()
  const id = Number(projectId)
  const project = useProject(id)

  if (project.error?.status === 404) return <NotFoundPage what="Project" />
  if (project.isPending) return <Skeleton className="h-10 w-64" />

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Dashboard', to: '/' }]}
        title={project.data.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono">{project.data.repoUrl}</span>
            <span className="flex items-center gap-1">
              <GitBranch className="size-3.5" /> {project.data.defaultBranch}
            </span>
          </span>
        }
      />
      <Tabs value={TABS.includes(tab) ? tab : 'pipelines'} onValueChange={(t) => navigate(`/projects/${id}/${t}`)}>
        <TabsList className="glass mb-6">
          <TabsTrigger value="pipelines">Pipelines</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="environment">Environment</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="pipelines">
          <PipelinesTab projectId={id} />
        </TabsContent>
        <TabsContent value="runs">
          <ProjectRuns projectId={id} />
        </TabsContent>
        <TabsContent value="environment">
          <p className="text-muted-foreground mb-4 text-sm">
            Available to every pipeline in this project. Pipeline variables with the same name take precedence.
          </p>
          <EnvEditor scope="project" id={id} />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab project={project.data} />
        </TabsContent>
      </Tabs>
    </>
  )
}

function PipelinesTab({ projectId }) {
  const pipelines = usePipelines(projectId)
  const runs = useRuns({ projectId, limit: 50 })
  const lastRun = new Map()
  for (const run of runs.data ?? []) if (!lastRun.has(run.pipelineId)) lastRun.set(run.pipelineId, run)

  if (pipelines.isPending) return <Skeleton className="h-24 rounded-xl" />
  if (!pipelines.data.length) {
    return (
      <EmptyState
        icon={Workflow}
        title="No pipelines yet"
        description="A pipeline is an ordered list of scripts from .BScript/ plus the env vars they need."
        action={<NewPipelineDialog projectId={projectId} />}
      />
    )
  }

  return (
    <div className="grid gap-4">
      <div className="flex justify-end">
        <NewPipelineDialog projectId={projectId} />
      </div>
      <div className="glass divide-border divide-y overflow-hidden rounded-xl">
        {pipelines.data.map((pipeline) => {
          const run = lastRun.get(pipeline.id)
          const triggers = Object.entries(pipeline.triggers).filter(([, on]) => on).map(([name]) => name.replace('_', ' '))
          return (
            <Link
              key={pipeline.id}
              to={`/pipelines/${pipeline.id}`}
              className="hover:bg-accent/60 flex items-center gap-4 px-4 py-3.5 transition-colors"
            >
              {run ? <StatusIcon status={run.status} /> : <Workflow className="text-muted-foreground size-4" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-medium">
                  {pipeline.name}
                  {!pipeline.enabled && <span className="text-muted-foreground text-xs font-normal">disabled</span>}
                </div>
                <div className="text-muted-foreground text-xs capitalize">{triggers.join(' · ') || 'no triggers'}</div>
              </div>
              <span className="text-muted-foreground text-xs">{run ? timeAgo(run.queuedAt) : 'never run'}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function NewPipelineDialog({ projectId }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const create = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/pipelines`, { name }),
    onSuccess: (pipeline) => {
      queryClient.invalidateQueries({ queryKey: keys.pipelines(projectId) })
      navigate(`/pipelines/${pipeline.id}`)
    },
  })

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New pipeline
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-6"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>New pipeline</DialogTitle>
            <DialogDescription>You'll pick its scripts and their order next.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="pipeline-name">Name</Label>
            <Input id="pipeline-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="ci" required autoFocus />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!name || create.isPending}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ProjectRuns({ projectId }) {
  const runs = useRuns({ projectId, limit: 100 })
  return <RunsTable runs={runs.data} isPending={runs.isPending} />
}

function SettingsTab({ project }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [form, setForm] = useState({ ...project, credential: '' })

  const save = useMutation({
    mutationFn: ({ name, repoUrl, defaultBranch, authType, credential }) =>
      api.patch(`/projects/${project.id}`, {
        name,
        repoUrl,
        defaultBranch,
        authType,
        ...(credential && { credential }),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(keys.project(project.id), updated)
      queryClient.invalidateQueries({ queryKey: keys.projects })
      setForm({ ...updated, credential: '' })
      toast.success('Project saved')
    },
  })

  const remove = useMutation({
    mutationFn: () => api.delete(`/projects/${project.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.projects })
      navigate('/')
      toast.success(`Deleted ${project.name}`)
    },
  })

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Repository</CardTitle>
          <CardDescription>Where BScript clones from, and how it authenticates.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-6"
            onSubmit={(e) => {
              e.preventDefault()
              save.mutate(form)
            }}
          >
            <ProjectFields value={form} onChange={setForm} hasCredential={project.hasCredential} />
            <div>
              <Button type="submit" disabled={save.isPending}>
                Save changes
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <WebhookCard projectId={project.id} />

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle>Delete project</CardTitle>
          <CardDescription>Removes its pipelines, env vars, run history and logs. This cannot be undone.</CardDescription>
        </CardHeader>
        <CardContent>
          <ConfirmDialog
            title={`Delete ${project.name}?`}
            description="All pipelines, variables, runs and logs for this project will be permanently deleted."
            onConfirm={() => remove.mutate()}
            trigger={
              <Button variant="destructive">
                <Trash2 /> Delete project
              </Button>
            }
          />
        </CardContent>
      </Card>
    </div>
  )
}

function WebhookCard({ projectId }) {
  const queryClient = useQueryClient()
  const [reveal, setReveal] = useState(false)
  const webhook = useWebhook(projectId, true)
  const rotate = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/webhook/rotate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.webhook(projectId) })
      toast.success('Webhook secret rotated. Update it in GitHub.')
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>GitHub webhook</CardTitle>
        <CardDescription>
          Add this in the repository's Settings → Webhooks, content type <code className="font-mono">application/json</code>,
          for push and pull request events.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label>Payload URL</Label>
          <div className="flex gap-2">
            <Input readOnly value={webhook.data?.url ?? ''} className="font-mono text-xs" />
            <CopyButton value={webhook.data?.url ?? ''} />
          </div>
        </div>
        <div className="grid gap-2">
          <Label>Secret</Label>
          <div className="flex gap-2">
            <Input readOnly type={reveal ? 'text' : 'password'} value={webhook.data?.secret ?? ''} className="font-mono text-xs" />
            <Button variant="ghost" size="icon" onClick={() => setReveal(!reveal)} aria-label={reveal ? 'Hide' : 'Reveal'}>
              {reveal ? <EyeOff /> : <Eye />}
            </Button>
            <CopyButton value={webhook.data?.secret ?? ''} />
          </div>
        </div>
        <div>
          <Button variant="outline" onClick={() => rotate.mutate()} disabled={rotate.isPending}>
            <RefreshCw /> Rotate secret
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
