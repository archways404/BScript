import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export const keys = {
  me: ['me'],
  projects: ['projects'],
  project: (id) => ['projects', id],
  pipelines: (projectId) => ['projects', projectId, 'pipelines'],
  scripts: (projectId, ref) => ['projects', projectId, 'scripts', ref ?? ''],
  webhook: (projectId) => ['projects', projectId, 'webhook'],
  pipeline: (id) => ['pipelines', id],
  env: (scope, id) => ['env', scope, id],
  runs: (filters = {}) => ['runs', 'list', filters],
  run: (id) => ['runs', 'detail', id],
  tokens: ['tokens'],
}

function toQuery(params) {
  const search = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''))
  return search.size ? `?${search}` : ''
}

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      const me = await api.get('/auth/me')
      return me.via ? me : null
    },
    staleTime: Infinity,
  })
}

export const useProjects = () => useQuery({ queryKey: keys.projects, queryFn: () => api.get('/projects') })
export const useProject = (id) => useQuery({ queryKey: keys.project(id), queryFn: () => api.get(`/projects/${id}`) })
export const usePipelines = (projectId) =>
  useQuery({ queryKey: keys.pipelines(projectId), queryFn: () => api.get(`/projects/${projectId}/pipelines`) })
export const usePipeline = (id) => useQuery({ queryKey: keys.pipeline(id), queryFn: () => api.get(`/pipelines/${id}`) })
export const useWebhook = (projectId, enabled) =>
  useQuery({ queryKey: keys.webhook(projectId), queryFn: () => api.get(`/projects/${projectId}/webhook`), enabled })
export const useTokens = () => useQuery({ queryKey: keys.tokens, queryFn: () => api.get('/tokens') })

export function useEnv(scope, id) {
  return useQuery({ queryKey: keys.env(scope, id), queryFn: () => api.get(`/${scope}s/${id}/env`) })
}

export function useScripts(projectId, ref) {
  return useQuery({
    queryKey: keys.scripts(projectId, ref),
    queryFn: () => api.get(`/projects/${projectId}/scripts${toQuery({ ref })}`),
    staleTime: 30_000,
    retry: false,
  })
}

export function useRuns(filters = {}) {
  return useQuery({ queryKey: keys.runs(filters), queryFn: () => api.get(`/runs${toQuery(filters)}`) })
}

export const useRun = (id) => useQuery({ queryKey: keys.run(id), queryFn: () => api.get(`/runs/${id}`) })
