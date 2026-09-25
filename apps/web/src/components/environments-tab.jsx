import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Layers, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { EnvEditor } from '@/components/env-editor'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { api } from '@/lib/api'
import { keys, useEnvironments } from '@/lib/queries'

function BranchFilterHint() {
  return (
    <p className="text-muted-foreground text-xs">
      Only runs on matching branches may use this environment, e.g. <code className="font-mono">main</code> or{' '}
      <code className="font-mono">release/*</code>. Leave empty to allow any branch.
    </p>
  )
}

export function EnvironmentsTab({ projectId }) {
  const environments = useEnvironments(projectId)

  if (environments.isPending) return <Skeleton className="h-32 rounded-xl" />
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground max-w-2xl text-sm">
          Named targets like staging and production, each with its own variables. A run uses the pipeline's default
          environment or the one picked at Run. Environment variables override project and pipeline ones.
        </p>
        <NewEnvironmentDialog projectId={projectId} />
      </div>
      {environments.data.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No environments yet"
          description="Add staging and production to run the same pipeline against different hosts, keys and settings."
        />
      ) : (
        environments.data.map((environment) => <EnvironmentCard key={environment.id} projectId={projectId} environment={environment} />)
      )}
    </div>
  )
}

function EnvironmentCard({ projectId, environment }) {
  const queryClient = useQueryClient()
  const [branchFilter, setBranchFilter] = useState(environment.branchFilter)
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: keys.environments(projectId) })
    queryClient.invalidateQueries({ queryKey: ['requirements'] })
  }

  const save = useMutation({
    mutationFn: () => api.patch(`/environments/${environment.id}`, { branchFilter }),
    onSuccess: () => {
      invalidate()
      toast.success(`Saved ${environment.name}`)
    },
  })
  const remove = useMutation({ mutationFn: () => api.delete(`/environments/${environment.id}`), onSuccess: invalidate })

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3">
        <Layers className="text-muted-foreground size-4" />
        <CardTitle>{environment.name}</CardTitle>
        {environment.branchFilter && (
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            <ShieldCheck className="size-3.5" /> {environment.branchFilter}
          </span>
        )}
        <div className="ml-auto">
          <ConfirmDialog
            title={`Delete ${environment.name}?`}
            description="Its variables are deleted. Pipelines using it as their default fall back to no environment."
            onConfirm={() => remove.mutate()}
            trigger={
              <Button variant="ghost" size="icon" aria-label={`Delete ${environment.name}`}>
                <Trash2 />
              </Button>
            }
          />
        </div>
      </CardHeader>
      <CardContent className="grid gap-5">
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <Label htmlFor={`env-branches-${environment.id}`}>Allowed branches</Label>
          <div className="flex gap-2">
            <Input
              id={`env-branches-${environment.id}`}
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              placeholder="Any branch"
              className="font-mono"
            />
            <Button type="submit" variant="secondary" disabled={branchFilter === environment.branchFilter || save.isPending}>
              Save
            </Button>
          </div>
          <BranchFilterHint />
        </form>
        <EnvEditor scope="environment" id={environment.id} />
      </CardContent>
    </Card>
  )
}

function NewEnvironmentDialog({ projectId }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', branchFilter: '' })
  const create = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/environments`, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.environments(projectId) })
      setOpen(false)
      setForm({ name: '', branchFilter: '' })
    },
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New environment
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
            <DialogTitle>New environment</DialogTitle>
            <DialogDescription>You'll add its variables next.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="new-env-name">Name</Label>
            <Input
              id="new-env-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="production"
              required
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-env-branches">Allowed branches</Label>
            <Input
              id="new-env-branches"
              value={form.branchFilter}
              onChange={(e) => setForm({ ...form, branchFilter: e.target.value })}
              placeholder="Any branch"
              className="font-mono"
            />
            <BranchFilterHint />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!form.name || create.isPending}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
