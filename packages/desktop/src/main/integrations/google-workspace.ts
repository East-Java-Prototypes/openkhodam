import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'

import { shell } from 'electron'
import type { GoogleWorkspaceIntegrationStatus } from '@openkhodam/ui/types'

import type { GoogleWorkspaceAccountConfig, GoogleWorkspaceTokenConfig } from './openkhodam-config'
import { OpenKhodamConfigStore } from './openkhodam-config'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
const GOOGLE_SCOPES = ['openid', 'email', 'profile']
const GOOGLE_OAUTH_TIMEOUT_MS = 5 * 60 * 1000

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

export class GoogleWorkspaceIntegration {
  constructor(
    private readonly configStore: OpenKhodamConfigStore,
    private readonly clientId: string | null
  ) {}

  async getStatus(): Promise<GoogleWorkspaceIntegrationStatus> {
    return this.configStore.getGoogleWorkspaceStatus(this.isConfigured())
  }

  async connect(): Promise<GoogleWorkspaceIntegrationStatus> {
    if (!this.clientId) {
      return this.configStore.getGoogleWorkspaceStatus(false)
    }

    const verifier = base64Url(randomBytes(32))
    const challenge = base64Url(createHash('sha256').update(verifier).digest())
    const state = base64Url(randomBytes(24))
    const callback = await waitForOAuthCallback()

    try {
      const authUrl = new URL(GOOGLE_AUTH_URL)
      authUrl.searchParams.set('client_id', this.clientId)
      authUrl.searchParams.set('redirect_uri', callback.redirectUri)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('scope', GOOGLE_SCOPES.join(' '))
      authUrl.searchParams.set('code_challenge', challenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')
      authUrl.searchParams.set('state', state)
      authUrl.searchParams.set('access_type', 'offline')
      authUrl.searchParams.set('prompt', 'consent')

      await shell.openExternal(authUrl.toString())
      const code = await callback.waitForCode(state, GOOGLE_OAUTH_TIMEOUT_MS)
      const token = await exchangeCodeForToken({
        code,
        clientId: this.clientId,
        redirectUri: callback.redirectUri,
        verifier
      })
      const account = await fetchAccount(token.accessToken)

      return this.configStore.setGoogleWorkspaceConnection(account, token.scopes, token)
    } finally {
      await callback.close()
    }
  }

  async disconnect(): Promise<GoogleWorkspaceIntegrationStatus> {
    return this.configStore.disconnectGoogleWorkspace(this.isConfigured())
  }

  private isConfigured(): boolean {
    return Boolean(this.clientId)
  }
}

export function getGoogleWorkspaceClientId(): string | null {
  return process.env['OPENKHODAM_GOOGLE_OAUTH_CLIENT_ID']?.trim() || null
}

async function waitForOAuthCallback(): Promise<{
  redirectUri: string
  waitForCode: (expectedState: string, timeoutMs: number) => Promise<string>
  close: () => Promise<void>
}> {
  let resolveCode: ((code: string) => void) | null = null
  let rejectCode: ((error: Error) => void) | null = null

  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const error = url.searchParams.get('error')

    response.setHeader('content-type', 'text/html; charset=utf-8')

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
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to allocate Google OAuth callback port.')
  }

  return {
    redirectUri: `http://127.0.0.1:${address.port}/oauth/google/callback`,
    waitForCode: async (expectedState, timeoutMs) => {
      let timeout: NodeJS.Timeout | null = null
      try {
        const value = await Promise.race([
          codePromise,
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
      }
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
  }
}

async function exchangeCodeForToken(input: {
  code: string
  clientId: string
  redirectUri: string
  verifier: string
}): Promise<GoogleWorkspaceTokenConfig & { scopes: string[]; accessToken: string }> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    code: input.code,
    code_verifier: input.verifier,
    grant_type: 'authorization_code',
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
