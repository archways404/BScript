import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export const keys = {
  me: ['me'],
  projects: ['projects'],
  project: (id) => ['projects', id],
  pipelines: (projectId) => ['projects', projectId, 'pipelines'],
  scripts: (projectId, ref) => ['projects', projectId, 'scripts', ref ?? ''],
  webhook: (projectId) => ['projects', projectId, 'webhook'],
  environments: (projectId) => ['projects', projectId, 'environments'],
  requirements: (projectId) => ['requirements', projectId],
  pipeline: (id) => ['pipelines', id],
  env: (scope, id) => ['env', scope, id],
  runs: (filters = {}) => ['runs', 'list', filters],
  run: (id) => ['runs', 'detail', id],
  tokens: ['tokens'],
  registry: ['registry'],
  registryTags: (repository) => ['registry', 'tags', repository],
  cleanups: ['registry', 'cleanups'],
  cleanupPreview: ['registry', 'preview'],
  externalRegistries: ['registries'],
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

const RUN_PAGE = 50

// Runs newest first, 50 at a time; fetchNextPage() loads older ones.
export function useRunPages(filters = {}) {
  return useInfiniteQuery({
    queryKey: keys.runs({ ...filters, paged: true }),
    queryFn: ({ pageParam }) => api.get(`/runs${toQuery({ ...filters, limit: RUN_PAGE, before: pageParam })}`),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => (lastPage.length === RUN_PAGE ? lastPage.at(-1).id : undefined),
  })
}

export const useRun = (id) => useQuery({ queryKey: keys.run(id), queryFn: () => api.get(`/runs/${id}`) })

export const useEnvironments = (projectId) =>
  useQuery({ queryKey: keys.environments(projectId), queryFn: () => api.get(`/projects/${projectId}/environments`) })

// Env vars the given steps need. Keyed on the script list so unsaved edits are checked too.
export function useRequirements(projectId, pipelineId, steps) {
  const scripts = steps.map((s) => ({ name: s.name || s.scriptPath, scriptPath: s.scriptPath }))
  return useQuery({
    queryKey: [...keys.requirements(projectId), pipelineId, scripts],
    queryFn: () => api.post(`/projects/${projectId}/requirements`, { pipelineId, steps: scripts }),
    enabled: scripts.length > 0,
    placeholderData: (previous) => previous,
    staleTime: 10_000,
    retry: false,
  })
}

const BUSY_STATES = new Set(['starting', 'maintenance', 'crashed'])

export function useRegistry() {
  return useQuery({
    queryKey: keys.registry,
    queryFn: () => api.get('/registry'),
    refetchInterval: (query) => (query.state.data && (query.state.data.cleanupRunning || BUSY_STATES.has(query.state.data.state)) ? 2000 : false),
  })
}

export const useRegistryTags = (repository, enabled = true) =>
  useQuery({ queryKey: keys.registryTags(repository), queryFn: () => api.get(`/registry/tags?repository=${encodeURIComponent(repository)}`), enabled })

export function useCleanups() {
  return useQuery({
    queryKey: keys.cleanups,
    queryFn: () => api.get('/registry/cleanups'),
    refetchInterval: (query) => (query.state.data?.[0]?.status === 'running' ? 2000 : false),
  })
}

export const useCleanupPreview = (enabled) =>
  useQuery({ queryKey: keys.cleanupPreview, queryFn: () => api.get('/registry/cleanup/preview'), enabled })

export const useExternalRegistries = () => useQuery({ queryKey: keys.externalRegistries, queryFn: () => api.get('/registries') })
