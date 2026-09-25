import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { CopyButton } from '@/components/copy-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'
import { keys } from '@/lib/queries'

function Command({ children }) {
  return (
    <div className="bg-muted flex items-start gap-2 rounded-lg p-3">
      <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-xs leading-5 whitespace-pre-wrap">{children}</pre>
      <CopyButton value={children} />
    </div>
  )
}

export function ConnectCard({ overview }) {
  const queryClient = useQueryClient()
  const { address } = overview
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(address)
  const togglePublic = useMutation({
    mutationFn: (publicPull) => api.put('/registry/settings', { publicPull }),
    onSuccess: (settings) => {
      queryClient.invalidateQueries({ queryKey: keys.registry })
      toast.success(settings.publicPull ? 'Anyone can now pull images' : 'Pulling now needs credentials')
    },
  })

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Push and pull with Docker</CardTitle>
          <CardDescription>
            Sign in with the admin password, or with any user name and an{' '}
            <Link to="/settings" className="underline underline-offset-2">
              API token
            </Link>{' '}
            as the password.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Command>{`docker login ${address}`}</Command>
          <Command>{`docker tag my-app ${address}/team/my-app:1.0\ndocker push ${address}/team/my-app:1.0`}</Command>
          <Command>{`docker pull ${address}/team/my-app:1.0`}</Command>
          {!local && (
            <p className="text-muted-foreground text-xs">
              Docker only talks to registries over HTTPS, except on localhost. Put BScript behind a TLS reverse proxy, or
              add <code className="font-mono">{address}</code> to the daemon's <code className="font-mono">insecure-registries</code>.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pull from Kubernetes</CardTitle>
          <CardDescription>Create a pull secret from an API token, then reference it from your pods.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Command>{`kubectl create secret docker-registry bscript-registry \\\n  --docker-server=${address} \\\n  --docker-username=token \\\n  --docker-password=<API token>`}</Command>
          <Command>{`spec:\n  imagePullSecrets:\n    - name: bscript-registry\n  containers:\n    - name: app\n      image: ${address}/team/my-app:1.0`}</Command>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>From pipelines</CardTitle>
          <CardDescription>
            Every run gets short-lived credentials for this registry, plus your external registries from Settings, in a
            Docker config pointed to by <code className="font-mono">DOCKER_CONFIG</code>. No <code className="font-mono">docker login</code>{' '}
            needed. Runs from fork pull requests get none.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Command>{`docker build -t "$BSCRIPT_REGISTRY/team/my-app:\${BSCRIPT_COMMIT_SHA:0:12}" .\ndocker push "$BSCRIPT_REGISTRY/team/my-app:\${BSCRIPT_COMMIT_SHA:0:12}"`}</Command>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-0">
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              Allow anonymous pulls
              <span className="text-muted-foreground block text-xs">Anyone who can reach BScript can pull images. Pushing and deleting still need credentials.</span>
            </span>
            <Switch checked={overview.settings.publicPull} onCheckedChange={(v) => togglePublic.mutate(v)} />
          </label>
        </CardContent>
      </Card>
    </div>
  )
}
