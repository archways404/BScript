import { useQueryClient } from '@tanstack/react-query'
import { Loader2, TerminalSquare } from 'lucide-react'
import { useState } from 'react'
import { Ambient } from '@/components/app-shell'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePageTitle } from '@/hooks/use-page-title'
import { api } from '@/lib/api'
import { keys } from '@/lib/queries'

export function LoginPage() {
  usePageTitle('Sign in')
  const queryClient = useQueryClient()
  const [error, setError] = useState(null)
  const [pending, setPending] = useState(false)

  async function submit(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    setError(null)
    try {
      await api.post('/auth/login', { username: form.get('username'), password: form.get('password') })
      await queryClient.invalidateQueries({ queryKey: keys.me })
    } catch (err) {
      setError(err.message)
      setPending(false)
    }
  }

  return (
    <div className="grid min-h-svh place-items-center p-4">
      <Ambient />
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="bg-primary text-primary-foreground mx-auto mb-2 grid size-10 place-items-center rounded-xl">
            <TerminalSquare className="size-5" />
          </div>
          <CardTitle className="text-xl">Sign in to BScript</CardTitle>
          <CardDescription>Use the admin account set on the server.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="username">Username</Label>
              <Input id="username" name="username" defaultValue="admin" autoComplete="username" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" autoFocus required />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
