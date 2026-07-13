import {
  type ApiError,
  type CapabilitiesResponse,
  type ConnectionInfo,
  type HealthResponse,
  type VersionResponse,
  ProtocolValidationError,
  parseApiError,
  parseCapabilitiesResponse,
  parseHealthResponse,
  parseVersionResponse
} from '@openkhodam/protocol'

export interface OpenKhodamClientOptions extends ConnectionInfo {
  fetch?: typeof globalThis.fetch
}

export const openKhodamPluginUrlEnv = 'OPENKHODAM_PLUGIN_URL'
export const openKhodamPluginTokenEnv = 'OPENKHODAM_PLUGIN_TOKEN'

export type OpenKhodamPluginEnv = Record<string, string | undefined>

export function getOpenKhodamPluginConnection(
  env: OpenKhodamPluginEnv
): ConnectionInfo | undefined {
  const baseUrl = sanitizeBaseUrl(env[openKhodamPluginUrlEnv])
  const token = sanitizeToken(env[openKhodamPluginTokenEnv])
  return baseUrl && token ? { baseUrl, token } : undefined
}

function sanitizeBaseUrl(value: string | undefined): string | undefined {
  if (!value) return
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return
    if (url.username || url.password || url.search || url.hash) return
    return url.toString().replace(/\/$/, '')
  } catch {
    return
  }
}

function sanitizeToken(value: string | undefined): string | undefined {
  return value && value.trim() === value && value.length > 0 ? value : undefined
}

export class OpenKhodamClientError extends Error {
  constructor(
    message: string,
    public readonly code: ApiError['error']['code'] | 'network_error' | 'invalid_response',
    public readonly status?: number
  ) {
    super(message)
    this.name = 'OpenKhodamClientError'
  }
}

export interface OpenKhodamClient {
  health(options?: { signal?: AbortSignal }): Promise<HealthResponse>
  version(options?: { signal?: AbortSignal }): Promise<VersionResponse>
  capabilities(options?: { signal?: AbortSignal }): Promise<CapabilitiesResponse>
}

export function createOpenKhodamClient(options: OpenKhodamClientOptions): OpenKhodamClient {
  const request = async <T>(
    path: string,
    parse: (value: unknown) => T,
    signal?: AbortSignal
  ): Promise<T> => {
    let response: Response
    try {
      response = await (options.fetch ?? globalThis.fetch)(new URL(path, options.baseUrl), {
        headers: { authorization: `Bearer ${options.token}`, accept: 'application/json' },
        signal
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new OpenKhodamClientError('OpenKhodam request failed', 'network_error')
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch (error) {
      if (isAbortError(error)) throw error
      throw new OpenKhodamClientError(
        'OpenKhodam returned invalid JSON',
        'invalid_response',
        response.status
      )
    }

    if (!response.ok) {
      try {
        const error = parseApiError(payload)
        throw new OpenKhodamClientError(error.error.message, error.error.code, response.status)
      } catch (error) {
        if (error instanceof OpenKhodamClientError) throw error
        throw new OpenKhodamClientError(
          'OpenKhodam request failed',
          'invalid_response',
          response.status
        )
      }
    }

    try {
      return parse(payload)
    } catch (error) {
      if (error instanceof ProtocolValidationError) {
        throw new OpenKhodamClientError(error.message, 'invalid_response', response.status)
      }
      throw error
    }
  }

  return {
    health: ({ signal } = {}) => request('/health', parseHealthResponse, signal),
    version: ({ signal } = {}) => request('/version', parseVersionResponse, signal),
    capabilities: ({ signal } = {}) => request('/capabilities', parseCapabilitiesResponse, signal)
  }
}

function isAbortError(error: unknown): error is DOMException {
  return error instanceof DOMException && error.name === 'AbortError'
}
