import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Container, Loader2, Pencil, Plus, Trash2, XCircle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
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
import { api } from '@/lib/api'
import { keys, useExternalRegistries } from '@/lib/queries'

export function ExternalRegistriesCard() {
  const registries = useExternalRegistries()
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1.5">
          <CardTitle>External registries</CardTitle>
          <CardDescription className="max-w-xl">
            Docker Hub, GHCR, GitLab, ECR or any other registry. Every run gets these credentials through{' '}
            <code className="font-mono">DOCKER_CONFIG</code>, so scripts can push and pull without{' '}
            <code className="font-mono">docker login</code>. Runs from fork pull requests don't.
          </CardDescription>
        </div>
        <RegistryDialog />
      </CardHeader>
      <CardContent>
        <div className="divide-border divide-y rounded-lg border">
          {registries.data?.length === 0 && (
            <p className="text-muted-foreground flex items-center gap-2 p-3 text-sm">
              <Container className="size-4" /> None yet.
            </p>
          )}
          {registries.data?.map((registry) => (
            <RegistryRow key={registry.id} registry={registry} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function TestResult({ result }) {
  if (!result) return null
  return (
    <p className={`flex items-start gap-1.5 text-xs ${result.ok ? 'text-success' : 'text-destructive'}`}>
      {result.ok ? <CheckCircle2 className="mt-px size-3.5 shrink-0" /> : <XCircle className="mt-px size-3.5 shrink-0" />}
      {result.message}
    </p>
  )
}

function RegistryRow({ registry }) {
  const queryClient = useQueryClient()
  const [result, setResult] = useState(null)
  const test = useMutation({ mutationFn: () => api.post(`/registries/${registry.id}/test`), onSuccess: setResult })
  const remove = useMutation({
    mutationFn: () => api.delete(`/registries/${registry.id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.externalRegistries }),
  })

  return (
    <div className="grid gap-1 p-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Container className="text-muted-foreground size-4" />
        <span className="font-medium">{registry.name}</span>
        <span className="text-muted-foreground font-mono text-xs">{registry.url}</span>
        <span className="text-muted-foreground text-xs">{registry.username ? `as ${registry.username}` : 'anonymous'}</span>
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => test.mutate()} disabled={test.isPending}>
            {test.isPending && <Loader2 className="animate-spin" />} Test
          </Button>
          <RegistryDialog registry={registry} />
          <ConfirmDialog
            title={`Remove ${registry.name}?`}
            description="Runs stop getting these credentials. Pipelines that push or pull there will fail."
            confirmLabel="Remove"
            onConfirm={() => remove.mutate()}
            trigger={
              <Button variant="ghost" size="icon" aria-label={`Remove ${registry.name}`}>
                <Trash2 />
              </Button>
            }
          />
        </div>
      </div>
      <div className="pl-7">
        <TestResult result={result} />
      </div>
    </div>
  )
}

const EMPTY = { name: '', url: '', username: '', password: '' }

// Add or edit. When editing, an empty password keeps the stored one.
function RegistryDialog({ registry }) {
  const queryClient = useQueryClient()
  const editing = Boolean(registry)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [result, setResult] = useState(null)
  const set = (patch) => {
    setForm({ ...form, ...patch })
    setResult(null)
  }

  function onOpenChange(next) {
    setOpen(next)
    if (next) {
      setForm(editing ? { name: registry.name, url: registry.url, username: registry.username ?? '', password: '' } : EMPTY)
      setResult(null)
    }
  }

  const payload = () => ({ name: form.name, url: form.url, username: form.username || null, ...(form.password && { password: form.password }) })
  const test = useMutation({
    mutationFn: () => api.post('/registries/test', { ...payload(), ...(editing && { id: registry.id }) }),
    onSuccess: setResult,
  })
  const save = useMutation({
    mutationFn: () => (editing ? api.patch(`/registries/${registry.id}`, payload()) : api.post('/registries', payload())),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.externalRegistries })
      toast.success(`Saved ${form.name}`)
      setOpen(false)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {editing ? (
          <Button variant="ghost" size="icon" aria-label={`Edit ${registry.name}`}>
            <Pencil />
          </Button>
        ) : (
          <Button variant="outline">
            <Plus /> Add registry
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${registry.name}` : 'Add registry'}</DialogTitle>
            <DialogDescription>Use a token with only the access your pipelines need.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="reg-name">Name</Label>
            <Input id="reg-name" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="GitHub" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="reg-url">Registry</Label>
            <Input id="reg-url" value={form.url} onChange={(e) => set({ url: e.target.value })} placeholder="ghcr.io, docker.io, registry.example.com" className="font-mono" required />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="reg-user">User name</Label>
              <Input id="reg-user" value={form.username} onChange={(e) => set({ username: e.target.value })} autoComplete="off" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="reg-password">Password or token</Label>
              <Input
                id="reg-password"
                type="password"
                value={form.password}
                onChange={(e) => set({ password: e.target.value })}
                placeholder={editing && registry.hasPassword ? '•••••••• (keep)' : ''}
                autoComplete="new-password"
              />
            </div>
          </div>
          <TestResult result={result} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => test.mutate()} disabled={!form.url || test.isPending}>
              {test.isPending && <Loader2 className="animate-spin" />} Test connection
            </Button>
            <Button type="submit" disabled={!form.name || !form.url || save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
