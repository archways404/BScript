import { cn } from '@/lib/utils'

export function StatTile({ label, value, hint, className }) {
  return (
    <div className={cn('glass rounded-xl px-4 py-3', className)}>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-muted-foreground mt-0.5 truncate text-xs">{hint}</div>}
    </div>
  )
}
