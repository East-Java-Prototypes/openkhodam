import { useQuery } from '@tanstack/react-query'
import type { OpenCodeConnection, OpenCodeSidecarStatus } from '@openkhodam/ui'

export type OpenCodeConnectionResult = {
  updatedAt: number
  connection: OpenCodeConnection
}

export const openCodeSidecarState = {
  stopped: 'stopped',
  starting: 'starting',
  connected: 'connected',
  error: 'error'
} as const satisfies Record<OpenCodeSidecarStatus['state'], OpenCodeSidecarStatus['state']>

export const openCodeQueryKeys = {
  all: ['opencode'] as const,
  sidecarStatus: () => [...openCodeQueryKeys.all, 'sidecar-status'] as const,
  sidecarConnection: (updatedAt: number) =>
    [...openCodeQueryKeys.all, 'sidecar-connection', updatedAt] as const,
  providerLists: () => [...openCodeQueryKeys.all, 'providers'] as const,
  providerList: (
    status: Pick<OpenCodeSidecarStatus, 'url' | 'pid' | 'updatedAt'>,
    directory: string | null | undefined
  ) =>
    [
      ...openCodeQueryKeys.providerLists(),
      status.url,
      status.pid,
      status.updatedAt,
      directory ?? null
    ] as const,
  providerAuthMethods: () => [...openCodeQueryKeys.all, 'provider-auth-methods'] as const,
  providerAuthMethodsFor: (
    status: Pick<OpenCodeSidecarStatus, 'url' | 'pid' | 'updatedAt'>,
    directory: string | null | undefined
  ) =>
    [
      ...openCodeQueryKeys.providerAuthMethods(),
      status.url,
      status.pid,
      status.updatedAt,
      directory ?? null
    ] as const
}

export const initialOpenCodeSidecarStatus: OpenCodeSidecarStatus = {
  state: openCodeSidecarState.starting,
  url: null,
  version: null,
  pid: null,
  message: 'Checking OpenCode sidecar...',
  updatedAt: Date.now()
}

export function useOpenCodeSidecarStatus() {
  return useQuery({
    queryKey: openCodeQueryKeys.sidecarStatus(),
    queryFn: window.api.getOpenCodeStatus,
    initialData: initialOpenCodeSidecarStatus,
    refetchInterval: 1000
  })
}

export function useOpenCodeSidecarConnection(status: OpenCodeSidecarStatus) {
  return useQuery({
    queryKey: openCodeQueryKeys.sidecarConnection(status.updatedAt),
    queryFn: async (): Promise<OpenCodeConnectionResult> => ({
      updatedAt: status.updatedAt,
      connection: await window.api.getOpenCodeConnection()
    }),
    enabled: status.state === openCodeSidecarState.connected
  })
}

export function getDisplayedOpenCodeConnection(
  status: OpenCodeSidecarStatus,
  connection: OpenCodeConnectionResult | undefined
): OpenCodeConnection | null {
  if (status.state !== openCodeSidecarState.connected) return null
  if (connection?.updatedAt !== status.updatedAt) return null
  return connection.connection
}
