import { useQuery } from '@tanstack/react-query'

import { useOpenCodeSdk, type createOpenCodeClient } from './client'
import { openCodeQueryKeys } from './sidecar'

type OpenCodeClient = ReturnType<typeof createOpenCodeClient>
type OpenCodeProjectListResponse = Awaited<ReturnType<OpenCodeClient['project']['list']>>
export type OpenCodeProject = NonNullable<OpenCodeProjectListResponse['data']>[number]

export const openCodeProjectQueryKeys = {
  all: () => [...openCodeQueryKeys.all, 'projects'] as const,
  list: (url: string | null, pid: number | null, updatedAt: number) =>
    [...openCodeQueryKeys.all, 'projects', url, pid, updatedAt] as const,
  current: (directory: string | null | undefined, url: string | null, pid: number | null, updatedAt: number) =>
    [...openCodeQueryKeys.all, 'project', directory, url, pid, updatedAt] as const
}

export function useOpenCodeProjects() {
  const { status, statusQuery, connection, connectionQuery, client } = useOpenCodeSdk()

  const projectsQuery = useQuery({
    queryKey: openCodeProjectQueryKeys.list(status.url, status.pid, status.updatedAt),
    queryFn: async (): Promise<OpenCodeProject[]> => {
      const response = await client!.project.list()
      if (response.error) throw response.error
      return response.data ?? []
    },
    enabled: connection !== null
  })

  return {
    status,
    statusQuery,
    connection,
    connectionQuery,
    projectsQuery
  }
}

export function useOpenCodeProject(directory: string | null | undefined) {
  const { status, statusQuery, connection, connectionQuery, client } = useOpenCodeSdk()

  const projectQuery = useQuery({
    queryKey: openCodeProjectQueryKeys.current(directory, status.url, status.pid, status.updatedAt),
    queryFn: async () => {
      const response = await client!.project.current({ directory: directory! })
      if (response.error) throw response.error
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
