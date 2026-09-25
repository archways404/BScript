import { SearchX } from 'lucide-react'
import { Link } from 'react-router'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'

export function NotFoundPage({ what = 'Page' }) {
  return (
    <EmptyState
      icon={SearchX}
      title={`${what} not found`}
      description="It may have been deleted, or the link is wrong."
      action={
        <Button asChild variant="outline">
          <Link to="/">Back to dashboard</Link>
        </Button>
      }
    />
  )
}
