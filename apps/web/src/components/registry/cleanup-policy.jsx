import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Eye, Plus, Recycle, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'
import { bytes, plural, timeAgo } from '@/lib/format'
import { keys, useCleanupPreview } from '@/lib/queries'

// Empty input means "no limit" (null); numbers otherwise.
const toLimit = (value) => (value === '' || value === null || value === undefined ? null : Math.max(0, Number(value)))
const fromLimit = (value) => (value === null || value === undefined ? '' : String(value))

export function CleanupPolicy({ overview }) {
  const queryClient = useQueryClient()
  const saved = overview.settings.retention
  const [form, setForm] = useState(() => ({
    ...saved,
    keepLast: fromLimit(saved.keepLast),
    olderThanDays: fromLimit(saved.olderThanDays),
    rules: saved.rules.map((r) => ({ ...r, keepLast: fromLimit(r.keepLast), olderThanDays: fromLimit(r.olderThanDays) })),
  }))
  const [showPreview, setShowPreview] = useState(false)
  const preview = useCleanupPreview(showPreview)
  const set = (patch) => setForm({ ...form, ...patch })
  const setRule = (index, patch) => set({ rules: form.rules.map((r, i) => (i === index ? { ...r, ...patch } : r)) })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: keys.registry })
    queryClient.invalidateQueries({ queryKey: keys.cleanupPreview })
    queryClient.invalidateQueries({ queryKey: keys.cleanups })
  }

  const save = useMutation({
    mutationFn: () =>
      api.put('/registry/settings', {
        retention: {
          enabled: form.enabled,
          schedule: form.schedule,
          keepLast: toLimit(form.keepLast),
          olderThanDays: toLimit(form.olderThanDays),
          protect: form.protect,
          // A blank field in a rule inherits the default (the key is left out).
          rules: form.rules
            .filter((r) => r.repository.trim())
            .map((r) => ({
              repository: r.repository.trim(),
              ...(r.keepForever
                ? { keepForever: true }
                : {
                    ...(r.keepLast !== '' && { keepLast: toLimit(r.keepLast) }),
                    ...(r.olderThanDays !== '' && { olderThanDays: toLimit(r.olderThanDays) }),
                    ...(r.protect && { protect: r.protect }),
                  }),
            })),
        },
      }),
    onSuccess: () => {
      invalidate()
      toast.success('Cleanup policy saved')
    },
  })

  const run = useMutation({
    mutationFn: (garbageOnly) => api.post('/registry/cleanup', { garbageOnly }),
    onSuccess: () => {
      invalidate()
      toast('Cleanup started. Pulls pause briefly while garbage collection runs.')
    },
  })

  const busy = overview.cleanupRunning || overview.state !== 'running'

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Cleanup policy</CardTitle>
          <CardDescription>
            A tag is deleted when it is not protected, is not among the newest tags kept, and is older than the age
            limit. Leave a limit empty to ignore it. Deleted tags free disk space once garbage collection runs, which
            every cleanup does.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-5"
            onSubmit={(e) => {
              e.preventDefault()
              save.mutate()
            }}
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="keep-last">Keep the newest</Label>
                <div className="flex items-center gap-2">
                  <Input id="keep-last" type="number" min={0} value={form.keepLast} onChange={(e) => set({ keepLast: e.target.value })} placeholder="No limit" />
                  <span className="text-muted-foreground shrink-0 text-sm">tags</span>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="older-than">Delete when older than</Label>
                <div className="flex items-center gap-2">
                  <Input id="older-than" type="number" min={0} value={form.olderThanDays} onChange={(e) => set({ olderThanDays: e.target.value })} placeholder="No limit" />
                  <span className="text-muted-foreground shrink-0 text-sm">days</span>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="protect">Never delete</Label>
                <Input id="protect" value={form.protect} onChange={(e) => set({ protect: e.target.value })} placeholder="latest, v*" className="font-mono" />
              </div>
            </div>

            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Repository rules</legend>
              <p className="text-muted-foreground text-xs">
                The first matching rule replaces the defaults for that repository. Blank fields use the default.
              </p>
              {form.rules.map((rule, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
                  <Input
                    value={rule.repository}
                    onChange={(e) => setRule(index, { repository: e.target.value })}
                    placeholder="team/** or app"
                    className="w-44 font-mono"
                    aria-label="Repository pattern"
                  />
                  <label className="text-muted-foreground flex items-center gap-2 text-sm">
                    <Switch checked={Boolean(rule.keepForever)} onCheckedChange={(keepForever) => setRule(index, { keepForever })} />
                    Keep forever
                  </label>
                  {!rule.keepForever && (
                    <>
                      <Input type="number" min={0} value={rule.keepLast} onChange={(e) => setRule(index, { keepLast: e.target.value })} placeholder={`keep ${form.keepLast || '∞'}`} className="w-28" aria-label="Keep the newest" />
                      <Input type="number" min={0} value={rule.olderThanDays} onChange={(e) => setRule(index, { olderThanDays: e.target.value })} placeholder={`${form.olderThanDays || '∞'} days`} className="w-28" aria-label="Older than days" />
                      <Input value={rule.protect ?? ''} onChange={(e) => setRule(index, { protect: e.target.value })} placeholder={form.protect || 'protect…'} className="w-32 font-mono" aria-label="Never delete" />
                    </>
                  )}
                  <Button type="button" variant="ghost" size="icon" className="ml-auto" onClick={() => set({ rules: form.rules.filter((_, i) => i !== index) })} aria-label="Remove rule">
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <div>
                <Button type="button" variant="outline" size="sm" onClick={() => set({ rules: [...form.rules, { repository: '', keepForever: false, keepLast: '', olderThanDays: '', protect: '' }] })}>
                  <Plus /> Add rule
                </Button>
              </div>
            </fieldset>

            <div className="grid gap-3 rounded-lg border p-3">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  Clean up automatically
                  <span className="text-muted-foreground block text-xs">
                    {saved.enabled && overview.nextCleanupAt ? `Next run ${timeAgo(overview.nextCleanupAt)}` : 'Runs the policy, then garbage collection, on a schedule.'}
                  </span>
                </span>
                <Switch checked={form.enabled} onCheckedChange={(enabled) => set({ enabled })} />
              </label>
              {form.enabled && (
                <div className="grid gap-2">
                  <Label htmlFor="cleanup-schedule">Schedule (cron, server time zone)</Label>
                  <Input id="cleanup-schedule" value={form.schedule} onChange={(e) => set({ schedule: e.target.value })} className="font-mono" placeholder="0 4 * * *" />
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={save.isPending}>
                Save policy
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowPreview(true)}>
                <Eye /> Preview
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="outline" disabled={busy}>
                    <Recycle /> Run cleanup now
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Run cleanup now?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Applies the saved policy, then garbage-collects. The registry pauses for a moment while it does,
                      so pulls and pushes wait. Unsaved changes above are not used.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => run.mutate(false)}>Run cleanup</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => run.mutate(true)} title="Free space from deleted tags without applying the policy">
                Garbage collect only
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {showPreview && <CleanupPreview preview={preview} />}
    </div>
  )
}

function CleanupPreview({ preview }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Preview
          {preview.data && <Badge variant={preview.data.tags.length ? 'warning' : 'success'}>{plural(preview.data.tags.length, 'tag')}</Badge>}
        </CardTitle>
        <CardDescription>
          What the saved policy deletes right now
          {preview.data?.tags.length ? `, freeing up to ${bytes(preview.data.reclaimableBytes)}` : ''}. Layers still used
          by other images stay.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {preview.isPending && <p className="text-muted-foreground text-sm">Working it out…</p>}
        {preview.data?.tags.length === 0 && <p className="text-muted-foreground text-sm">Nothing to delete.</p>}
        {preview.data?.tags.length > 0 && (
          <ul className="divide-border divide-y text-sm">
            {preview.data.tags.map((tag) => (
              <li key={`${tag.repository}:${tag.tag}`} className="flex flex-wrap items-center gap-x-3 py-1.5">
                <span className="font-mono">
                  {tag.repository}:{tag.tag}
                </span>
                <span className="text-muted-foreground text-xs">
                  pushed {timeAgo(tag.pushedAt)} · {bytes(tag.size)} · {tag.reason}
                  {tag.rule && ` (rule ${tag.rule})`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
