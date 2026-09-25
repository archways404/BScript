import { Ban, CheckCircle2, CircleDashed, Clock, Loader2, MinusCircle, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const STATUS = {
  queued: { icon: Clock, label: 'Queued', badge: 'muted', color: 'text-muted-foreground' },
  pending: { icon: CircleDashed, label: 'Pending', badge: 'muted', color: 'text-muted-foreground' },
  running: { icon: Loader2, label: 'Running', badge: 'warning', color: 'text-warning', spin: true },
  success: { icon: CheckCircle2, label: 'Success', badge: 'success', color: 'text-success' },
  failed: { icon: XCircle, label: 'Failed', badge: 'destructive', color: 'text-destructive' },
  cancelled: { icon: Ban, label: 'Cancelled', badge: 'muted', color: 'text-muted-foreground' },
  skipped: { icon: MinusCircle, label: 'Skipped', badge: 'muted', color: 'text-muted-foreground' },
}

export function StatusIcon({ status, className }) {
  const { icon: Icon, color, spin, label } = STATUS[status] ?? STATUS.pending
  return <Icon aria-label={label} className={cn('size-4 shrink-0', color, spin && 'animate-spin', className)} />
}

export function StatusBadge({ status, className }) {
  const { badge, label } = STATUS[status] ?? STATUS.pending
  return (
    <Badge variant={badge} className={className}>
      <StatusIcon status={status} className="size-3 text-current" />
      {label}
    </Badge>
  )
}
