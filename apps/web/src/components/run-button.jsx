import { useMutation } from '@tanstack/react-query'
import { Play } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api } from '@/lib/api'

export function RunButton({ pipelineId, defaultRef, disabled, disabledReason }) {
  const navigate = useNavigate()
  const [ref, setRef] = useState(defaultRef)
  const start = useMutation({
    mutationFn: () => api.post(`/pipelines/${pipelineId}/runs`, { ref: ref || undefined }),
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
          <Button type="submit" disabled={start.isPending}>
            <Play /> Start run
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
