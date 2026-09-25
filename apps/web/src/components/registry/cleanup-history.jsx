import { ChevronRight, History } from 'lucide-react'
import { useState } from 'react'
import { StatusIcon } from '@/components/status'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { bytes, duration, timeAgo } from '@/lib/format'
import { useCleanups } from '@/lib/queries'
import { cn } from '@/lib/utils'

export function CleanupHistory() {
  const cleanups = useCleanups()
  return (
    <Card>
      <CardHeader>
        <CardTitle>History</CardTitle>
      </CardHeader>
      <CardContent>
        {cleanups.data?.length === 0 && (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <History className="size-4" /> No cleanups yet.
          </p>
        )}
        <div className="divide-border divide-y">
          {cleanups.data?.map((cleanup) => (
            <CleanupRow key={cleanup.id} cleanup={cleanup} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function CleanupRow({ cleanup }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} className="hover:bg-accent/40 flex w-full items-center gap-3 rounded-md px-1 py-2 text-left text-sm">
        <ChevronRight className={cn('text-muted-foreground size-4 transition-transform', open && 'rotate-90')} />
        <StatusIcon status={cleanup.status} />
        <span>{cleanup.trigger === 'schedule' ? 'Scheduled' : 'Manual'}</span>
        <span className="text-muted-foreground text-xs">{timeAgo(cleanup.startedAt)}</span>
        <span className="text-muted-foreground ml-auto text-xs tabular-nums">
          {cleanup.status === 'running'
            ? 'running…'
            : `${cleanup.deletedTags} tag${cleanup.deletedTags === 1 ? '' : 's'} · ${bytes(cleanup.freedBytes)} freed · ${duration(cleanup.startedAt, cleanup.finishedAt)}`}
        </span>
      </button>
      {open && (
        <div className="pb-3 pl-8">
          {cleanup.error && <p className="text-destructive mb-2 text-sm">{cleanup.error}</p>}
          <pre className="max-h-72 overflow-auto rounded-lg bg-black/80 p-3 font-mono text-xs text-neutral-200">{cleanup.log || 'No output.'}</pre>
        </div>
      )}
    </div>
  )
}
