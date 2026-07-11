import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSyncExternalStore, type JSX } from 'react'
import {
  type GoogleWorkspaceIntegrationStatus,
  OpenCodeServerView,
  type OpenCodeConnection,
  type OpenCodeSidecarStatus,
  type RendererHttpHealthSnapshot
} from '@openkhodam/ui'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { ScrollArea } from '../components/ui/scroll-area'
import { Separator } from '../components/ui/separator'
import { ProvidersSection } from '../components/providers/ProvidersSection'
import { openCodeQueryKeys, openCodeSidecarState } from '../hooks/opencode/sidecar'
import { getOpenCodeAuthorizationHeader, useOpenCodeSdk } from '../hooks/opencode/client'
import { getThemeMode, setThemeMode, subscribeToTheme, type ThemeMode } from '../theme'

type RendererHttpHealth = RendererHttpHealthSnapshot & {
  updatedAt: number
}

function SettingsPage(): JSX.Element {
  const queryClient = useQueryClient()
  const { status, connectionQuery, connection } = useOpenCodeSdk()
  const themeMode = useSyncExternalStore(subscribeToTheme, getThemeMode, getThemeMode)
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

  const cancelGoogleWorkspaceConnect = useMutation({
    mutationFn: window.api.cancelGoogleWorkspaceConnect,
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
    <section
      className="flex min-h-0 min-w-0 flex-col overflow-hidden"
      aria-labelledby="settings-heading"
    >
      <header className="shrink-0 px-6 py-4">
        <p className="text-muted-foreground text-sm">Settings</p>
        <h1 id="settings-heading" className="text-xl font-semibold tracking-tight">
          Connections and services
        </h1>
      </header>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6 lg:p-8">
          <AppearanceCard mode={themeMode} onModeChange={setThemeMode} />

          <GoogleWorkspaceCard
            status={googleWorkspaceQuery.data}
            isLoading={googleWorkspaceQuery.isLoading}
            error={googleWorkspaceQuery.error}
            isConnecting={connectGoogleWorkspace.isPending}
            isCancelling={cancelGoogleWorkspaceConnect.isPending}
            isDisconnecting={disconnectGoogleWorkspace.isPending}
            connectError={connectGoogleWorkspace.error}
            disconnectError={disconnectGoogleWorkspace.error}
            onConnect={() => connectGoogleWorkspace.mutate()}
            onCancel={() => cancelGoogleWorkspaceConnect.mutate()}
            onDisconnect={() => disconnectGoogleWorkspace.mutate()}
          />

          <ProvidersSection />

          <OpenCodeServerView
            status={status}
            connection={connection}
            rendererHttpHealth={displayedRendererHttpHealth}
            rendererOrigin={window.location.origin}
            isRestarting={restartOpenCode.isPending}
            onRestart={() => restartOpenCode.mutateAsync().then(() => undefined)}
          />
        </div>
      </ScrollArea>
    </section>
  )
}

function AppearanceCard({
  mode,
  onModeChange
}: {
  mode: ThemeMode
  onModeChange: (mode: ThemeMode) => void
}): JSX.Element {
  const choices: { mode: ThemeMode; label: string }[] = [
    { mode: 'system', label: 'System' },
    { mode: 'light', label: 'Light' },
    { mode: 'dark', label: 'Dark' }
  ]

  return (
    <section
      className="border bg-card p-4 text-card-foreground shadow-sm"
      aria-labelledby="appearance-heading"
    >
      <div className="space-y-1">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          Appearance
        </p>
        <h2 id="appearance-heading" className="text-lg font-semibold tracking-tight">
          Theme
        </h2>
        <p className="text-muted-foreground text-sm">Choose how OpenKhodam looks on this device.</p>
      </div>
      <div className="mt-4 flex flex-wrap gap-2" aria-label="Appearance mode">
        {choices.map((choice) => (
          <Button
            key={choice.mode}
            type="button"
            variant={mode === choice.mode ? 'default' : 'outline'}
            aria-pressed={mode === choice.mode}
            onClick={() => onModeChange(choice.mode)}
          >
            {choice.label}
          </Button>
        ))}
      </div>
    </section>
  )
}

function GoogleWorkspaceCard({
  status,
  isLoading,
  error,
  isConnecting,
  isCancelling,
  isDisconnecting,
  connectError,
  disconnectError,
  onConnect,
  onCancel,
  onDisconnect
}: {
  status: GoogleWorkspaceIntegrationStatus | undefined
  isLoading: boolean
  error: Error | null
  isConnecting: boolean
  isCancelling: boolean
  isDisconnecting: boolean
  connectError: Error | null
  disconnectError: Error | null
  onConnect: () => void
  onCancel: () => void
  onDisconnect: () => void
}): JSX.Element {
  const mutationError = connectError ?? disconnectError
  const summary = getGoogleWorkspaceSummary(status, isLoading, error)
  const statusLabel = getGoogleWorkspaceStatusLabel(status, isLoading, error)
  const disabled =
    isLoading || isConnecting || isDisconnecting || status?.state === 'not-configured'

  return (
    <section
      className="border bg-card p-4 text-card-foreground shadow-sm"
      aria-labelledby="google-workspace-heading"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Integration
          </p>
          <h2 id="google-workspace-heading" className="text-lg font-semibold tracking-tight">
            Google Workspace
          </h2>
          <p className="text-muted-foreground max-w-2xl text-sm">{summary}</p>
        </div>
        <Badge variant={status?.state === 'connected' ? 'default' : 'secondary'}>
          {statusLabel}
        </Badge>
      </div>

      <Separator className="my-4" />

      {status?.state === 'connected' ? (
        <dl className="grid gap-3 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
          <dt className="text-muted-foreground font-medium">Account</dt>
          <dd className="min-w-0 break-words">
            {status.account.email ?? status.account.name ?? 'Connected'}
          </dd>

          <dt className="text-muted-foreground font-medium">Scopes</dt>
          <dd className="min-w-0">
            {status.scopes.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
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

      {error ? (
        <p
          className="mt-4 border border-destructive px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          Unable to read Google Workspace status: {error.message}
        </p>
      ) : null}
      {mutationError ? (
        <p
          className="mt-4 border border-destructive px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          Google Workspace update failed: {mutationError.message}
        </p>
      ) : null}

      {isConnecting ? (
        <p className="mt-4 border border-border bg-background px-3 py-2 text-sm" role="status">
          Waiting for the Google Workspace sign-in to finish.
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {status?.state === 'connected' ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => onDisconnect()}
            disabled={isDisconnecting}
          >
            {isDisconnecting ? 'Disconnecting' : 'Disconnect'}
          </Button>
        ) : (
          <>
            <Button type="button" onClick={() => onConnect()} disabled={disabled}>
              {isConnecting ? 'Connecting' : 'Connect'}
            </Button>
            {isConnecting ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => onCancel()}
                disabled={isCancelling}
              >
                {isCancelling ? 'Cancelling' : 'Cancel'}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}

function getGoogleWorkspaceStatusLabel(
  status: GoogleWorkspaceIntegrationStatus | undefined,
  isLoading: boolean,
  error: Error | null
): string {
  if (isLoading) return 'Checking'
  if (error) return 'Unavailable'

  switch (status?.state) {
    case 'connected':
      return 'Connected'
    case 'disconnected':
      return 'Disconnected'
    case 'not-configured':
      return 'Not configured'
    default:
      return 'Unavailable'
  }
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
