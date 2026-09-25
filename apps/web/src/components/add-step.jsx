import { FileCode2, Loader2, Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

// Picks a script from the repo's .BScript/ folder, or takes a typed path. A pipeline runs each
// script once, so scripts already in it are shown but can't be added again.
export function AddStep({ scripts, existing = [], onAdd }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const used = new Set(existing)
  const matches = (scripts.data?.scripts ?? []).filter((s) => s.toLowerCase().includes(filter.toLowerCase()))
  const firstFree = matches.find((s) => !used.has(s))
  const custom = filter.trim().replace(/^\.BScript\//, '')

  function add(scriptPath) {
    onAdd(scriptPath)
    setFilter('')
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline">
          <Plus /> Add step
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="start">
        <Input
          autoFocus
          placeholder="Search or type a path…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            const pick = firstFree ?? (custom && !used.has(custom) ? custom : null)
            if (pick) add(pick)
          }}
          className="mb-2 font-mono text-sm"
        />
        <div className="max-h-64 overflow-y-auto">
          {scripts.isPending && (
            <p className="text-muted-foreground flex items-center gap-2 p-2 text-sm">
              <Loader2 className="size-4 animate-spin" /> Fetching scripts…
            </p>
          )}
          {scripts.error && (
            <div className="p-2 text-sm">
              <p className="text-destructive break-words">{scripts.error.message}</p>
              <Button variant="ghost" size="sm" className="mt-1" onClick={() => scripts.refetch()}>
                <RefreshCw /> Retry
              </Button>
            </div>
          )}
          {scripts.data && matches.length === 0 && !custom && (
            <p className="text-muted-foreground p-2 text-sm">No scripts in .BScript/ on {scripts.data.ref}.</p>
          )}
          {matches.map((script) => (
            <button
              key={script}
              type="button"
              onClick={() => add(script)}
              disabled={used.has(script)}
              className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-sm disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
            >
              <FileCode2 className="text-muted-foreground size-4 shrink-0" />
              <span className="truncate">{script}</span>
              {used.has(script) && <span className="text-muted-foreground ml-auto font-sans text-xs">Added</span>}
            </button>
          ))}
          {custom && !matches.includes(custom) && !used.has(custom) && (
            <button
              type="button"
              onClick={() => add(custom)}
              className="hover:bg-accent text-muted-foreground flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
            >
              <Plus className="size-4 shrink-0" /> Add <span className="text-foreground truncate font-mono">{custom}</span>
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
