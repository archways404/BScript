import { useMutation } from '@tanstack/react-query'
import { Play } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'

const NONE = 'none'

export function RunButton({ pipelineId, defaultRef, environments = [], defaultEnvironmentId = null, disabled, disabledReason }) {
  const navigate = useNavigate()
  const [ref, setRef] = useState(defaultRef)
  const [environment, setEnvironment] = useState(defaultEnvironmentId ? String(defaultEnvironmentId) : NONE)
  const start = useMutation({
    mutationFn: () =>
      api.post(`/pipelines/${pipelineId}/runs`, {
        ref: ref || undefined,
        environmentId: environment === NONE ? null : Number(environment),
      }),
    onSuccess: (run) => navigate(`/runs/${run.id}`),
  })

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button disabled={disabled} title={disabled ? disabledReason : undefined}>
          <Play /> Run
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            start.mutate()
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="run-ref">Branch, tag or commit</Label>
            <Input id="run-ref" value={ref} onChange={(e) => setRef(e.target.value)} className="font-mono" autoFocus />
          </div>
          {environments.length > 0 && (
            <div className="grid gap-2">
              <Label>Environment</Label>
              <Select value={environment} onValueChange={setEnvironment}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {environments.map((e) => (
                    <SelectItem key={e.id} value={String(e.id)}>
                      {e.name}
                      {e.branchFilter && <span className="text-muted-foreground font-mono text-xs"> {e.branchFilter}</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button type="submit" disabled={start.isPending}>
            <Play /> Start run
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
