import { cn } from '@/lib/utils'

export function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div className={cn('glass flex flex-col items-center rounded-xl px-6 py-12 text-center', className)}>
      {Icon && (
        <div className="bg-muted mb-4 grid size-11 place-items-center rounded-xl">
          <Icon className="text-muted-foreground size-5" />
        </div>
      )}
      <h3 className="font-medium">{title}</h3>
      {description && <p className="text-muted-foreground mt-1 max-w-sm text-sm">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
