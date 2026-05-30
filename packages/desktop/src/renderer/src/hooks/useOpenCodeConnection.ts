import { useQuery } from '@tanstack/react-query'
import type { OpenCodeConnection, OpenCodeSidecarStatus } from '@openkhodam/ui'

export type OpenCodeConnectionResult = {
  updatedAt: number
  connection: OpenCodeConnection
}

export const openCodeStatusQueryKey = ['opencode', 'status'] as const
export const openCodeQueryKey = ['opencode'] as const

export const initialOpenCodeStatus: OpenCodeSidecarStatus = {
  state: 'starting',
  url: null,
  version: null,
  pid: null,
  message: 'Checking OpenCode sidecar...',
  updatedAt: Date.now()
}

export function useOpenCodeStatus() {
  return useQuery({
    queryKey: openCodeStatusQueryKey,
    queryFn: window.api.getOpenCodeStatus,
    initialData: initialOpenCodeStatus,
    refetchInterval: 1000
  })
}

export function useOpenCodeConnection(status: OpenCodeSidecarStatus) {
  return useQuery({
    queryKey: ['opencode', 'connection', status.updatedAt],
    queryFn: async (): Promise<OpenCodeConnectionResult> => ({
      updatedAt: status.updatedAt,
      connection: await window.api.getOpenCodeConnection()
    }),
    enabled: status.state === 'connected'
  })
}

export function getDisplayedOpenCodeConnection(
  status: OpenCodeSidecarStatus,
  connection: OpenCodeConnectionResult | undefined
): OpenCodeConnection | null {
  if (status.state !== 'connected') return null
  if (connection?.updatedAt !== status.updatedAt) return null
  return connection.connection
}
