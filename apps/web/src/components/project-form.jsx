import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

export const emptyProject = { name: '', repoUrl: '', defaultBranch: 'main', authType: 'none', credential: '' }

// Controlled fields shared by "New project" and project settings. When editing, an empty
// credential means "keep the stored one".
export function ProjectFields({ value, onChange, hasCredential = false }) {
  const set = (patch) => onChange({ ...value, ...patch })
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="project-name">Name</Label>
        <Input id="project-name" value={value.name} onChange={(e) => set({ name: e.target.value })} required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="project-repo">Repository URL</Label>
        <Input
          id="project-repo"
          value={value.repoUrl}
          onChange={(e) => set({ repoUrl: e.target.value })}
          placeholder="https://github.com/org/repo.git"
          className="font-mono"
          required
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="project-branch">Default branch</Label>
          <Input
            id="project-branch"
            value={value.defaultBranch}
            onChange={(e) => set({ defaultBranch: e.target.value })}
            className="font-mono"
            required
          />
        </div>
        <div className="grid gap-2">
          <Label>Authentication</Label>
          <Select value={value.authType} onValueChange={(authType) => set({ authType })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Public repository</SelectItem>
              <SelectItem value="token">Access token (HTTPS)</SelectItem>
              <SelectItem value="ssh">SSH deploy key</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {value.authType !== 'none' && (
        <div className="grid gap-2">
          <Label htmlFor="project-credential">{value.authType === 'token' ? 'Access token' : 'Private key'}</Label>
          {value.authType === 'token' ? (
            <Input
              id="project-credential"
              type="password"
              value={value.credential}
              onChange={(e) => set({ credential: e.target.value })}
              placeholder={hasCredential ? '•••••••• (leave empty to keep)' : 'ghp_…'}
              autoComplete="off"
              className="font-mono"
            />
          ) : (
            <Textarea
              id="project-credential"
              value={value.credential}
              onChange={(e) => set({ credential: e.target.value })}
              placeholder={hasCredential ? 'Stored. Paste a new key to replace it.' : '-----BEGIN OPENSSH PRIVATE KEY-----'}
              className="h-32 font-mono text-xs"
            />
          )}
          <p className="text-muted-foreground text-xs">Stored encrypted. Never shown again.</p>
        </div>
      )}
    </div>
  )
}
