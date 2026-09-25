import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Container, Loader2, Power, RefreshCw } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { CleanupHistory } from '@/components/registry/cleanup-history'
import { CleanupPolicy } from '@/components/registry/cleanup-policy'
import { ConnectCard } from '@/components/registry/connect-card'
import { RepositoryList } from '@/components/registry/repository-list'
import { StatTile } from '@/components/stat-tile'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePageTitle } from '@/hooks/use-page-title'
import { api } from '@/lib/api'
import { bytes, plural, timeAgo } from '@/lib/format'
import { keys, useCleanupPreview, useRegistry } from '@/lib/queries'

const TABS = ['images', 'cleanup', 'connect']
const STATE_BADGE = {
  running: { variant: 'success', label: 'Running' },
  starting: { variant: 'warning', label: 'Starting' },
  maintenance: { variant: 'warning', label: 'Garbage collecting' },
  crashed: { variant: 'destructive', label: 'Restarting' },
  unavailable: { variant: 'destructive', label: 'Unavailable' },
  stopped: { variant: 'muted', label: 'Off' },
}

export function RegistryPage() {
  const { tab = 'images' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  usePageTitle('Registry')
  const registry = useRegistry()
  const data = registry.data
  const running = data?.state === 'running'
  const preview = useCleanupPreview(running)

  const toggle = useMutation({
    mutationFn: (enabled) => api.put('/registry/settings', { enabled }),
    onSuccess: (settings) => {
      queryClient.invalidateQueries({ queryKey: keys.registry })
      toast.success(settings.enabled ? 'Registry turned on' : 'Registry turned off')
    },
  })
  const sync = useMutation({
    mutationFn: () => api.post('/registry/sync'),
    onSuccess: ({ added, removed }) => {
      queryClient.invalidateQueries({ queryKey: keys.registry })
      queryClient.invalidateQueries({ queryKey: ['registry', 'tags'] })
      toast.success(added || removed ? `Found ${added} new and ${removed} removed tags` : 'Already up to date')
    },
  })

  if (registry.isPending) return <Skeleton className="h-10 w-64" />
  const badge = STATE_BADGE[data.state] ?? STATE_BADGE.stopped
  const enabled = data.settings.enabled

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            Registry <Badge variant={badge.variant}>{data.state === 'starting' && <Loader2 className="size-3 animate-spin" />}{badge.label}</Badge>
          </span>
        }
        description={
          <>
            Container images stored in this BScript, at <code className="font-mono">{data.address}</code>.
          </>
        }
        actions={
          <>
            {running && (
              <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending} title="Re-read tags from the registry">
                <RefreshCw className={sync.isPending ? 'animate-spin' : undefined} /> Sync
              </Button>
            )}
            <label className="glass flex h-9 items-center gap-2 rounded-md px-3 text-sm">
              <Power className="size-4" /> {enabled ? 'On' : 'Off'}
              <Switch checked={enabled} onCheckedChange={(v) => toggle.mutate(v)} disabled={toggle.isPending} aria-label="Registry on" />
            </label>
          </>
        }
      />

      {enabled && (data.state === 'unavailable' || data.state === 'crashed') && (
        <div className="border-destructive/30 bg-destructive/10 mb-6 rounded-xl border p-4 text-sm">
          <p className="text-destructive flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4" /> {data.error}
          </p>
          {data.log.length > 0 && (
            <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-black/70 p-3 font-mono text-xs text-neutral-300">{data.log.join('\n')}</pre>
          )}
        </div>
      )}

      {!enabled ? (
        <EmptyState
          icon={Container}
          title="The registry is off"
          description="Turn it on to push and pull images at this server's address. Stored images are kept while it's off."
          action={
            <Button onClick={() => toggle.mutate(true)} disabled={toggle.isPending}>
              Turn on
            </Button>
          }
        />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Repositories" value={data.usage.repositories} />
            <StatTile label="Tags" value={data.usage.tags} />
            <StatTile label="Disk used" value={bytes(data.usage.diskBytes)} hint="Includes layers of deleted tags until garbage collection" />
            <StatTile
              label="Next cleanup"
              value={data.cleanupRunning ? 'Running' : data.nextCleanupAt ? timeAgo(data.nextCleanupAt) : 'Off'}
              hint={preview.data?.tags.length ? `${plural(preview.data.tags.length, 'tag')}, up to ${bytes(preview.data.reclaimableBytes)}` : data.nextCleanupAt ? 'Nothing to delete' : 'Set a schedule under Cleanup'}
            />
          </div>

          <Tabs value={TABS.includes(tab) ? tab : 'images'} onValueChange={(t) => navigate(t === 'images' ? '/registry' : `/registry/${t}`)}>
            <TabsList className="glass mb-6 max-w-full justify-start overflow-x-auto">
              <TabsTrigger value="images">Images</TabsTrigger>
              <TabsTrigger value="cleanup">Cleanup</TabsTrigger>
              <TabsTrigger value="connect">Connect</TabsTrigger>
            </TabsList>
            <TabsContent value="images">
              <RepositoryList address={data.address} repositories={data.repositories} doomed={preview.data?.tags ?? []} />
            </TabsContent>
            <TabsContent value="cleanup" className="grid gap-6">
              <CleanupPolicy overview={data} />
              <CleanupHistory />
            </TabsContent>
            <TabsContent value="connect">
              <ConnectCard overview={data} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </>
  )
}
