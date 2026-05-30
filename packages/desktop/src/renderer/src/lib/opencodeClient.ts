import { createOpencodeClient, type OpencodeClientConfig } from '@opencode-ai/sdk/v2/client'
import type { OpenCodeConnection } from '@openkhodam/ui'

export type OpenCodeClientOptions = Omit<OpencodeClientConfig, 'baseUrl' | 'headers'> & {
  headers?: HeadersInit
}

export function createOpenCodeClient(
  connection: OpenCodeConnection,
  options: OpenCodeClientOptions = {}
) {
  return createOpencodeClient({
    ...options,
    baseUrl: connection.url,
    headers: {
      ...headersToRecord(options.headers),
      authorization: getOpenCodeAuthorizationHeader(connection)
    }
  })
}

export function getOpenCodeAuthorizationHeader(connection: OpenCodeConnection): string {
  return `Basic ${btoa(`${connection.username}:${connection.password}`)}`
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return headers
}
