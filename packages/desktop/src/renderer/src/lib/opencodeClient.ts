import { createOpencodeClient, type OpencodeClientConfig } from '@opencode-ai/sdk/v2/client'
import type { OpenCodeConnection } from '@openkhodam/ui'

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
