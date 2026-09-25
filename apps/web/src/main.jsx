import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ApiError } from '@/lib/api'
import { keys } from '@/lib/queries'
import { router } from './router'
import './index.css'

// A 401 from any request means the session is gone: drop back to the login screen.
function handleError(err) {
  if (err instanceof ApiError && err.status === 401) queryClient.setQueryData(keys.me, null)
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleError }),
  mutationCache: new MutationCache({
    onError: (err) => {
      handleError(err)
      if (!(err instanceof ApiError && err.status === 401)) toast.error(err.message)
    },
  }),
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
)
