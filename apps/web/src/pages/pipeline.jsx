import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ListOrdered, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { AddStep } from '@/components/add-step'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EnvEditor } from '@/components/env-editor'
import { PageHeader } from '@/components/page-header'
import { RunButton } from '@/components/run-button'
import { RunsTable } from '@/components/runs-table'
import { StepList } from '@/components/step-list'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'
import { keys, usePipeline, useProject, useRuns, useScripts } from '@/lib/queries'
import { NotFoundPage } from '@/pages/not-found'

let nextUid = 0
const withUid = (step) => ({ ...step, uid: ++nextUid })
const stepPayload = (steps) =>
  steps.map(({ name, scriptPath, continueOnError, timeoutSec }) => ({
    name: name || scriptPath,
    scriptPath,
    continueOnError,
    timeoutSec,
  }))

export function PipelinePage() {
  const id = Number(useParams().pipelineId)
  const pipeline = usePipeline(id)

  if (pipeline.error?.status === 404) return <NotFoundPage what="Pipeline" />
  if (pipeline.isPending) return <Skeleton className="h-10 w-64" />
  return <PipelineEditor key={pipeline.data.id} pipeline={pipeline.data} />
}

function PipelineEditor({ pipeline }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const project = useProject(pipeline.projectId)
  const scripts = useScripts(pipeline.projectId)
  const runs = useRuns({ pipelineId: pipeline.id, limit: 8 })

  const [steps, setSteps] = useState(() => pipeline.steps.map(withUid))
  const dirty = JSON.stringify(stepPayload(steps)) !== JSON.stringify(stepPayload(pipeline.steps))

  // Warn before leaving the page with unsaved step changes.
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e) => e.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const refresh = (updated) => {
    queryClient.invalidateQueries({ queryKey: keys.pipeline(pipeline.id) })
    queryClient.invalidateQueries({ queryKey: keys.pipelines(pipeline.projectId) })
    return updated
  }

  const saveSteps = useMutation({
    mutationFn: () => api.put(`/pipelines/${pipeline.id}/steps`, stepPayload(steps)),
    onSuccess: () => {
      refresh()
      toast.success('Steps saved')
    },
  })

  const remove = useMutation({
    mutationFn: () => api.delete(`/pipelines/${pipeline.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.pipelines(pipeline.projectId) })
      navigate(`/projects/${pipeline.projectId}`)
    },
  })

  const addStep = (scriptPath) =>
    setSteps([...steps, withUid({ name: scriptPath, scriptPath, continueOnError: false, timeoutSec: 3600 })])

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Dashboard', to: '/' },
          { label: project.data?.name ?? 'Project', to: `/projects/${pipeline.projectId}` },
        ]}
        title={pipeline.name}
        actions={
          <>
            <ConfirmDialog
              title={`Delete ${pipeline.name}?`}
              description="Its steps, variables, runs and logs will be permanently deleted."
              onConfirm={() => remove.mutate()}
              trigger={
                <Button variant="ghost" size="icon" aria-label="Delete pipeline">
                  <Trash2 />
                </Button>
              }
            />
            {project.data && (
              <RunButton
                pipelineId={pipeline.id}
                defaultRef={project.data.defaultBranch}
                disabled={dirty || steps.length === 0}
                disabledReason={dirty ? 'Save your step changes first' : 'Add a step first'}
              />
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid content-start gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Steps</CardTitle>
              <CardDescription>Run top to bottom in the repo root. Drag to reorder.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {steps.length === 0 ? (
                <div className="text-muted-foreground flex items-center gap-2 rounded-lg border border-dashed p-6 text-sm">
                  <ListOrdered className="size-4" /> No steps yet. Add scripts from .BScript/.
                </div>
              ) : (
                <StepList steps={steps} onChange={setSteps} knownScripts={scripts.data?.scripts} />
              )}
              <div className="flex flex-wrap items-center gap-2">
                <AddStep scripts={scripts} onAdd={addStep} />
                {dirty && (
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-muted-foreground text-sm">Unsaved changes</span>
                    <Button variant="ghost" onClick={() => setSteps(pipeline.steps.map(withUid))}>
                      Discard
                    </Button>
                    <Button onClick={() => saveSteps.mutate()} disabled={saveSteps.isPending}>
                      Save steps
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Environment</CardTitle>
              <CardDescription>Override or add to the project's variables for this pipeline only.</CardDescription>
            </CardHeader>
            <CardContent>
              <EnvEditor scope="pipeline" id={pipeline.id} />
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-6">
          <PipelineSettings pipeline={pipeline} onSaved={refresh} />
          <div>
            <h2 className="text-muted-foreground mb-3 text-sm font-medium">Recent runs</h2>
            <RunsTable runs={runs.data} isPending={runs.isPending} showPipeline={false} />
          </div>
        </div>
      </div>
    </>
  )
}

const TRIGGERS = [
  { key: 'manual', label: 'Manual & API', hint: 'Run button and API tokens' },
  { key: 'push', label: 'Push', hint: 'GitHub push webhook' },
  { key: 'pull_request', label: 'Pull request', hint: 'GitHub PR webhook; forks get no secrets' },
  { key: 'cron', label: 'Schedule', hint: 'Cron expression below' },
]

function PipelineSettings({ pipeline, onSaved }) {
  const [form, setForm] = useState({
    name: pipeline.name,
    branchFilter: pipeline.branchFilter,
    cronExpr: pipeline.cronExpr ?? '',
    enabled: pipeline.enabled,
    triggers: pipeline.triggers,
  })
  const set = (patch) => setForm({ ...form, ...patch })

  const save = useMutation({
    mutationFn: () => api.patch(`/pipelines/${pipeline.id}`, { ...form, cronExpr: form.cronExpr || null }),
    onSuccess: (updated) => {
      onSaved(updated)
      toast.success('Settings saved')
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="pl-name">Name</Label>
            <Input id="pl-name" value={form.name} onChange={(e) => set({ name: e.target.value })} required />
          </div>
          <label className="flex items-center justify-between gap-2 text-sm">
            Enabled
            <Switch checked={form.enabled} onCheckedChange={(enabled) => set({ enabled })} />
          </label>
          <fieldset className="grid gap-3">
            <legend className="mb-2 text-sm font-medium">Triggers</legend>
            {TRIGGERS.map(({ key, label, hint }) => (
              <label key={key} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {label}
                  <span className="text-muted-foreground block text-xs">{hint}</span>
                </span>
                <Switch
                  checked={form.triggers[key]}
                  onCheckedChange={(on) => set({ triggers: { ...form.triggers, [key]: on } })}
                />
              </label>
            ))}
          </fieldset>
          <div className="grid gap-2">
            <Label htmlFor="pl-branch">Branch filter</Label>
            <Input
              id="pl-branch"
              value={form.branchFilter}
              onChange={(e) => set({ branchFilter: e.target.value })}
              className="font-mono"
              placeholder="*"
            />
            <p className="text-muted-foreground text-xs">
              Glob for webhook triggers, e.g. <code className="font-mono">main</code> or{' '}
              <code className="font-mono">release/*</code>.
            </p>
          </div>
          {form.triggers.cron && (
            <div className="grid gap-2">
              <Label htmlFor="pl-cron">Cron expression</Label>
              <Input
                id="pl-cron"
                value={form.cronExpr}
                onChange={(e) => set({ cronExpr: e.target.value })}
                className="font-mono"
                placeholder="0 3 * * *"
              />
            </div>
          )}
          <Button type="submit" variant="secondary" disabled={save.isPending}>
            Save settings
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
