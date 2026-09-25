import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { emptyProject, ProjectFields } from '@/components/project-form'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { keys } from '@/lib/queries'

export function NewProjectDialog({ trigger }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyProject)

  const create = useMutation({
    mutationFn: ({ credential, ...rest }) =>
      api.post('/projects', { ...rest, ...(rest.authType !== 'none' && { credential }) }),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: keys.projects })
      setOpen(false)
      setForm(emptyProject)
      navigate(`/projects/${project.id}`)
    },
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus /> New project
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate(form)
          }}
          className="grid gap-6"
        >
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              A git repository with a <code className="font-mono">.BScript/</code> folder of scripts.
            </DialogDescription>
          </DialogHeader>
          <ProjectFields value={form} onChange={setForm} />
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
