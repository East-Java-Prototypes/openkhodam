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

export type LinkedSourceProvider = 'google' | (string & {})

export type LinkedSourceKind = 'google-doc' | (string & {})

export type LinkedSourceAttributeValue = string | number | boolean | null

export type LinkedSourceAttributes = Record<string, LinkedSourceAttributeValue>

export type LinkedSource = {
  key: string
  provider: LinkedSourceProvider
  kind: LinkedSourceKind
  id: string
  title: string | null
  url: string | null
  mimeType: string | null
  attributes: LinkedSourceAttributes
  listed: boolean
  firstSeenAt: number
  lastSeenAt: number
  firstMessageId: string | null
  lastMessageId: string | null
}

export type LinkedSourceRecord = {
  key?: string
  provider: LinkedSourceProvider
  kind: LinkedSourceKind
  id: string
  title?: string | null
  url?: string | null
  mimeType?: string | null
  attributes?: LinkedSourceAttributes
}

export type ProjectSourcesConfig = {
  version: 1
  sessions: Record<string, LinkedSource[]>
}

export type ProjectSourcesListInput = {
  projectDirectory: string
}

export type ProjectSessionSourcesListInput = ProjectSourcesListInput & {
  sessionId: string
}

export type RecordLinkedSourceInput = ProjectSessionSourcesListInput & {
  messageId?: string | null
  source: LinkedSourceRecord
}

export type UpdateLinkedSourceListingInput = ProjectSessionSourcesListInput & {
  key: string
}
