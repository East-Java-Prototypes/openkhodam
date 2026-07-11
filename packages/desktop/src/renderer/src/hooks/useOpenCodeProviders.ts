import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { ProviderAuthMethod } from '@opencode-ai/sdk/v2/client'

import { useOpenCodeSdk, type createOpenCodeClient } from './opencode/client'
import { openCodeQueryKeys } from './opencode/sidecar'

type OpenCodeClient = ReturnType<typeof createOpenCodeClient>
type ProviderListResponse = NonNullable<
  Awaited<ReturnType<OpenCodeClient['provider']['list']>>['data']
>
type ProviderAuthResponse = NonNullable<
  Awaited<ReturnType<OpenCodeClient['provider']['auth']>>['data']
>

export type OpenCodeProviderAuthMethod = ProviderAuthMethod

export type OpenCodeProviderOption = {
  id: string
  name: string
  source: OpenCodeProviderSource | null
  modelCount: number
  connected: boolean
  canDisconnect: boolean
}

export type OpenCodeProviderSource = 'env' | 'api' | 'config' | 'custom'

export type ConnectApiProviderInput = {
  providerID: string
  key: string
  metadata?: Record<string, string>
}

export type AuthorizeOAuthProviderInput = {
  providerID: string
  method: number
  inputs?: Record<string, string>
}

export type CompleteOAuthProviderInput = {
  providerID: string
  method: number
  code?: string
}

export function useOpenCodeProviders() {
  const { status, statusQuery, connection, connectionQuery, client } = useOpenCodeSdk()
  const queryClient = useQueryClient()

  const providersQuery = useQuery({
    queryKey: openCodeQueryKeys.providerList(status),
    queryFn: async (): Promise<ProviderListResponse> => {
      const response = await client!.provider.list()
      if (response.error) throw response.error
      return response.data!
    },
    enabled: client !== null
  })

  const authMethodsQuery = useQuery({
    queryKey: openCodeQueryKeys.providerAuthMethodsFor(status),
    queryFn: async (): Promise<ProviderAuthResponse> => {
      const response = await client!.provider.auth()
      if (response.error) throw response.error
      return response.data!
    },
    enabled: client !== null
  })

  const providers = useMemo(
    () => normalizeProviderOptions(providersQuery.data),
    [providersQuery.data]
  )
  const connectedProviders = useMemo(
    () => providers.filter((provider) => provider.connected),
    [providers]
  )
  const disconnectedProviders = useMemo(
    () => providers.filter((provider) => !provider.connected),
    [providers]
  )
  const authMethods = authMethodsQuery.data ?? null

  const connectApiProviderMutation = useMutation({
    mutationFn: async ({ providerID, key, metadata }: ConnectApiProviderInput) => {
      if (!client) throw new Error('OpenCode is not connected.')
      const auth = {
        type: 'api' as const,
        key,
        ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {})
      }
      const response = await client.auth.set({ providerID, auth })
      if (response.error) throw response.error
      await refreshOpenCodeProviderState(client, queryClient)
      return response.data ?? true
    }
  })

  const authorizeOAuthProviderMutation = useMutation({
    mutationFn: async ({ providerID, method, inputs }: AuthorizeOAuthProviderInput) => {
      if (!client) throw new Error('OpenCode is not connected.')
      const response = await client.provider.oauth.authorize({
        providerID,
        method,
        ...(inputs && Object.keys(inputs).length > 0 ? { inputs } : {})
      })
      if (response.error) throw response.error
      if (!response.data) throw new Error('OpenCode did not return an OAuth authorization URL.')
      return response.data
    }
  })

  const completeOAuthProviderMutation = useMutation({
    mutationFn: async ({ providerID, method, code }: CompleteOAuthProviderInput) => {
      if (!client) throw new Error('OpenCode is not connected.')
      const response = await client.provider.oauth.callback({
        providerID,
        method,
        ...(code ? { code } : {})
      })
      if (response.error) throw response.error
      await refreshOpenCodeProviderState(client, queryClient)
      return response.data ?? true
    }
  })

  const disconnectProviderMutation = useMutation({
    mutationFn: async (providerID: string) => {
      if (!client) throw new Error('OpenCode is not connected.')
      const response = await client.auth.remove({ providerID })
      if (response.error) throw response.error
      await refreshOpenCodeProviderState(client, queryClient)
      return response.data ?? true
    }
  })

  return {
    status,
    statusQuery,
    connection,
    connectionQuery,
    providersQuery,
    authMethodsQuery,
    providers,
    connectedProviders,
    disconnectedProviders,
    authMethods,
    getAuthMethods: (providerID: string): OpenCodeProviderAuthMethod[] | null => {
      if (!authMethods) return null
      const methods = authMethods[providerID] ?? []
      return methods.length > 0 ? methods : [{ type: 'api', label: 'API key' }]
    },
    connectApiProviderMutation,
    authorizeOAuthProviderMutation,
    completeOAuthProviderMutation,
    disconnectProviderMutation,
    errorMessage: providersQuery.error ? formatUnknownError(providersQuery.error) : null,
    authMethodsErrorMessage: authMethodsQuery.error
      ? formatUnknownError(authMethodsQuery.error)
      : null,
    isLoading: providersQuery.isLoading
  }
}

async function refreshOpenCodeProviderState(
  client: OpenCodeClient,
  queryClient: QueryClient
): Promise<void> {
  try {
    const response = await client.global.dispose()
    if (response.error) throw response.error
  } finally {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: openCodeQueryKeys.providerLists() }),
      queryClient.invalidateQueries({ queryKey: openCodeQueryKeys.providerAuthMethods() }),
      queryClient.invalidateQueries({ queryKey: openCodeQueryKeys.all })
    ])
  }
}

function normalizeProviderOptions(
  data: ProviderListResponse | undefined
): OpenCodeProviderOption[] {
  if (!isRecord(data)) return []
  const connected = new Set(getStringArray(data.connected))
  return getArray(data.all)
    .filter(isRecord)
    .map((provider) => {
      const id = getString(provider.id)
      const models = isRecord(provider.models) ? provider.models : {}
      return {
        id,
        name: getString(provider.name) || id,
        source: normalizeProviderSource(provider.source),
        modelCount: Object.keys(models).length,
        connected: connected.has(id),
        canDisconnect: normalizeProviderSource(provider.source) !== 'env'
      }
    })
    .filter((provider) => provider.id.length > 0)
}

function normalizeProviderSource(value: unknown): OpenCodeProviderSource | null {
  const source = getString(value)
  return source === 'env' || source === 'api' || source === 'config' || source === 'custom'
    ? source
    : null
}

function getArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function getStringArray(value: unknown): string[] {
  return getArray(value).filter((item): item is string => typeof item === 'string')
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (!isRecord(error)) return String(error)

  const data = isRecord(error.data) ? error.data : null
  const message =
    getString(error.message) ||
    getString(error.detail) ||
    getString(error.name) ||
    (data ? getString(data.message) || getString(data.field) : '')
  if (message) return message

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}
