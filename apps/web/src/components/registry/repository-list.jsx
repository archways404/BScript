import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Box, ChevronRight, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/components/copy-button'
import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import { bytes, plural, shortDigest, timeAgo } from '@/lib/format'
import { keys, useRegistryTags } from '@/lib/queries'
import { cn } from '@/lib/utils'

export function RepositoryList({ address, repositories, doomed }) {
  if (repositories.length === 0) {
    return (
      <EmptyState
        icon={Box}
        title="No images yet"
        description="Push an image and it shows up here. See the Connect tab for the commands."
      />
    )
  }
  return (
    <div className="grid gap-2">
      {repositories.map((repository) => (
        <RepositoryRow key={repository.repository} address={address} repository={repository} doomed={doomed} />
      ))}
    </div>
  )
}

function RepositoryRow({ address, repository, doomed }) {
  const [open, setOpen] = useState(false)
  const doomedHere = doomed.filter((t) => t.repository === repository.repository).length

  return (
    <section className="glass overflow-hidden rounded-xl">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="hover:bg-accent/50 flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors"
      >
        <ChevronRight className={cn('text-muted-foreground size-4 transition-transform', open && 'rotate-90')} />
        <Box className="text-muted-foreground size-4" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
          <span className="truncate font-mono">{repository.repository}</span>
          <span className="text-muted-foreground text-xs sm:ml-auto">
            {plural(repository.tags, 'tag')} · {bytes(repository.size)} · pushed {timeAgo(repository.lastPushedAt)}
          </span>
        </span>
        {doomedHere > 0 && <Badge variant="warning">{doomedHere} in next cleanup</Badge>}
      </button>
      {open && <TagTable address={address} repository={repository.repository} doomed={doomed} />}
    </section>
  )
}

function TagTable({ address, repository, doomed }) {
  const queryClient = useQueryClient()
  const tags = useRegistryTags(repository)
  const [selected, setSelected] = useState(new Set())
  const doomedTags = new Map(doomed.filter((t) => t.repository === repository).map((t) => [t.tag, t.reason]))

  const remove = useMutation({
    mutationFn: (names) => api.post('/registry/tags/delete', { items: names.map((tag) => ({ repository, tag })) }),
    onSuccess: (results) => {
      const failed = results.filter((r) => !r.ok)
      if (failed.length) toast.error(`${failed.length} tag${failed.length === 1 ? '' : 's'} could not be deleted`)
      else toast.success(`Deleted ${results.length} tag${results.length === 1 ? '' : 's'}. Run garbage collection to free the space.`)
      setSelected(new Set())
      queryClient.invalidateQueries({ queryKey: keys.registry })
    },
  })

  if (tags.isPending) return <Skeleton className="m-3 h-20 rounded-lg" />
  const all = tags.data ?? []
  const toggle = (tag) => {
    const next = new Set(selected)
    next.has(tag) ? next.delete(tag) : next.add(tag)
    setSelected(next)
  }

  return (
    <div className="border-t px-2 pb-2">
      <div className="flex flex-wrap items-center gap-2 px-2 py-2">
        <label className="text-muted-foreground flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="accent-primary size-3.5"
            checked={all.length > 0 && selected.size === all.length}
            onChange={(e) => setSelected(e.target.checked ? new Set(all.map((t) => t.tag)) : new Set())}
          />
          Select all
        </label>
        <div className="ml-auto flex gap-2">
          {selected.size > 0 && (
            <ConfirmDialog
              title={`Delete ${selected.size} tag${selected.size === 1 ? '' : 's'}?`}
              description="Anything pulling these tags will stop finding them. Layers are freed by the next garbage collection."
              onConfirm={() => remove.mutate([...selected])}
              trigger={
                <Button variant="destructive" size="sm">
                  <Trash2 /> Delete {selected.size}
                </Button>
              }
            />
          )}
          <ConfirmDialog
            title={`Delete ${repository}?`}
            description={`All ${all.length} tags are deleted. Layers are freed by the next garbage collection.`}
            confirmLabel="Delete repository"
            onConfirm={() => remove.mutate(all.map((t) => t.tag))}
            trigger={
              <Button variant="ghost" size="sm">
                <Trash2 /> Delete repository
              </Button>
            }
          />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground text-left text-xs">
            <tr>
              <th className="w-8" />
              <th className="px-2 py-1.5 font-normal">Tag</th>
              <th className="px-2 py-1.5 font-normal">Digest</th>
              <th className="px-2 py-1.5 text-right font-normal">Size</th>
              <th className="px-2 py-1.5 font-normal">Pushed</th>
              <th className="px-2 py-1.5 font-normal">Last pulled</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {all.map((tag) => (
              <tr key={tag.tag} className={cn('hover:bg-accent/40', selected.has(tag.tag) && 'bg-accent/50')}>
                <td className="px-2">
                  <input
                    type="checkbox"
                    className="accent-primary size-3.5"
                    checked={selected.has(tag.tag)}
                    onChange={() => toggle(tag.tag)}
                    aria-label={`Select ${tag.tag}`}
                  />
                </td>
                <td className="px-2 py-2">
                  <span className="font-mono">{tag.tag}</span>
                  {doomedTags.has(tag.tag) && (
                    <Badge variant="warning" className="ml-2 py-0" title={doomedTags.get(tag.tag)}>
                      next cleanup
                    </Badge>
                  )}
                </td>
                <td className="text-muted-foreground px-2 py-2 font-mono text-xs" title={tag.digest}>
                  {shortDigest(tag.digest)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{bytes(tag.size)}</td>
                <td className="text-muted-foreground px-2 py-2 text-xs" title={tag.pushedAt}>
                  {timeAgo(tag.pushedAt)}
                </td>
                <td className="text-muted-foreground px-2 py-2 text-xs">{tag.lastPulledAt ? timeAgo(tag.lastPulledAt) : 'never'}</td>
                <td className="px-1">
                  <CopyButton value={`docker pull ${address}/${repository}:${tag.tag}`} label="Copy pull command" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
