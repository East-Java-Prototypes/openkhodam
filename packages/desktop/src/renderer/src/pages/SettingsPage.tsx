import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { JSX } from 'react'
import {
  OpenCodeServerView,
  type OpenCodeConnection,
  type OpenCodeSidecarStatus,
  type RendererHttpHealthSnapshot
} from '@openkhodam/ui'
import {
  getDisplayedOpenCodeConnection,
  openCodeQueryKeys,
  openCodeSidecarState,
  useOpenCodeSidecarConnection,
  useOpenCodeSidecarStatus
} from '../hooks/useOpenCodeConnection'
import { getOpenCodeAuthorizationHeader } from '../lib/opencodeClient'

type RendererHttpHealth = RendererHttpHealthSnapshot & {
  updatedAt: number
}

function SettingsPage(): JSX.Element {
  const queryClient = useQueryClient()
  const statusQuery = useOpenCodeSidecarStatus()
  const status = statusQuery.data

  const connectionQuery = useOpenCodeSidecarConnection(status)

  const displayedConnection = getDisplayedOpenCodeConnection(status, connectionQuery.data)
  const rendererHttpHealthQuery = useQuery({
    queryKey: ['opencode', 'renderer-http-health', status.updatedAt],
    queryFn: async (): Promise<RendererHttpHealth> => ({
      updatedAt: status.updatedAt,
      ...(await checkRendererHttpHealth(displayedConnection!))
    }),
    enabled: Boolean(displayedConnection)
  })

  const restartOpenCode = useMutation({
    mutationFn: window.api.restartOpenCode,
    onSuccess: (nextStatus) => {
      queryClient.setQueryData(openCodeQueryKeys.sidecarStatus(), nextStatus)
      void queryClient.invalidateQueries({ queryKey: openCodeQueryKeys.all })
    }
  })

  const displayedRendererHttpHealth = getDisplayedRendererHttpHealth(
    status,
    connectionQuery.error,
    rendererHttpHealthQuery.data,
    rendererHttpHealthQuery.error
  )

  return (
    <OpenCodeServerView
      status={status}
      connection={displayedConnection}
      rendererHttpHealth={displayedRendererHttpHealth}
      rendererOrigin={window.location.origin}
      isRestarting={restartOpenCode.isPending}
      onRestart={() => restartOpenCode.mutateAsync().then(() => undefined)}
    />
  )
}

function getDisplayedRendererHttpHealth(
  status: OpenCodeSidecarStatus,
  connectionError: Error | null,
  rendererHttpHealth: RendererHttpHealth | undefined,
  rendererHttpHealthError: Error | null
): RendererHttpHealthSnapshot {
  if (status.state !== openCodeSidecarState.connected) {
    return { state: 'waiting', statusCode: null, message: 'Waiting for OpenCode.' }
  }

  if (connectionError) {
    return {
      state: 'error',
      statusCode: null,
      message: formatRendererHttpError(connectionError)
    }
  }

  if (rendererHttpHealthError) {
    return {
      state: 'error',
      statusCode: null,
      message: formatRendererHttpError(rendererHttpHealthError)
    }
  }

  if (rendererHttpHealth?.updatedAt !== status.updatedAt) {
    return {
      state: 'checking',
      statusCode: null,
      message: 'Checking OpenCode from the renderer process...'
    }
  }

  return rendererHttpHealth
}

async function checkRendererHttpHealth(
  connection: OpenCodeConnection
): Promise<RendererHttpHealthSnapshot> {
  try {
    const response = await fetch(`${connection.url}/global/health`, {
      headers: {
        authorization: getOpenCodeAuthorizationHeader(connection)
      }
    })
    const body = await readResponseJson(response)

    if (!response.ok) {
      return {
        state: 'error',
        statusCode: response.status,
        message: `OpenCode returned HTTP ${response.status}.`
      }
    }

    if (!body.healthy) {
      return {
        state: 'error',
        statusCode: response.status,
        message: 'OpenCode health check returned unhealthy.'
      }
    }

    return {
      state: 'connected',
      statusCode: response.status,
      message: `OpenCode renderer HTTP health check passed${
        body.version ? ` (${body.version})` : ''
      }.`
    }
  } catch (error) {
    return {
      state: 'error',
      statusCode: null,
      message: formatRendererHttpError(error)
    }
  }
}

async function readResponseJson(
  response: Response
): Promise<{ healthy?: boolean; version?: string }> {
  try {
    return (await response.json()) as { healthy?: boolean; version?: string }
  } catch {
    return {}
  }
}

function formatRendererHttpError(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  if (message.includes('Failed to fetch')) {
    return `${message}. Check that CORS Origins includes ${window.location.origin} and renderer CSP allows the OpenCode endpoint.`
  }

  return message
}

export default SettingsPage
