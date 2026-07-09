import { useState, type JSX } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useOpenCodeProviders, type OpenCodeProviderOption } from '@/hooks/useOpenCodeProviders'
import { ProviderConnectDialog } from './ProviderConnectDialog'

export function ProvidersSection({ directory }: { directory?: string | null }): JSX.Element {
  const providers = useOpenCodeProviders(directory)
  const [connectProviderID, setConnectProviderID] = useState<string | null>(null)
  const [isConnectDialogOpen, setConnectDialogOpen] = useState(false)

  const sortedProviders = [...providers.connectedProviders, ...providers.disconnectedProviders]
  const hasProviders = sortedProviders.length > 0
  const disconnectingProviderID = providers.disconnectProviderMutation.isPending
    ? (providers.disconnectProviderMutation.variables ?? null)
    : null

  function openConnectDialog(providerID?: string): void {
    setConnectProviderID(providerID ?? null)
    setConnectDialogOpen(true)
  }

  return (
    <section
      className="border bg-card p-4 text-card-foreground shadow-sm"
      aria-labelledby="opencode-providers-heading"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            OpenCode
          </p>
          <h2 id="opencode-providers-heading" className="text-lg font-semibold tracking-tight">
            Providers
          </h2>
          <p className="text-muted-foreground max-w-2xl text-sm">
            Connect model providers through OpenCode. Credentials remain in OpenCode, while
            OpenKhodam only reads provider and model availability.
          </p>
          <p className="text-muted-foreground max-w-2xl text-xs">
            Scope: {directory ? directory : 'OpenCode default provider scope'}
          </p>
        </div>
        <Badge variant="secondary">{providers.connectedProviders.length} connected</Badge>
      </div>

      <Separator className="my-4" />

      {providers.errorMessage ? (
        <p className="border border-destructive px-3 py-2 text-sm text-destructive" role="alert">
          Unable to read OpenCode providers: {providers.errorMessage}
        </p>
      ) : null}

      {providers.isLoading ? (
        <p className="border border-border bg-background px-3 py-2 text-sm" role="status">
          Loading OpenCode providers…
        </p>
      ) : null}

      {!providers.isLoading && !hasProviders ? (
        <p className="border border-border bg-background px-3 py-2 text-sm" role="status">
          No OpenCode providers were returned by the sidecar.
        </p>
      ) : null}

      {hasProviders ? (
        <div className="divide-y divide-border border border-border" role="list">
          {sortedProviders.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              isDisconnecting={disconnectingProviderID === provider.id}
              onConnect={() => openConnectDialog(provider.id)}
              onDisconnect={() => providers.disconnectProviderMutation.mutate(provider.id)}
            />
          ))}
        </div>
      ) : null}

      {providers.disconnectProviderMutation.error ? (
        <p
          className="mt-4 border border-destructive px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          Provider disconnect failed:{' '}
          {formatUnknownError(providers.disconnectProviderMutation.error)}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => openConnectDialog()}>
          Connect provider
        </Button>
      </div>

      {isConnectDialogOpen ? (
        <ProviderConnectDialog
          open={isConnectDialogOpen}
          onOpenChange={setConnectDialogOpen}
          directory={directory}
          initialProviderID={connectProviderID}
        />
      ) : null}
    </section>
  )
}

function ProviderRow({
  provider,
  isDisconnecting,
  onConnect,
  onDisconnect
}: {
  provider: OpenCodeProviderOption
  isDisconnecting: boolean
  onConnect: () => void
  onDisconnect: () => void
}): JSX.Element {
  const modelText = `${provider.modelCount} model${provider.modelCount === 1 ? '' : 's'}`
  return (
    <div
      className="flex flex-col gap-3 bg-background px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
      role="listitem"
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{provider.name}</span>
          <Badge variant={provider.connected ? 'default' : 'secondary'}>
            {provider.connected ? 'Connected' : 'Disconnected'}
          </Badge>
          {provider.source ? <Badge variant="secondary">{provider.source}</Badge> : null}
        </div>
        <p className="text-muted-foreground text-xs">
          {provider.id} · {modelText}
        </p>
      </div>
      {provider.connected ? (
        <Button type="button" variant="outline" onClick={onDisconnect} disabled={isDisconnecting}>
          {isDisconnecting ? 'Disconnecting' : 'Disconnect provider'}
        </Button>
      ) : (
        <Button type="button" onClick={onConnect}>
          Connect provider
        </Button>
      )}
    </div>
  )
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown provider error.'
}
