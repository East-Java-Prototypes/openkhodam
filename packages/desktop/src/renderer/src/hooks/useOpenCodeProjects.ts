import { useQuery } from '@tanstack/react-query'

import { openCodeQueryKeys } from './opencode/sidecar'
import { createOpenCodeClient, useOpenCodeSdk } from './opencode/client'

type OpenCodeClient = ReturnType<typeof createOpenCodeClient>
type OpenCodeProjectListResponse = Awaited<ReturnType<OpenCodeClient['project']['list']>>
export type OpenCodeProject = NonNullable<OpenCodeProjectListResponse['data']>[number]

export function useOpenCodeProjects() {
  const { status, statusQuery, connection, connectionQuery, client } = useOpenCodeSdk()

  const projectsQuery = useQuery({
    queryKey: [...openCodeQueryKeys.all, 'projects', status.url, status.pid, status.updatedAt],
    queryFn: async (): Promise<OpenCodeProject[]> => {
      const response = await client!.project.list()
      if (response.error) throw response.error
      return response.data ?? []
    },
    enabled: client !== null
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
    queryKey: [...openCodeQueryKeys.all, 'project', directory, status.url, status.pid, status.updatedAt],
    queryFn: async () => {
      const response = await client!.project.current({ directory: directory! })
      if (response.error) throw response.error
      return response.data
    },
    enabled: client !== null && Boolean(directory)
  })

  return {
    status,
    statusQuery,
    connection,
    connectionQuery,
    projectQuery
  }
}
