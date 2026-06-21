export type OpenCodeConnection = {
  url: string
  username: string
  password: string
  corsOrigins: string[]
}

export type OpenCodeSidecarStatus = {
  state: 'stopped' | 'starting' | 'connected' | 'error'
  url: string | null
  version: string | null
  pid: number | null
  message: string
  updatedAt: number
}

export type RendererHttpHealthState = 'waiting' | 'checking' | 'connected' | 'error'

export type RendererHttpHealthSnapshot = {
  state: RendererHttpHealthState
  statusCode: number | null
  message: string
}

export type GoogleWorkspaceIntegrationStatus =
  | {
      state: 'not-configured'
      account: null
      scopes: string[]
      message: string
      updatedAt: number
    }
  | {
      state: 'disconnected'
      account: null
      scopes: string[]
      message: string
      updatedAt: number
    }
  | {
      state: 'connected'
      account: {
        email: string | null
        name: string | null
      }
      scopes: string[]
      message: string
      updatedAt: number
    }
