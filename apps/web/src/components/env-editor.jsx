import { useMutation, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Lock, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'
import { keys, useEnv } from '@/lib/queries'

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

// Env vars for a project or pipeline. Secret values are write-only: the server never sends
// them back, so editing a secret means entering a new value.
export function EnvEditor({ scope, id }) {
  const queryClient = useQueryClient()
  const env = useEnv(scope, id)
  const [draft, setDraft] = useState({ key: '', value: '', secret: false })
  const base = `/${scope}s/${id}/env`
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: keys.env(scope, id) })
    queryClient.invalidateQueries({ queryKey: ['requirements'] })
    if (scope === 'environment') queryClient.invalidateQueries({ predicate: (q) => q.queryKey.includes('environments') })
  }

  const save = useMutation({
    mutationFn: ({ key, value, secret }) => api.put(`${base}/${encodeURIComponent(key)}`, { value, secret }),
    onSuccess: (_, { key }) => {
      invalidate()
      toast.success(`Saved ${key}`)
    },
  })
  const remove = useMutation({
    mutationFn: (key) => api.delete(`${base}/${encodeURIComponent(key)}`),
    onSuccess: invalidate,
  })

  const keyError =
    draft.key && !KEY_PATTERN.test(draft.key)
      ? 'Letters, digits and _ only; cannot start with a digit'
      : draft.key.startsWith('BSCRIPT_')
        ? 'BSCRIPT_* names are reserved'
        : null

  function add(event) {
    event.preventDefault()
    if (!draft.key || keyError) return
    save.mutate(draft, { onSuccess: () => setDraft({ key: '', value: '', secret: false }) })
  }

  return (
    <div className="grid gap-4">
      <div className="glass divide-border divide-y overflow-hidden rounded-xl">
        {env.isPending &&
          Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="flex gap-3 p-3">
              <Skeleton className="h-9 w-40" />
              <Skeleton className="h-9 flex-1" />
            </div>
          ))}
        {env.data?.length === 0 && (
          <p className="text-muted-foreground flex items-center gap-2 p-4 text-sm">
            <KeyRound className="size-4" /> No variables yet.
          </p>
        )}
        {env.data?.map((item) => (
          <EnvRow key={item.key} item={item} onSave={save.mutate} onRemove={() => remove.mutate(item.key)} />
        ))}
      </div>

      <form onSubmit={add} className="glass grid gap-3 rounded-xl p-3 sm:grid-cols-[12rem_1fr_auto_auto] sm:items-start">
        <div>
          <Input
            placeholder="NAME"
            value={draft.key}
            onChange={(e) => setDraft({ ...draft, key: e.target.value.toUpperCase() })}
            className="font-mono"
            aria-invalid={Boolean(keyError)}
          />
          {keyError && <p className="text-destructive mt-1 text-xs">{keyError}</p>}
        </div>
        <Input
          placeholder="value"
          type={draft.secret ? 'password' : 'text'}
          value={draft.value}
          onChange={(e) => setDraft({ ...draft, value: e.target.value })}
          className="font-mono"
          autoComplete="off"
        />
        <label className="text-muted-foreground flex h-9 items-center gap-2 text-sm">
          <Switch checked={draft.secret} onCheckedChange={(secret) => setDraft({ ...draft, secret })} />
          Secret
        </label>
        <Button type="submit" disabled={!draft.key || Boolean(keyError) || save.isPending}>
          <Plus /> Add
        </Button>
      </form>
    </div>
  )
}

function EnvRow({ item, onSave, onRemove }) {
  const [value, setValue] = useState(item.secret ? '' : item.value)
  const dirty = item.secret ? value !== '' : value !== item.value

  return (
    <form
      className="flex flex-wrap items-center gap-3 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        onSave({ key: item.key, value, secret: item.secret }, { onSuccess: () => item.secret && setValue('') })
      }}
    >
      <div className="flex w-48 items-center gap-2 font-mono text-sm">
        {item.secret && <Lock className="text-muted-foreground size-3.5 shrink-0" aria-label="Secret" />}
        <span className="truncate">{item.key}</span>
      </div>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        type={item.secret ? 'password' : 'text'}
        placeholder={item.secret ? '•••••••• (enter to replace)' : ''}
        className="min-w-40 flex-1 font-mono"
        autoComplete="off"
      />
      <Button type="submit" variant="secondary" size="sm" disabled={!dirty}>
        Save
      </Button>
      <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label={`Delete ${item.key}`}>
        <Trash2 />
      </Button>
    </form>
  )
}
