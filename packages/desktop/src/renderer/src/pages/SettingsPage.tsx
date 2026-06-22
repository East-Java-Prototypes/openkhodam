import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { JSX } from 'react'
import {
  type GoogleWorkspaceIntegrationStatus,
  OpenCodeServerView,
  type OpenCodeConnection,
  type OpenCodeSidecarStatus,
  type RendererHttpHealthSnapshot
} from '@openkhodam/ui'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { openCodeQueryKeys, openCodeSidecarState } from '../hooks/opencode/sidecar'
import { getOpenCodeAuthorizationHeader, useOpenCodeSdk } from '../hooks/opencode/client'

type RendererHttpHealth = RendererHttpHealthSnapshot & {
  updatedAt: number
}

function SettingsPage(): JSX.Element {
  const queryClient = useQueryClient()
  const { status, connectionQuery, connection } = useOpenCodeSdk()
  const googleWorkspaceQuery = useQuery({
    queryKey: ['google-workspace', 'status'],
    queryFn: window.api.getGoogleWorkspaceStatus
  })
  const rendererHttpHealthQuery = useQuery({
    queryKey: ['opencode', 'renderer-http-health', status.updatedAt],
    queryFn: async (): Promise<RendererHttpHealth> => ({
      updatedAt: status.updatedAt,
      ...(await checkRendererHttpHealth(connection!))
    }),
    enabled: Boolean(connection)
  })

  const restartOpenCode = useMutation({
    mutationFn: window.api.restartOpenCode,
    onSuccess: (nextStatus) => {
      queryClient.setQueryData(openCodeQueryKeys.sidecarStatus(), nextStatus)
      void queryClient.invalidateQueries({ queryKey: openCodeQueryKeys.all })
    }
  })

  const connectGoogleWorkspace = useMutation({
    mutationFn: window.api.connectGoogleWorkspace,
    onSuccess: (nextStatus) => {
      queryClient.setQueryData(['google-workspace', 'status'], nextStatus)
    }
  })

  const disconnectGoogleWorkspace = useMutation({
    mutationFn: window.api.disconnectGoogleWorkspace,
    onSuccess: (nextStatus) => {
      queryClient.setQueryData(['google-workspace', 'status'], nextStatus)
    }
  })

  const displayedRendererHttpHealth = getDisplayedRendererHttpHealth(
    status,
    connectionQuery.error,
    rendererHttpHealthQuery.data,
    rendererHttpHealthQuery.error
  )

  return (
    <main>
      <GoogleWorkspaceCard
        status={googleWorkspaceQuery.data}
        isLoading={googleWorkspaceQuery.isLoading}
        error={googleWorkspaceQuery.error}
        isConnecting={connectGoogleWorkspace.isPending}
        isDisconnecting={disconnectGoogleWorkspace.isPending}
        connectError={connectGoogleWorkspace.error}
        disconnectError={disconnectGoogleWorkspace.error}
        onConnect={() => connectGoogleWorkspace.mutateAsync().then(() => undefined)}
        onDisconnect={() => disconnectGoogleWorkspace.mutateAsync().then(() => undefined)}
      />

      <OpenCodeServerView
        status={status}
        connection={connection}
        rendererHttpHealth={displayedRendererHttpHealth}
        rendererOrigin={window.location.origin}
        isRestarting={restartOpenCode.isPending}
        onRestart={() => restartOpenCode.mutateAsync().then(() => undefined)}
      />
    </main>
  )
}

function GoogleWorkspaceCard({
  status,
  isLoading,
  error,
  isConnecting,
  isDisconnecting,
  connectError,
  disconnectError,
  onConnect,
  onDisconnect
}: {
  status: GoogleWorkspaceIntegrationStatus | undefined
  isLoading: boolean
  error: Error | null
  isConnecting: boolean
  isDisconnecting: boolean
  connectError: Error | null
  disconnectError: Error | null
  onConnect: () => void | Promise<void>
  onDisconnect: () => void | Promise<void>
}): JSX.Element {
  const mutationError = connectError ?? disconnectError
  const disabled =
    isLoading || isConnecting || isDisconnecting || status?.state === 'not-configured'

  return (
    <section aria-labelledby="google-workspace-heading">
      <h1 id="google-workspace-heading">Google Workspace</h1>
      <p>{getGoogleWorkspaceSummary(status, isLoading, error)}</p>

      {status?.state === 'connected' ? (
        <dl>
          <dt>Account</dt>
          <dd>{status.account.email ?? status.account.name ?? 'Connected'}</dd>

          <dt>Scopes</dt>
          <dd>
            {status.scopes.length > 0 ? (
              <div>
                {status.scopes.map((scope) => (
                  <Badge key={scope} variant="secondary">
                    {scope}
                  </Badge>
                ))}
              </div>
            ) : (
              'None'
            )}
          </dd>
        </dl>
      ) : null}

      {error ? <p role="alert">Unable to read Google Workspace status: {error.message}</p> : null}
      {mutationError ? (
        <p role="alert">Google Workspace update failed: {mutationError.message}</p>
      ) : null}

      {status?.state === 'connected' ? (
        <Button type="button" onClick={() => void onDisconnect()} disabled={isDisconnecting}>
          {isDisconnecting ? 'Disconnecting' : 'Disconnect'}
        </Button>
      ) : (
        <Button type="button" onClick={() => void onConnect()} disabled={disabled}>
          {isConnecting ? 'Connecting' : 'Connect'}
        </Button>
      )}
    </section>
  )
}

function getGoogleWorkspaceSummary(
  status: GoogleWorkspaceIntegrationStatus | undefined,
  isLoading: boolean,
  error: Error | null
): string {
  if (isLoading) return 'Checking Google Workspace status...'
  if (error) return 'Google Workspace status is unavailable.'
  return status?.message ?? 'Google Workspace status is unavailable.'
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
