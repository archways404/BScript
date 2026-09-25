import { useEffect, useState } from 'react'
import { FolderGit2, Play, TerminalSquare } from 'lucide-react'
import { ThemeToggle } from '@/components/theme-toggle'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

function useServerHealth() {
  const [health, setHealth] = useState({ state: 'checking' })
  useEffect(() => {
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then(() => setHealth({ state: 'online' }))
      .catch(() => setHealth({ state: 'offline' }))
  }, [])
  return health
}

const HEALTH_BADGE = {
  checking: { variant: 'muted', label: 'Checking…' },
  online: { variant: 'success', label: 'Server online' },
  offline: { variant: 'destructive', label: 'Server offline' },
}

export default function App() {
  const health = useServerHealth()
  const badge = HEALTH_BADGE[health.state]

  return (
    <>
      <div className="ambient" />
      <header className="glass sticky top-0 z-10 border-x-0 border-t-0">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <TerminalSquare className="size-5" />
          <span className="font-semibold tracking-tight">BScript</span>
          <Badge variant={badge.variant} className="ml-2">
            <span className="size-1.5 rounded-full bg-current" />
            {badge.label}
          </Badge>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Connect a repository with a <code className="font-mono">.BScript/</code> folder to start building pipelines.
        </p>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderGit2 className="size-4" /> No projects yet
            </CardTitle>
            <CardDescription>
              Projects, pipelines and runs arrive with the API milestone. Until then, try the runner from the CLI.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted overflow-x-auto rounded-lg p-4 font-mono text-xs">
              pnpm bscript run --repo &lt;url|path&gt; --ref main
            </pre>
            <Button className="mt-4" disabled>
              <Play /> New project
            </Button>
          </CardContent>
        </Card>
      </main>
    </>
  )
}
