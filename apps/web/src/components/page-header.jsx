import { ChevronRight } from 'lucide-react'
import { Fragment } from 'react'
import { Link } from 'react-router'

// crumbs: [{ label, to }] rendered above the title.
export function PageHeader({ title, description, crumbs = [], actions, children }) {
  return (
    <div className="mb-8">
      {crumbs.length > 0 && (
        <nav className="text-muted-foreground mb-2 flex flex-wrap items-center gap-1 text-sm">
          {crumbs.map((crumb, i) => (
            <Fragment key={crumb.to ?? i}>
              {i > 0 && <ChevronRight className="size-3.5" />}
              <Link to={crumb.to} className="hover:text-foreground transition-colors">
                {crumb.label}
              </Link>
            </Fragment>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <div className="text-muted-foreground mt-1 text-sm">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  )
}
