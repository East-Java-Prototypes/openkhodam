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

export type OpenCodeModelSelection = {
  providerID: string
  modelID: string
}

export type GetOpenCodeModelSelectionInput = {
  projectDirectory: string
}

export type SetOpenCodeModelSelectionInput = GetOpenCodeModelSelectionInput & {
  model: OpenCodeModelSelection | null
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

export type LinkedGoogleDoc = {
  artifactPath: string | null
  id: string
  title: string | null
  url: string | null
  listed: boolean
  firstSeenAt: number
  lastSeenAt: number
  firstMessageId: string | null
  lastMessageId: string | null
}

export type LinkedGoogleDocRecord = {
  artifactPath?: string | null
  id: string
  title?: string | null
  url?: string | null
}

export type GoogleDocBodyBlock = {
  id: string
  ordinal: number
  type: 'paragraph'
  text: string
}

export type GoogleDocDocumentArtifact = {
  type: 'google.doc.document'
  id: string
  title: string | null
  revision: string | null
  text: string
  link: string | null
  body: {
    blocks: GoogleDocBodyBlock[]
  }
}

export type GoogleDocDocumentPreviewMetadata = {
  truncated: boolean
  totalTextLength: number
  totalBlockCount: number
  includedBlockCount: number
}

export type GoogleDocDocumentPreviewArtifact = GoogleDocDocumentArtifact & {
  preview: GoogleDocDocumentPreviewMetadata
}

export type PersistedGoogleDocDocumentArtifact = GoogleDocDocumentArtifact & {
  schemaVersion: 1
  cachedAt: number
}

export type ProjectArtifactsConfig = {
  version: 1
  sessions: Record<string, LinkedGoogleDoc[]>
}

export type ProjectArtifactsListInput = {
  projectDirectory: string
}

export type ProjectSessionLinkedDocsListInput = ProjectArtifactsListInput & {
  sessionId: string
}

export type RecordLinkedGoogleDocInput = ProjectSessionLinkedDocsListInput & {
  messageId?: string | null
  doc: LinkedGoogleDocRecord
}

export type UpdateLinkedGoogleDocListingInput = ProjectSessionLinkedDocsListInput & {
  id: string
}
