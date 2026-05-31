import { createOpencodeClient, type OpencodeClientConfig } from '@opencode-ai/sdk/v2/client'
import type { OpenCodeConnection } from '@openkhodam/ui'
import {
  getDisplayedOpenCodeConnection,
  useOpenCodeSidecarConnection,
  useOpenCodeSidecarStatus
} from './sidecar'

export type OpenCodeClientOptions = Omit<OpencodeClientConfig, 'baseUrl' | 'headers'>

export function createOpenCodeClient(
  connection: OpenCodeConnection,
  options: OpenCodeClientOptions = {}
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

export function useOpenCodeSdk(options: OpenCodeClientOptions = {}) {
  const statusQuery = useOpenCodeSidecarStatus()
  const status = statusQuery.data
  const connectionQuery = useOpenCodeSidecarConnection(status)
  const connection = getDisplayedOpenCodeConnection(status, connectionQuery.data)

  return {
    statusQuery,
    status,
    connectionQuery,
    connection,
    client: connection ? createOpenCodeClient(connection, options) : null
  }
}
