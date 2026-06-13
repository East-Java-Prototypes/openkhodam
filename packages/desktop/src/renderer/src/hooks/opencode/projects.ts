import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useOpenCodeRuntime, type createOpenCodeClient } from './client'
import { openCodeQueryKeys } from './sidecar'

type OpenCodeClient = ReturnType<typeof createOpenCodeClient>
type OpenCodeProjectListResponse = Awaited<ReturnType<OpenCodeClient['project']['list']>>
export type OpenCodeProject = NonNullable<OpenCodeProjectListResponse['data']>[number]
type OpenCodeProjectCurrentResponse = Awaited<ReturnType<OpenCodeClient['project']['current']>>
export type OpenCodeCurrentProject = NonNullable<OpenCodeProjectCurrentResponse['data']>

export const openCodeProjectQueryKeys = {
  all: () => [...openCodeQueryKeys.all, 'projects'] as const,
  list: (url: string | null, pid: number | null, updatedAt: number) =>
    [...openCodeQueryKeys.all, 'projects', url, pid, updatedAt] as const,
  current: (directory: string | null | undefined, url: string | null, pid: number | null, updatedAt: number) =>
    [...openCodeQueryKeys.all, 'project', directory, url, pid, updatedAt] as const
}

export function useOpenCodeProjects() {
  const runtime = useOpenCodeRuntime()
  const { status, statusQuery, connection, connectionQuery, client } = runtime
  const queryClient = useQueryClient()

  const projectsQuery = useQuery({
    queryKey: openCodeProjectQueryKeys.list(status.url, status.pid, status.updatedAt),
    queryFn: async (): Promise<OpenCodeProject[]> => {
      const response = await client!.project.list()
      if (response.error) throw response.error
      return response.data ?? []
    },
    enabled: connection !== null
  })

  const openProjectMutation = useMutation({
    mutationFn: async (directory: string): Promise<OpenCodeCurrentProject> => {
      if (connection === null) throw new Error('OpenCode sidecar is not connected.')
      const response = await client!.project.current({ directory })
      if (response.error) throw response.error
      if (!response.data) throw new Error('OpenCode did not return project details.')
      return response.data
    },
    onSuccess: async (project, directory) => {
      queryClient.setQueryData(openCodeProjectQueryKeys.current(directory, status.url, status.pid, status.updatedAt), project)
      await queryClient.invalidateQueries({ queryKey: openCodeProjectQueryKeys.list(status.url, status.pid, status.updatedAt) })
    }
  })

  return {
    runtime,
    status,
    statusQuery,
    connection,
    connectionQuery,
    projectsQuery,
    openProjectMutation,
    openProjectByDirectory: openProjectMutation.mutate
  }
}

export function useOpenCodeProject(directory: string | null | undefined) {
  const { status, statusQuery, connection, connectionQuery, client } = useOpenCodeRuntime()

  const projectQuery = useQuery({
    queryKey: openCodeProjectQueryKeys.current(directory, status.url, status.pid, status.updatedAt),
    queryFn: async (): Promise<OpenCodeCurrentProject> => {
      const response = await client!.project.current({ directory: directory! })
      if (response.error) throw response.error
      if (!response.data) throw new Error('OpenCode did not return project details.')
      return response.data
    },
    enabled: connection !== null && Boolean(directory)
  })

  return {
    status,
    statusQuery,
    connection,
    connectionQuery,
    projectQuery
  }
}
