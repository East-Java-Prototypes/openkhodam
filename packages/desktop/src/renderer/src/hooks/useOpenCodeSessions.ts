import { useQuery } from '@tanstack/react-query'

import { useOpenCodeSdk, type createOpenCodeClient } from './opencode/client'
import { openCodeQueryKeys } from './opencode/sidecar'

type OpenCodeClient = ReturnType<typeof createOpenCodeClient>
type OpenCodeSessionListResponse = Awaited<ReturnType<OpenCodeClient['session']['list']>>
type OpenCodeV2SessionListResponse = Awaited<ReturnType<OpenCodeClient['v2']['session']['list']>>
type OpenCodeSessionGetResponse = Awaited<ReturnType<OpenCodeClient['session']['get']>>
type OpenCodeSessionMessagesResponse = Awaited<ReturnType<OpenCodeClient['session']['messages']>>

type OpenCodeLegacySession = NonNullable<OpenCodeSessionListResponse['data']>[number]
type OpenCodeV2Session = NonNullable<
  NonNullable<OpenCodeV2SessionListResponse['data']>['items']
>[number]

export type OpenCodeSession = OpenCodeLegacySession | OpenCodeV2Session
export type OpenCodeSessionDetails = NonNullable<OpenCodeSessionGetResponse['data']>
export type OpenCodeSessionMessage = NonNullable<OpenCodeSessionMessagesResponse['data']>[number]

type PagedQueryOptions = {
  limit?: number
}

const defaultSessionLimit = 50
const defaultMessageLimit = 50

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
      const legacyResponse = await client!.session.list({
        directory: directory!,
        roots: true,
        limit
      })
      const v2Response = await client!.v2.session.list({
        directory: directory!,
        roots: true,
        limit,
        order: 'desc'
      })

      if (legacyResponse.error)
        logOpenCodeError('Legacy session list failed', legacyResponse.error, { directory, limit })
      if (v2Response.error)
        logOpenCodeError('V2 session list failed', v2Response.error, { directory, limit })
      if (legacyResponse.error && v2Response.error) throw legacyResponse.error

      return mergeSessions(legacyResponse.data ?? [], v2Response.data?.items ?? [])
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
        directory: directory!,
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
  if (!response.error) return response.data ?? []

  logOpenCodeError('Session messages failed; retrying smaller pages', response.error, {
    directory,
    sessionID,
    limit
  })

  const fallback = await findLargestReadableMessagePage(client, directory, sessionID, limit - 1)
  if (fallback !== null) {
    console.warn(
      '[opencode] Session messages loaded with a smaller page after an OpenCode read error.',
      {
        directory,
        sessionID,
        requestedLimit: limit,
        loadedCount: fallback.length
      }
    )
    return fallback
  }

  throw response.error
}

async function findLargestReadableMessagePage(
  client: OpenCodeClient,
  directory: string,
  sessionID: string,
  maxLimit: number
): Promise<OpenCodeSessionMessage[] | null> {
  let low = 1
  let high = Math.max(0, maxLimit)
  let best: OpenCodeSessionMessage[] | null = null

  while (low <= high) {
    const limit = Math.ceil((low + high) / 2)
    const response = await client.session.messages({ directory, sessionID, limit })

    if (response.error) {
      high = limit - 1
      continue
    }

    best = response.data ?? []
    low = limit + 1
  }

  return best
}

function mergeSessions(
  legacySessions: OpenCodeLegacySession[],
  v2Sessions: OpenCodeV2Session[]
): OpenCodeSession[] {
  const sessions: OpenCodeSession[] = []
  const seen = new Set<string>()

  for (const session of [...legacySessions, ...v2Sessions]) {
    const id = getSessionId(session)
    if (!id || seen.has(id)) continue
    seen.add(id)
    sessions.push(session)
  }

  return sessions
}

function getSessionId(session: OpenCodeSession): string | null {
  if (typeof session !== 'object' || session === null) return null
  const value =
    (session as Record<string, unknown>).id ?? (session as Record<string, unknown>).sessionID
  return typeof value === 'string' && value.length > 0 ? value : null
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
