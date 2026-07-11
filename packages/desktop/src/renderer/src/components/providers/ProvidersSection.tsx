import { useMemo, useState, type JSX } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { useOpenCodeProviders, type OpenCodeProviderOption } from '@/hooks/useOpenCodeProviders'
import { ProviderConnectDialog } from './ProviderConnectDialog'

const popularProviderIDs = new Set([
  'opencode',
  'opencode-go',
  'anthropic',
  'github-copilot',
  'openai',
  'google',
  'openrouter',
  'vercel'
])

export function ProvidersSection({ directory }: { directory?: string | null }): JSX.Element {
  const providers = useOpenCodeProviders(directory)
  const [connectProviderID, setConnectProviderID] = useState<string | null>(null)
  const [isConnectDialogOpen, setConnectDialogOpen] = useState(false)
  const [isAllProvidersOpen, setAllProvidersOpen] = useState(false)
  const [providerSearch, setProviderSearch] = useState('')

  const connectedProviders = providers.connectedProviders
  const popularProviders = providers.disconnectedProviders.filter((provider) =>
    popularProviderIDs.has(provider.id)
  )
  const allProviders = useMemo(() => {
    const normalizedQuery = providerSearch.trim().toLocaleLowerCase()
    return providers.disconnectedProviders.filter((provider) => {
      if (!normalizedQuery) return true
      return `${provider.name} ${provider.id}`.toLocaleLowerCase().includes(normalizedQuery)
    })
  }, [providerSearch, providers.disconnectedProviders])
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
        <Badge variant="secondary">{connectedProviders.length} connected</Badge>
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

      {!providers.isLoading ? (
        <div className="flex flex-col gap-5">
          <ProviderGroup
            title="Connected providers"
            emptyMessage="No OpenCode providers are connected."
            providers={connectedProviders}
            disconnectingProviderID={disconnectingProviderID}
            onConnect={openConnectDialog}
            onDisconnect={(providerID) => providers.disconnectProviderMutation.mutate(providerID)}
          />
          <ProviderGroup
            title="Popular providers"
            emptyMessage="No popular providers are available in this OpenCode catalog."
            providers={popularProviders}
            disconnectingProviderID={disconnectingProviderID}
            onConnect={openConnectDialog}
            onDisconnect={(providerID) => providers.disconnectProviderMutation.mutate(providerID)}
          />
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
        <Button
          type="button"
          variant="outline"
          aria-expanded={isAllProvidersOpen}
          onClick={() => setAllProvidersOpen((current) => !current)}
        >
          {isAllProvidersOpen ? 'Hide all providers' : 'View all providers'}
        </Button>
      </div>

      {isAllProvidersOpen ? (
        <div className="mt-4 flex flex-col gap-3" aria-label="All OpenCode providers">
          <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor="provider-search">
            Search providers
            <Input
              id="provider-search"
              value={providerSearch}
              onChange={(event) => setProviderSearch(event.currentTarget.value)}
              placeholder="Search provider name or ID"
            />
          </label>
          <ProviderList
            providers={allProviders}
            emptyMessage="No providers match this search."
            disconnectingProviderID={disconnectingProviderID}
            onConnect={openConnectDialog}
            onDisconnect={(providerID) => providers.disconnectProviderMutation.mutate(providerID)}
          />
        </div>
      ) : null}

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

function ProviderGroup({
  title,
  emptyMessage,
  providers,
  disconnectingProviderID,
  onConnect,
  onDisconnect
}: {
  title: string
  emptyMessage: string
  providers: OpenCodeProviderOption[]
  disconnectingProviderID: string | null
  onConnect: (providerID: string) => void
  onDisconnect: (providerID: string) => void
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <ProviderList
        providers={providers}
        emptyMessage={emptyMessage}
        disconnectingProviderID={disconnectingProviderID}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
      />
    </div>
  )
}

function ProviderList({
  providers,
  emptyMessage,
  disconnectingProviderID,
  onConnect,
  onDisconnect
}: {
  providers: OpenCodeProviderOption[]
  emptyMessage: string
  disconnectingProviderID: string | null
  onConnect: (providerID: string) => void
  onDisconnect: (providerID: string) => void
}): JSX.Element {
  if (providers.length === 0) {
    return (
      <p className="text-muted-foreground border border-border bg-background px-3 py-2 text-sm">
        {emptyMessage}
      </p>
    )
  }

  return (
    <div className="divide-y divide-border border border-border" role="list">
      {providers.map((provider) => (
        <ProviderRow
          key={provider.id}
          provider={provider}
          isDisconnecting={disconnectingProviderID === provider.id}
          onConnect={() => onConnect(provider.id)}
          onDisconnect={() => onDisconnect(provider.id)}
        />
      ))}
    </div>
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
      data-provider-id={provider.id}
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
      {provider.connected && provider.canDisconnect ? (
        <Button type="button" variant="outline" onClick={onDisconnect} disabled={isDisconnecting}>
          {isDisconnecting ? 'Disconnecting' : 'Disconnect provider'}
        </Button>
      ) : provider.connected ? (
        <span className="text-muted-foreground text-xs">Managed by environment</span>
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
