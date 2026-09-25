import { useQueryClient } from '@tanstack/react-query'
import { Loader2, LogOut, TerminalSquare } from 'lucide-react'
import { NavLink, Outlet } from 'react-router'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { useRunEvents } from '@/hooks/use-run-events'
import { api } from '@/lib/api'
import { keys, useMe } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { LoginPage } from '@/pages/login'

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/runs', label: 'Runs' },
  { to: '/settings', label: 'Settings' },
]

export function Ambient() {
  return <div className="ambient" aria-hidden />
}

// Gates the whole app on a session: no session renders the login screen in place.
export function AppShell() {
  const me = useMe()

  if (me.isPending) {
    return (
      <div className="grid min-h-svh place-items-center">
        <Ambient />
        <Loader2 className="text-muted-foreground size-6 animate-spin" />
      </div>
    )
  }
  if (!me.data) return <LoginPage />
  return <SignedIn />
}

function SignedIn() {
  const queryClient = useQueryClient()
  useRunEvents()

  async function logout() {
    await api.post('/auth/logout')
    queryClient.clear()
    queryClient.setQueryData(keys.me, null)
  }

  return (
    <>
      <Ambient />
      <header className="glass sticky top-0 z-20 border-x-0 border-t-0">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-4 sm:gap-4">
          <NavLink to="/" className="mr-2 flex items-center gap-2 font-semibold tracking-tight">
            <TerminalSquare className="size-5" />
            <span className="hidden sm:inline">BScript</span>
          </NavLink>
          <nav className="flex items-center gap-1">
            {NAV.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-1.5 text-sm transition-colors',
                    isActive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <Button variant="ghost" size="icon" onClick={logout} aria-label="Log out" title="Log out">
              <LogOut />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 pb-16">
        <Outlet />
      </main>
    </>
  )
}
