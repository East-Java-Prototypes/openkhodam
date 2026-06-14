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
const defaultMessageLimit = 80

export function projectSessionsQueryKey(
  status: { url: string | null; pid: number | null; updatedAt: number },
  directory: string | null | undefined,
  limit = defaultSessionLimit
) {
  return [
    ...openCodeQueryKeys.all,
    'sessions',
    status.url,
    status.pid,
    status.updatedAt,
    directory,
    limit
  ] as const
}

export function openCodeSessionQueryKey(
  status: { url: string | null; pid: number | null; updatedAt: number },
  directory: string | null | undefined,
  sessionID: string | null | undefined
) {
  return [
    ...openCodeQueryKeys.all,
    'session',
    status.url,
    status.pid,
    status.updatedAt,
    directory,
    sessionID
  ] as const
}

export function sessionMessagesQueryKey(
  status: { url: string | null; pid: number | null; updatedAt: number },
  directory: string | null | undefined,
  sessionID: string | null | undefined,
  limit = defaultMessageLimit
) {
  return [
    ...openCodeQueryKeys.all,
    'session-messages',
    status.url,
    status.pid,
    status.updatedAt,
    directory,
    sessionID,
    limit
  ] as const
}

export function useProjectSessions(
  directory: string | null | undefined,
  options: PagedQueryOptions = {}
) {
  const { status, statusQuery, connection, connectionQuery, client } = useOpenCodeSdk()
  const limit = options.limit ?? defaultSessionLimit

  const sessionsQuery = useQuery({
    queryKey: projectSessionsQueryKey(status, directory, limit),
    queryFn: async (): Promise<OpenCodeSession[]> => {
      const response = await client!.session.list({
        directory: directory!,
        limit
      })

      if (response.error) {
        logOpenCodeError('Session list failed', response.error, { directory, limit })
        throw response.error
      }

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

export function useOpenCodeSession(
  directory: string | null | undefined,
  sessionID: string | null | undefined
) {
  const { status, statusQuery, connection, connectionQuery, client } = useOpenCodeSdk()

  const sessionQuery = useQuery({
    queryKey: openCodeSessionQueryKey(status, directory, sessionID),
    queryFn: async (): Promise<OpenCodeSessionDetails | undefined> => {
      const response = await client!.session.get({
        sessionID: sessionID!
      })
      if (response.error) {
        logOpenCodeError('Session details failed', response.error, { directory, sessionID })
        throw response.error
      }
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
      return fetchSessionMessages(client!, directory!, sessionID!, limit)
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

async function fetchSessionMessages(
  client: OpenCodeClient,
  directory: string,
  sessionID: string,
  limit: number
): Promise<OpenCodeSessionMessage[]> {
  const response = await client.session.messages({ directory, sessionID, limit })
  if (response.error) {
    logOpenCodeError('Session messages failed', response.error, { directory, sessionID, limit })
    throw response.error
  }

  const cursor = response.response.headers.get('x-next-cursor') ?? undefined
  if (cursor) {
    console.debug('[opencode] Session messages next cursor', { directory, sessionID, cursor })
  }

  return (response.data ?? [])
    .filter(hasMessageInfoID)
    .sort((a, b) => a.info.id.localeCompare(b.info.id))
}

function hasMessageInfoID(message: OpenCodeSessionMessage): message is OpenCodeSessionMessage & {
  info: { id: string }
} {
  return isRecord(message.info) && typeof message.info.id === 'string' && message.info.id.length > 0
}

function logOpenCodeError(message: string, error: unknown, context: Record<string, unknown>): void {
  console.warn(`[opencode] ${message}`, { ...context, error: formatUnknownError(error) })
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (!isRecord(error)) return String(error)
  const data = isRecord(error.data) ? error.data : null
  const message =
    getString(error, 'message') ??
    getString(data, 'message') ??
    getString(error, '_tag') ??
    getString(error, 'name')
  return message ?? JSON.stringify(error)
}

function getString(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null
  const property = value[key]
  return typeof property === 'string' && property.length > 0 ? property : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
