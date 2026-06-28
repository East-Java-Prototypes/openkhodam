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

export type WorkspaceResourceProvider = 'google'

export type WorkspaceResourceKind = 'doc'

export type WorkspaceResourceAlias = string

export type WorkspaceResource = {
  alias: WorkspaceResourceAlias
  provider: WorkspaceResourceProvider
  kind: WorkspaceResourceKind
  id: string
  title: string
  url: string
}

export type WorkspaceSessionResourceBinding = {
  activeResource: WorkspaceResourceAlias | null
  resources: WorkspaceResourceAlias[]
  updatedAt: number
}

export type WorkspaceResourcesConfig = {
  version: 1
  resources: WorkspaceResource[]
  defaultResource: WorkspaceResourceAlias | null
  sessions: Record<string, WorkspaceSessionResourceBinding>
}

export type WorkspaceResourceAttachGoogleDocInput = {
  projectDirectory: string
  alias: string
  title?: string | null
  url: string
}

export type WorkspaceSessionActiveResourceInput = {
  projectDirectory: string
  sessionId: string
  activeResource: WorkspaceResourceAlias | null
}
