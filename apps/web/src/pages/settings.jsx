import { useMutation, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/components/copy-button'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { keys, useTokens } from '@/lib/queries'

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-6">
        <TokensCard />
        <PasswordCard />
      </div>
    </>
  )
}

function TokensCard() {
  const queryClient = useQueryClient()
  const tokens = useTokens()
  const [name, setName] = useState('')
  const [created, setCreated] = useState(null)
  const invalidate = () => queryClient.invalidateQueries({ queryKey: keys.tokens })

  const create = useMutation({
    mutationFn: () => api.post('/tokens', { name }),
    onSuccess: (token) => {
      setCreated(token)
      setName('')
      invalidate()
    },
  })
  const remove = useMutation({ mutationFn: (id) => api.delete(`/tokens/${id}`), onSuccess: invalidate })

  return (
    <Card>
      <CardHeader>
        <CardTitle>API tokens</CardTitle>
        <CardDescription>
          For scripts and other tools. Send as <code className="font-mono">Authorization: Bearer &lt;token&gt;</code>, e.g.{' '}
          <code className="font-mono">POST /api/pipelines/:id/runs</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {created && (
          <div className="border-success/30 bg-success/10 rounded-lg border p-3 text-sm">
            <p className="mb-2">Copy the token for "{created.name}" now. It won't be shown again.</p>
            <div className="flex gap-2">
              <Input readOnly value={created.token} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
              <CopyButton value={created.token} />
            </div>
          </div>
        )}

        <div className="divide-border divide-y rounded-lg border">
          {tokens.data?.length === 0 && (
            <p className="text-muted-foreground flex items-center gap-2 p-3 text-sm">
              <KeyRound className="size-4" /> No tokens yet.
            </p>
          )}
          {tokens.data?.map((token) => (
            <div key={token.id} className="flex items-center gap-3 p-3 text-sm">
              <KeyRound className="text-muted-foreground size-4" />
              <span className="font-medium">{token.name}</span>
              <span className="text-muted-foreground ml-auto text-xs">
                created {timeAgo(token.createdAt)} · {token.lastUsedAt ? `used ${timeAgo(token.lastUsedAt)}` : 'never used'}
              </span>
              <ConfirmDialog
                title={`Revoke "${token.name}"?`}
                description="Anything using this token will stop working immediately."
                confirmLabel="Revoke"
                onConfirm={() => remove.mutate(token.id)}
                trigger={
                  <Button variant="ghost" size="icon" aria-label={`Revoke ${token.name}`}>
                    <Trash2 />
                  </Button>
                }
              />
            </div>
          ))}
        </div>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <Input placeholder="Token name, e.g. deploy-bot" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" disabled={!name || create.isPending}>
            <Plus /> Create
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function PasswordCard() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' })
  const mismatch = form.confirm && form.confirm !== form.newPassword
  const change = useMutation({
    mutationFn: () => api.post('/auth/password', { currentPassword: form.currentPassword, newPassword: form.newPassword }),
    onSuccess: () => {
      setForm({ currentPassword: '', newPassword: '', confirm: '' })
      toast.success('Password changed. Other sessions were signed out.')
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Changing it signs out every other session.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid max-w-sm gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!mismatch) change.mutate()
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="pw-current">Current password</Label>
            <Input
              id="pw-current"
              type="password"
              autoComplete="current-password"
              value={form.currentPassword}
              onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pw-new">New password</Label>
            <Input
              id="pw-new"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={form.newPassword}
              onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pw-confirm">Confirm new password</Label>
            <Input
              id="pw-confirm"
              type="password"
              autoComplete="new-password"
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
              aria-invalid={Boolean(mismatch)}
              required
            />
            {mismatch && <p className="text-destructive text-xs">Passwords don't match</p>}
          </div>
          <div>
            <Button type="submit" disabled={change.isPending || Boolean(mismatch)}>
              Change password
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
