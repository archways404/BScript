import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'bscript-theme'
const listeners = new Set()

function current() {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

// The theme lives on <html class="dark"> (set before paint in index.html); this store lets
// every component that cares re-render when it changes.
export function setTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // storage can be unavailable (private mode); the theme still applies for this session
  }
  for (const listener of listeners) listener()
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, current)
  return { theme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') }
}
