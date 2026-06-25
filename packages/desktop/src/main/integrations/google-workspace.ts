import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'

import { shell } from 'electron'
import type { GoogleWorkspaceIntegrationStatus } from '@openkhodam/ui/types'

import type { GoogleWorkspaceAccountConfig, GoogleWorkspaceTokenConfig } from './openkhodam-config'
import { OpenKhodamConfigStore } from './openkhodam-config'
import { GOOGLE_DRIVE_METADATA_READONLY_SCOPE } from './google-workspace-runtime'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
const GOOGLE_SCOPES = ['openid', 'email', 'profile', GOOGLE_DRIVE_METADATA_READONLY_SCOPE]
const ONE_MINUTE_MS = 60 * 1000
const GOOGLE_OAUTH_TIMEOUT_MS = 5 * ONE_MINUTE_MS

class GoogleWorkspaceOAuthCancelledError extends Error {
  constructor() {
    super('Google Workspace OAuth connection was cancelled.')
    this.name = 'GoogleWorkspaceOAuthCancelledError'
  }
}

function isGoogleWorkspaceOAuthCancelledError(
  error: unknown
): error is GoogleWorkspaceOAuthCancelledError {
  return error instanceof Error && error.name === 'GoogleWorkspaceOAuthCancelledError'
}

type TokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  id_token?: string
  scope?: string
  error?: string
  error_description?: string
}

type UserInfoResponse = {
  email?: string
  name?: string
}

export function createGoogleWorkspaceIntegration(configStore: OpenKhodamConfigStore) {
  const clientId = getGoogleWorkspaceClientId()
  const clientSecret = getGoogleWorkspaceClientSecret()
  const isConfigured = () => Boolean(clientId && clientSecret)
  let activeOAuthController: AbortController | null = null

  const getCurrentStatus = async (): Promise<GoogleWorkspaceIntegrationStatus> =>
    configStore.getGoogleWorkspaceStatus(isConfigured())

  return {
    getStatus: async (): Promise<GoogleWorkspaceIntegrationStatus> => {
      return getCurrentStatus()
    },
    connect: async (): Promise<GoogleWorkspaceIntegrationStatus> => {
      if (!isConfigured()) {
        return getCurrentStatus()
      }

      if (activeOAuthController) {
        return getCurrentStatus()
      }

      const oauthClientId = clientId!
      const oauthClientSecret = clientSecret!

      const cancellation = new AbortController()
      activeOAuthController = cancellation
      const verifier = base64Url(randomBytes(32))
      const challenge = base64Url(createHash('sha256').update(verifier).digest())
      const state = base64Url(randomBytes(24))
      let callback: Awaited<ReturnType<typeof waitForOAuthCallback>> | null = null

      try {
        callback = await waitForOAuthCallback(cancellation.signal)
        if (cancellation.signal.aborted) {
          throw new GoogleWorkspaceOAuthCancelledError()
        }

        const authUrl = new URL(GOOGLE_AUTH_URL)
        authUrl.searchParams.set('client_id', oauthClientId)
        authUrl.searchParams.set('redirect_uri', callback.redirectUri)
        authUrl.searchParams.set('response_type', 'code')
        authUrl.searchParams.set('scope', GOOGLE_SCOPES.join(' '))
        authUrl.searchParams.set('code_challenge', challenge)
        authUrl.searchParams.set('code_challenge_method', 'S256')
        authUrl.searchParams.set('state', state)
        authUrl.searchParams.set('access_type', 'offline')
        authUrl.searchParams.set('prompt', 'consent')

        await shell.openExternal(authUrl.toString())
        if (cancellation.signal.aborted) {
          throw new GoogleWorkspaceOAuthCancelledError()
        }

        const code = await callback.waitForCode(state, GOOGLE_OAUTH_TIMEOUT_MS)
        if (cancellation.signal.aborted) {
          throw new GoogleWorkspaceOAuthCancelledError()
        }

        const token = await exchangeCodeForToken({
          code,
          clientId: oauthClientId,
          clientSecret: oauthClientSecret,
          redirectUri: callback.redirectUri,
          verifier
        })
        if (cancellation.signal.aborted) {
          throw new GoogleWorkspaceOAuthCancelledError()
        }

        const account = await fetchAccount(token.accessToken)
        if (cancellation.signal.aborted) {
          throw new GoogleWorkspaceOAuthCancelledError()
        }

        return configStore.setGoogleWorkspaceConnection(account, token.scopes, token)
      } catch (error) {
        if (isGoogleWorkspaceOAuthCancelledError(error)) {
          return getCurrentStatus()
        }

        throw error
      } finally {
        try {
          await callback?.close()
        } catch {
          // Ignore cleanup failures so cancel and success still resolve cleanly.
        } finally {
          if (activeOAuthController === cancellation) {
            activeOAuthController = null
          }
        }
      }
    },
    cancelConnect: async (): Promise<GoogleWorkspaceIntegrationStatus> => {
      activeOAuthController?.abort()
      return getCurrentStatus()
    },
    disconnect: async (): Promise<GoogleWorkspaceIntegrationStatus> => {
      return configStore.disconnectGoogleWorkspace(isConfigured())
    }
  }
}

export function getGoogleWorkspaceClientId(): string | null {
  return process.env['OPENKHODAM_GOOGLE_OAUTH_CLIENT_ID']?.trim() || null
}

// TODO(issue #25): Keep this POC-only secret path out of distributed builds; do not ship an
// OpenKhodam-owned embedded client secret in the desktop app. Replace with BYO OAuth client
// config or a token broker before this becomes a release strategy.
function getGoogleWorkspaceClientSecret(): string | null {
  return process.env['OPENKHODAM_GOOGLE_OAUTH_CLIENT_SECRET']?.trim() || null
}

async function waitForOAuthCallback(signal: AbortSignal): Promise<{
  redirectUri: string
  waitForCode: (expectedState: string, timeoutMs: number) => Promise<string>
  close: () => Promise<void>
}> {
  let server: ReturnType<typeof createServer>
  let resolveCode: ((code: string) => void) | null = null
  let rejectCode: ((error: Error) => void) | null = null
  let listening = false
  let closed = false
  let closePromise: Promise<void> | null = null
  let abortListener: (() => void) | null = null

  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })

  const closeServer = async (): Promise<void> => {
    if (closePromise) {
      return closePromise
    }

    if (abortListener) {
      signal.removeEventListener('abort', abortListener)
      abortListener = null
    }

    closePromise = new Promise<void>((resolve, reject) => {
      if (!listening || closed) {
        closed = true
        resolve()
        return
      }

      closed = true
      server.close((error) => (error ? reject(error) : resolve()))
    })

    return closePromise
  }

  // Bind a temporary loopback listener for the OAuth callback.
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const error = url.searchParams.get('error')

    response.setHeader('content-type', 'text/html; charset=utf-8')

    if (signal.aborted) {
      response.end(
        '<h1>Google Workspace connection was canceled.</h1><p>You can close this window.</p>'
      )
      return
    }

    if (error) {
      response.end('<h1>Google Workspace connection failed.</h1><p>You can close this window.</p>')
      rejectCode?.(new Error(`Google OAuth failed: ${error}`))
      return
    }

    if (!code || !state) {
      response.statusCode = 400
      response.end('<h1>Invalid Google OAuth callback.</h1>')
      rejectCode?.(new Error('Google OAuth callback was missing code or state.'))
      return
    }

    response.end('<h1>Google Workspace connected.</h1><p>You can close this window.</p>')
    resolveCode?.(`${state}:${code}`)
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('error', onError)
      reject(error)
    }

    server.once('error', onError)
    try {
      server.listen(0, '127.0.0.1', () => {
        server.off('error', onError)
        resolve()
      })
    } catch (error) {
      server.off('error', onError)
      reject(error as Error)
    }
  })

  listening = true

  if (signal.aborted) {
    await closeServer().catch(() => undefined)
    throw new GoogleWorkspaceOAuthCancelledError()
  }

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to allocate Google OAuth callback port.')
  }

  return {
    redirectUri: `http://127.0.0.1:${address.port}/oauth/google/callback`,
    waitForCode: async (expectedState, timeoutMs) => {
      let timeout: NodeJS.Timeout | null = null
      const cancellationError = new GoogleWorkspaceOAuthCancelledError()

      try {
        const cancellationPromise = new Promise<string>((_, reject) => {
          abortListener = () => reject(cancellationError)

          if (signal.aborted) {
            abortListener = null
            reject(cancellationError)
            return
          }

          signal.addEventListener('abort', abortListener, { once: true })
        })

        const value = await Promise.race([
          codePromise,
          cancellationPromise,
          new Promise<string>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error('Google OAuth connection timed out. Please try again.')),
              timeoutMs
            )
          })
        ])
        const [actualState, code] = value.split(':')
        if (actualState !== expectedState) {
          throw new Error('Google OAuth callback state did not match.')
        }
        return code
      } finally {
        if (timeout) clearTimeout(timeout)
        if (abortListener) {
          signal.removeEventListener('abort', abortListener)
          abortListener = null
        }
      }
    },
    close: () => closeServer()
  }
}

async function exchangeCodeForToken(input: {
  code: string
  clientId: string
  clientSecret: string
  redirectUri: string
  verifier: string
}): Promise<GoogleWorkspaceTokenConfig & { scopes: string[]; accessToken: string }> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    code: input.code,
    code_verifier: input.verifier,
    grant_type: 'authorization_code',
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri
  })
  const response = await fetch(GOOGLE_TOKEN_URL, { method: 'POST', body })
  const token = (await response.json()) as TokenResponse

  if (!response.ok || !token.access_token) {
    throw new Error(token.error_description || token.error || 'Google OAuth token exchange failed.')
  }

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    expiresAt: typeof token.expires_in === 'number' ? Date.now() + token.expires_in * 1000 : null,
    tokenType: token.token_type ?? null,
    idToken: token.id_token ?? null,
    scopes: token.scope ? token.scope.split(' ').filter(Boolean) : GOOGLE_SCOPES
  }
}

async function fetchAccount(accessToken: string): Promise<GoogleWorkspaceAccountConfig> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` }
  })
  if (!response.ok) {
    return { email: null, name: null }
  }

  const profile = (await response.json()) as UserInfoResponse
  return {
    email: profile.email ?? null,
    name: profile.name ?? null
  }
}

function base64Url(value: Buffer): string {
  return value.toString('base64url')
}
