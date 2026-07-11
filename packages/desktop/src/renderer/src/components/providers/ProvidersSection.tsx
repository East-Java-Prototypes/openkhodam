import { useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { useOpenCodeProviders, type OpenCodeProviderOption } from '@/hooks/useOpenCodeProviders'
import { ProviderConnectDialog } from './ProviderConnectDialog'

export function ProvidersSection({
  directory,
  focusOnMount = false
}: {
  directory?: string | null
  focusOnMount?: boolean
}): JSX.Element {
  const providers = useOpenCodeProviders(directory)
  const [connectProviderID, setConnectProviderID] = useState<string | null>(null)
  const [providerSearch, setProviderSearch] = useState('')
  const sectionRef = useRef<HTMLElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const hasFocusedRef = useRef(false)

  useLayoutEffect(() => {
    if (!focusOnMount || providers.isLoading || hasFocusedRef.current) return
    const section = sectionRef.current
    const searchInput = searchInputRef.current
    if (!section || !searchInput) return
    hasFocusedRef.current = true
    section.scrollIntoView({ block: 'nearest' })
    searchInput.focus()
  }, [focusOnMount, providers.isLoading])

  const filteredProviders = useMemo(() => {
    const normalizedQuery = providerSearch.trim().toLocaleLowerCase()
    return [...providers.providers]
      .filter((provider) => {
        if (!normalizedQuery) return true
        return `${provider.name} ${provider.id}`.toLocaleLowerCase().includes(normalizedQuery)
      })
      .sort(
        (left, right) =>
          Number(right.connected) - Number(left.connected) ||
          left.name.localeCompare(right.name) ||
          left.id.localeCompare(right.id)
      )
  }, [providerSearch, providers.providers])
  const disconnectingProviderID = providers.disconnectProviderMutation.isPending
    ? (providers.disconnectProviderMutation.variables ?? null)
    : null

  function openConnectDialog(providerID: string): void {
    setConnectProviderID(providerID)
  }

  function handleConnectDialogOpenChange(open: boolean): void {
    if (!open) setConnectProviderID(null)
  }

  return (
    <section
      ref={sectionRef}
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

      {!providers.isLoading ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor="provider-search">
            Search providers
            <Input
              id="provider-search"
              ref={searchInputRef}
              value={providerSearch}
              onChange={(event) => setProviderSearch(event.currentTarget.value)}
              placeholder="Search provider name or ID"
            />
          </label>
          <ScrollArea className="h-72 border border-border" aria-label="All OpenCode providers">
            <ProviderList
              providers={filteredProviders}
              emptyMessage="No providers match this search."
              disconnectingProviderID={disconnectingProviderID}
              onConnect={openConnectDialog}
              onDisconnect={(providerID) => providers.disconnectProviderMutation.mutate(providerID)}
            />
          </ScrollArea>
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

      {connectProviderID ? (
        <ProviderConnectDialog
          open
          onOpenChange={handleConnectDialogOpenChange}
          directory={directory}
          providerID={connectProviderID}
        />
      ) : null}
    </section>
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
    <div className="divide-y divide-border" role="list">
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
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={onConnect}>
            Connect provider
          </Button>
          <Button type="button" variant="outline" onClick={onDisconnect} disabled={isDisconnecting}>
            {isDisconnecting ? 'Disconnecting' : 'Disconnect provider'}
          </Button>
        </div>
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
