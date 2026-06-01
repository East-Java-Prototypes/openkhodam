import { useQuery } from '@tanstack/react-query'

import { useOpenCodeSdk, type createOpenCodeClient } from './opencode/client'
import { openCodeQueryKeys } from './opencode/sidecar'

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

export function projectSessionsQueryKey(status: { url: string | null; pid: number | null; updatedAt: number }, directory: string | null | undefined, limit = defaultSessionLimit) {
  return [...openCodeQueryKeys.all, 'sessions', status.url, status.pid, status.updatedAt, directory, limit] as const
}

export function openCodeSessionQueryKey(status: { url: string | null; pid: number | null; updatedAt: number }, directory: string | null | undefined, sessionID: string | null | undefined) {
  return [...openCodeQueryKeys.all, 'session', status.url, status.pid, status.updatedAt, directory, sessionID] as const
}

export function sessionMessagesQueryKey(status: { url: string | null; pid: number | null; updatedAt: number }, directory: string | null | undefined, sessionID: string | null | undefined, limit = defaultMessageLimit) {
  return [...openCodeQueryKeys.all, 'session-messages', status.url, status.pid, status.updatedAt, directory, sessionID, limit] as const
}

export function useProjectSessions(directory: string | null | undefined, options: PagedQueryOptions = {}) {
  const { status, statusQuery, connection, connectionQuery, client } = useOpenCodeSdk()
  const limit = options.limit ?? defaultSessionLimit

  const sessionsQuery = useQuery({
    queryKey: projectSessionsQueryKey(status, directory, limit),
    queryFn: async (): Promise<OpenCodeSession[]> => {
      const response = await client!.session.list({
        directory: directory!,
        roots: true,
        limit
      })
      if (response.error) throw response.error
      return response.data ?? []
    },
    enabled: client !== null && Boolean(directory)
  })

  return {
    status,
    statusQuery,
    connection,
    connectionQuery,
    sessionsQuery
  }
}

export function useOpenCodeSession(directory: string | null | undefined, sessionID: string | null | undefined) {
  const { status, statusQuery, connection, connectionQuery, client } = useOpenCodeSdk()

  const sessionQuery = useQuery({
    queryKey: openCodeSessionQueryKey(status, directory, sessionID),
    queryFn: async (): Promise<OpenCodeSessionDetails | undefined> => {
      const response = await client!.session.get({
        directory: directory!,
        sessionID: sessionID!
      })
      if (response.error) throw response.error
      return response.data
    },
    enabled: client !== null && Boolean(directory) && Boolean(sessionID)
  })

  return {
    status,
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
  const { status, statusQuery, connection, connectionQuery, client } = useOpenCodeSdk()
  const limit = options.limit ?? defaultMessageLimit

  const messagesQuery = useQuery({
    queryKey: sessionMessagesQueryKey(status, directory, sessionID, limit),
    queryFn: async (): Promise<OpenCodeSessionMessage[]> => {
      const response = await client!.session.messages({
        directory: directory!,
        sessionID: sessionID!,
        limit
      })
      if (response.error) throw response.error
      return response.data ?? []
    },
    enabled: client !== null && Boolean(directory) && Boolean(sessionID)
  })

  return {
    status,
    statusQuery,
    connection,
    connectionQuery,
    messagesQuery
  }
}
