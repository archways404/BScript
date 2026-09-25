import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Check, CircleHelp, Loader2, Lock, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'
import { keys, useRequirements } from '@/lib/queries'
import { cn } from '@/lib/utils'

// Where a key is set: everywhere (project/pipeline) or only in some environments.
function coverage(name, configured) {
  if (configured.pipeline.includes(name)) return { everywhere: 'pipeline' }
  if (configured.project.includes(name)) return { everywhere: 'project' }
  return { environments: configured.environments.map((e) => ({ name: e.name, set: e.keys.includes(name) })) }
}

function isMissing(variable, configured) {
  const where = coverage(variable.name, configured)
  return variable.level === 'required' && !where.everywhere && !where.environments.some((e) => e.set)
}

const LEVEL_BADGE = {
  required: { label: 'required', variant: 'outline' },
  optional: { label: 'optional', variant: 'muted' },
  referenced: { label: 'detected', variant: 'muted' },
}

export function RequirementsCard({ projectId, pipelineId, defaultEnvironmentId = null, steps }) {
  const requirements = useRequirements(projectId, pipelineId, steps)
  const [showDetected, setShowDetected] = useState(false)
  const data = requirements.data
  const main = data?.variables.filter((v) => v.level !== 'referenced') ?? []
  const detected = data?.variables.filter((v) => v.level === 'referenced') ?? []
  const missing = main.filter((v) => isMissing(v, data.configured)).length

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Variables these steps use
          {requirements.isFetching && <Loader2 className="text-muted-foreground size-3.5 animate-spin" />}
          {data && (missing ? <Badge variant="destructive">{missing} missing</Badge> : main.length > 0 && <Badge variant="success">All set</Badge>)}
        </CardTitle>
        <CardDescription>
          Read from the scripts on {data?.ref ?? 'the default branch'}. Declare them with{' '}
          <code className="font-mono">
            # @env NAME [secret] [optional] description
          </code>{' '}
          to make them required; runs then stop before the first step if one is missing.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {steps.length === 0 && <p className="text-muted-foreground text-sm">Add steps to see what they need.</p>}
        {requirements.error && <p className="text-destructive text-sm">{requirements.error.message}</p>}
        {data && main.length === 0 && detected.length === 0 && (
          <p className="text-muted-foreground text-sm">These steps don't read any configurable variables.</p>
        )}
        {data && (
          <div className="divide-border divide-y">
            {main.map((variable) => (
              <RequirementRow key={variable.name} variable={variable} data={data} projectId={projectId} pipelineId={pipelineId} defaultEnvironmentId={defaultEnvironmentId} />
            ))}
            {showDetected &&
              detected.map((variable) => (
                <RequirementRow key={variable.name} variable={variable} data={data} projectId={projectId} pipelineId={pipelineId} defaultEnvironmentId={defaultEnvironmentId} />
              ))}
          </div>
        )}
        {detected.length > 0 && (
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowDetected(!showDetected)}>
            <CircleHelp />
            {showDetected ? 'Hide' : 'Show'} {detected.length} other variable{detected.length === 1 ? '' : 's'} the scripts read
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function RequirementRow({ variable, data, projectId, pipelineId, defaultEnvironmentId }) {
  const where = coverage(variable.name, data.configured)
  const missing = isMissing(variable, data.configured)
  const { label, variant } = LEVEL_BADGE[variable.level]

  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {missing ? (
            <AlertCircle className="text-destructive size-4" aria-label="Missing" />
          ) : (
            <Check className={cn('size-4', where.everywhere || where.environments?.some((e) => e.set) ? 'text-success' : 'text-muted-foreground/40')} />
          )}
          <span className="font-mono text-sm">{variable.name}</span>
          {variable.secret && <Lock className="text-muted-foreground size-3.5" aria-label="Secret" />}
          <Badge variant={variant} className="py-0">
            {label}
          </Badge>
        </div>
        <p className="text-muted-foreground mt-1 pl-6 text-xs">
          {variable.description && <>{variable.description} · </>}
          {variable.steps.join(', ')}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {where.everywhere ? (
          <Badge variant="success">set in {where.everywhere}</Badge>
        ) : (
          where.environments.map((e) => (
            <Badge key={e.name} variant={e.set ? 'success' : 'muted'} title={e.set ? `Set in ${e.name}` : `Not set in ${e.name}`}>
              {e.set ? <Check className="size-3" /> : <X className="size-3" />}
              {e.name}
            </Badge>
          ))
        )}
        {!where.everywhere && (
          <AddVariable variable={variable} data={data} projectId={projectId} pipelineId={pipelineId} defaultEnvironmentId={defaultEnvironmentId} />
        )}
      </div>
    </div>
  )
}

// Suggests where to set a var: the pipeline's own environment if it lacks it, then any other
// environment that lacks it, else the project.
function suggestScope(variable, data, defaultEnvironmentId) {
  const lacking = data.configured.environments.filter((e) => !e.keys.includes(variable.name))
  const target = lacking.find((e) => e.id === defaultEnvironmentId) ?? lacking[0]
  return target ? `environment:${target.id}` : 'project'
}

function AddVariable({ variable, data, projectId, pipelineId, defaultEnvironmentId }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState(() => suggestScope(variable, data, defaultEnvironmentId))
  const [value, setValue] = useState('')
  const [secret, setSecret] = useState(variable.secret)

  const save = useMutation({
    mutationFn: () => {
      const [kind, id] = scope.split(':')
      const base = kind === 'project' ? `/projects/${projectId}` : kind === 'pipeline' ? `/pipelines/${pipelineId}` : `/environments/${id}`
      return api.put(`${base}/env/${variable.name}`, { value, secret })
    },
    onSuccess: () => {
      const [kind, id] = scope.split(':')
      queryClient.invalidateQueries({ queryKey: ['requirements'] })
      queryClient.invalidateQueries({ queryKey: keys.env(kind, Number(id ?? (kind === 'project' ? projectId : pipelineId))) })
      queryClient.invalidateQueries({ queryKey: keys.environments(projectId) })
      toast.success(`Saved ${variable.name}`)
      setOpen(false)
      setValue('')
    },
  })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus /> Add
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <p className="font-mono text-sm">{variable.name}</p>
          <div className="grid gap-2">
            <Label>Set on</Label>
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="project">Project (every pipeline)</SelectItem>
                {pipelineId && <SelectItem value="pipeline">This pipeline</SelectItem>}
                {data.configured.environments.map((e) => (
                  <SelectItem key={e.id} value={`environment:${e.id}`}>
                    Environment: {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`req-${variable.name}`}>Value</Label>
            <Input
              id={`req-${variable.name}`}
              type={secret ? 'password' : 'text'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="font-mono"
              autoComplete="off"
              autoFocus
            />
          </div>
          <label className="text-muted-foreground flex items-center gap-2 text-sm">
            <Switch checked={secret} onCheckedChange={setSecret} /> Secret
          </label>
          <Button type="submit" disabled={save.isPending}>
            Save
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
