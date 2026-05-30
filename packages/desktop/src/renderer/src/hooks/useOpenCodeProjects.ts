import { useQuery } from '@tanstack/react-query'

import { createOpenCodeClient } from '../lib/opencodeClient'
import {
  getDisplayedOpenCodeConnection,
  openCodeQueryKey,
  useOpenCodeConnection,
  useOpenCodeStatus
} from './useOpenCodeConnection'

type OpenCodeClient = ReturnType<typeof createOpenCodeClient>
type OpenCodeProjectListResponse = Awaited<ReturnType<OpenCodeClient['project']['list']>>
export type OpenCodeProject = NonNullable<OpenCodeProjectListResponse['data']>[number]

export function useOpenCodeProjects() {
  const statusQuery = useOpenCodeStatus()
  const connectionQuery = useOpenCodeConnection(statusQuery.data)
  const connection = getDisplayedOpenCodeConnection(statusQuery.data, connectionQuery.data)

  const projectsQuery = useQuery({
    queryKey: [...openCodeQueryKey, 'projects', statusQuery.data.url, statusQuery.data.pid, statusQuery.data.updatedAt],
    queryFn: async (): Promise<OpenCodeProject[]> => {
      const response = await createOpenCodeClient(connection!).project.list()
      if (response.error) throw response.error
      return response.data ?? []
    },
    enabled: connection !== null
  })

  return {
    status: statusQuery.data,
    statusQuery,
    connection,
    connectionQuery,
    projectsQuery
  }
}

export function useOpenCodeProject(directory: string | null | undefined) {
  const statusQuery = useOpenCodeStatus()
  const connectionQuery = useOpenCodeConnection(statusQuery.data)
  const connection = getDisplayedOpenCodeConnection(statusQuery.data, connectionQuery.data)

  const projectQuery = useQuery({
    queryKey: [
      ...openCodeQueryKey,
      'project',
      directory,
      statusQuery.data.url,
      statusQuery.data.pid,
      statusQuery.data.updatedAt
    ],
    queryFn: async () => {
      const response = await createOpenCodeClient(connection!).project.current({ directory: directory! })
      if (response.error) throw response.error
      return response.data
    },
    enabled: connection !== null && Boolean(directory)
  })

  return {
    status: statusQuery.data,
    statusQuery,
    connection,
    connectionQuery,
    projectQuery
  }
}
