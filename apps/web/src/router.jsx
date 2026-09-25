import { createBrowserRouter } from 'react-router'
import { AppShell } from '@/components/app-shell'
import { DashboardPage } from '@/pages/dashboard'
import { NotFoundPage } from '@/pages/not-found'
import { PipelinePage } from '@/pages/pipeline'
import { ProjectPage } from '@/pages/project'
import { RegistryPage } from '@/pages/registry'
import { RunPage } from '@/pages/run'
import { RunsPage } from '@/pages/runs'
import { SettingsPage } from '@/pages/settings'

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/projects/:projectId', element: <ProjectPage /> },
      { path: '/projects/:projectId/:tab', element: <ProjectPage /> },
      { path: '/pipelines/:pipelineId', element: <PipelinePage /> },
      { path: '/runs', element: <RunsPage /> },
      { path: '/runs/:runId', element: <RunPage /> },
      { path: '/registry', element: <RegistryPage /> },
      { path: '/registry/:tab', element: <RegistryPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
