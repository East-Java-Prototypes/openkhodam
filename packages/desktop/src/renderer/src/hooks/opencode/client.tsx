import { createOpencodeClient, type OpencodeClientConfig } from '@opencode-ai/sdk/v2/client'
import type { OpenCodeConnection } from '@openkhodam/ui'
import { createContext, type ReactNode, useContext, useMemo } from 'react'
import {
  getDisplayedOpenCodeConnection,
  useOpenCodeSidecarConnection,
  useOpenCodeSidecarStatus
} from './sidecar'

export type OpenCodeClientOptions = Omit<OpencodeClientConfig, 'baseUrl' | 'headers'>

type OpenCodeSdkContextValue = ReturnType<typeof useOpenCodeSdkValue>

const defaultOpenCodeClientOptions: OpenCodeClientOptions = {}
const OpenCodeSdkContext = createContext<OpenCodeSdkContextValue | null>(null)

export function createOpenCodeClient(
  connection: OpenCodeConnection,
  options: OpenCodeClientOptions = defaultOpenCodeClientOptions
) {
  return createOpencodeClient({
    ...options,
    baseUrl: connection.url,
    headers: {
      authorization: getOpenCodeAuthorizationHeader(connection)
    }
  })
}

export function getOpenCodeAuthorizationHeader(connection: OpenCodeConnection): string {
  return `Basic ${btoa(`${connection.username}:${connection.password}`)}`
}

export function OpenCodeSdkProvider({ children }: { children: ReactNode }) {
  const value = useOpenCodeSdkValue()

  return <OpenCodeSdkContext.Provider value={value}>{children}</OpenCodeSdkContext.Provider>
}

function useOpenCodeSdkValue(options: OpenCodeClientOptions = defaultOpenCodeClientOptions) {
  const statusQuery = useOpenCodeSidecarStatus()
  const status = statusQuery.data
  const connectionQuery = useOpenCodeSidecarConnection(status)
  const connection = getDisplayedOpenCodeConnection(status, connectionQuery.data)
  const client = useMemo(
    () => (connection ? createOpenCodeClient(connection, options) : null),
    [connection, options]
  )

  return useMemo(() => ({
    statusQuery,
    status,
    connectionQuery,
    connection,
    client
  }), [client, connection, connectionQuery, status, statusQuery])
}

export function useOpenCodeSdk() {
  const sdk = useContext(OpenCodeSdkContext)

  if (!sdk) {
    throw new Error('useOpenCodeSdk must be used within an OpenCodeSdkProvider.')
  }

  return sdk
}
