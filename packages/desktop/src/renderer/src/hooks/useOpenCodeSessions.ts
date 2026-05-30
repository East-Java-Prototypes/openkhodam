import { useQuery } from '@tanstack/react-query'

import { createOpenCodeClient } from '../lib/opencodeClient'
import {
  getDisplayedOpenCodeConnection,
  openCodeQueryKey,
  useOpenCodeConnection,
  useOpenCodeStatus
} from './useOpenCodeConnection'

type OpenCodeClient = ReturnType<typeof createOpenCodeClient>
type OpenCodeSessionListResponse = Awaited<ReturnType<OpenCodeClient['session']['list']>>
type OpenCodeSessionGetResponse = Awaited<ReturnType<OpenCodeClient['session']['get']>>
type OpenCodeSessionMessagesResponse = Awaited<ReturnType<OpenCodeClient['session']['messages']>>

export type OpenCodeSession = NonNullable<OpenCodeSessionListResponse['data']>[number]
export type OpenCodeSessionDetails = NonNullable<OpenCodeSessionGetResponse['data']>
export type OpenCodeSessionMessage = NonNullable<OpenCodeSessionMessagesResponse['data']>[number]

type PagedQueryOptions = {
  limit?: number
}

const defaultSessionLimit = 50
const defaultMessageLimit = 50

export function useProjectSessions(directory: string | null | undefined, options: PagedQueryOptions = {}) {
  const statusQuery = useOpenCodeStatus()
  const connectionQuery = useOpenCodeConnection(statusQuery.data)
  const connection = getDisplayedOpenCodeConnection(statusQuery.data, connectionQuery.data)
  const limit = options.limit ?? defaultSessionLimit

  const sessionsQuery = useQuery({
    queryKey: [
      ...openCodeQueryKey,
      'sessions',
      statusQuery.data.url,
      statusQuery.data.pid,
      statusQuery.data.updatedAt,
      directory,
      limit
    ],
    queryFn: async (): Promise<OpenCodeSession[]> => {
      const response = await createOpenCodeClient(connection!).session.list({
        directory: directory!,
        roots: true,
        limit
      })
      if (response.error) throw response.error
      return response.data ?? []
    },
    enabled: connection !== null && Boolean(directory)
  })

  return {
    status: statusQuery.data,
    statusQuery,
    connection,
    connectionQuery,
    sessionsQuery
  }
}

export function useOpenCodeSession(directory: string | null | undefined, sessionID: string | null | undefined) {
  const statusQuery = useOpenCodeStatus()
  const connectionQuery = useOpenCodeConnection(statusQuery.data)
  const connection = getDisplayedOpenCodeConnection(statusQuery.data, connectionQuery.data)

  const sessionQuery = useQuery({
    queryKey: [
      ...openCodeQueryKey,
      'session',
      statusQuery.data.url,
      statusQuery.data.pid,
      statusQuery.data.updatedAt,
      directory,
      sessionID
    ],
    queryFn: async (): Promise<OpenCodeSessionDetails | undefined> => {
      const response = await createOpenCodeClient(connection!).session.get({
        directory: directory!,
        sessionID: sessionID!
      })
      if (response.error) throw response.error
      return response.data
    },
    enabled: connection !== null && Boolean(directory) && Boolean(sessionID)
  })

  return {
    status: statusQuery.data,
    statusQuery,
    connection,
    connectionQuery,
    sessionQuery
  }
}

export function useSessionMessages(
  directory: string | null | undefined,
  sessionID: string | null | undefined,
  options: PagedQueryOptions = {}
) {
  const statusQuery = useOpenCodeStatus()
  const connectionQuery = useOpenCodeConnection(statusQuery.data)
  const connection = getDisplayedOpenCodeConnection(statusQuery.data, connectionQuery.data)
  const limit = options.limit ?? defaultMessageLimit

  const messagesQuery = useQuery({
    queryKey: [
      ...openCodeQueryKey,
      'session-messages',
      statusQuery.data.url,
      statusQuery.data.pid,
      statusQuery.data.updatedAt,
      directory,
      sessionID,
      limit
    ],
    queryFn: async (): Promise<OpenCodeSessionMessage[]> => {
      const response = await createOpenCodeClient(connection!).session.messages({
        directory: directory!,
        sessionID: sessionID!,
        limit
      })
      if (response.error) throw response.error
      return response.data ?? []
    },
    enabled: connection !== null && Boolean(directory) && Boolean(sessionID)
  })

  return {
    status: statusQuery.data,
    statusQuery,
    connection,
    connectionQuery,
    messagesQuery
  }
}
