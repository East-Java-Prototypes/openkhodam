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

export type OpenedProjectFolder = {
  directory: string
  lastOpenedAt: number
}

export type OpenProjectFolderInput = {
  directory: string
}

export type RemoveProjectFolderInput = OpenProjectFolderInput

export type LinkedGoogleArtifactType = 'google.doc.document' | 'google.sheet.spreadsheet'

export type LinkedGoogleArtifact = {
  type: LinkedGoogleArtifactType
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

export type LinkedGoogleArtifactRecord = {
  type?: LinkedGoogleArtifactType
  artifactPath?: string | null
  id: string
  title?: string | null
  url?: string | null
}

export type LinkedGoogleDoc = LinkedGoogleArtifact

export type LinkedGoogleDocRecord = LinkedGoogleArtifactRecord

export type GoogleDocTextStyle = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  fontFamily?: string
  fontSizePt?: number
  foregroundColor?: string
  backgroundColor?: string
  linkUrl?: string
}

export type GoogleDocTextRun = {
  text: string
  style: GoogleDocTextStyle
}

export type GoogleDocParagraphStyle = {
  namedStyle?: string
  alignment?: string
  lineSpacingPercent?: number
  spaceAbovePt?: number
  spaceBelowPt?: number
}

export type GoogleDocListMetadata = {
  listId: string
  nestingLevel: number
  kind: 'bullet' | 'numbered' | 'checkbox' | 'unknown'
  glyphType?: string
  glyphSymbol?: string
}

export type GoogleDocBodyLocation = { kind: 'body'; bodyIndex: number }

export type GoogleDocTableCellLocation = {
  kind: 'table-cell'
  tableIndex: number
  rowIndex: number
  columnIndex: number
  paragraphIndex: number
  rowCount: number
  columnCount: number
}

export type GoogleDocUnsupportedTableLocation = {
  kind: 'unsupported-table'
  tableIndex: number
  reason: 'merged-or-irregular'
  rowIndex: number
  columnIndex: number
  paragraphIndex: number
}

export type GoogleDocBodyBlock = {
  id: string
  ordinal: number
  type: 'paragraph'
  text: string
  runs?: GoogleDocTextRun[]
  paragraphStyle?: GoogleDocParagraphStyle
  list?: GoogleDocListMetadata
  location?: GoogleDocBodyLocation | GoogleDocTableCellLocation | GoogleDocUnsupportedTableLocation
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
  schemaVersion: 1 | 2
  cachedAt: number
}

export type GoogleSheetCellValue = string | number | boolean | null

export type GoogleSheetSheetArtifact = {
  id: number | null
  title: string
  index: number | null
  hidden: boolean
  sheetType: string | null
  rowCount: number | null
  columnCount: number | null
}

export type GoogleSheetRangeArtifact = {
  range: string
  majorDimension: string | null
  values: GoogleSheetCellValue[][]
  rowCount: number
  columnCount: number
  cellCount: number
  truncated: boolean
}

export type GoogleSheetSpreadsheetArtifact = {
  type: 'google.sheet.spreadsheet'
  id: string
  title: string | null
  link: string | null
  sheets: GoogleSheetSheetArtifact[]
  ranges: GoogleSheetRangeArtifact[]
}

export type GoogleSheetRangePreviewMetadata = {
  range: string
  truncated: boolean
  totalRowCount: number
  totalColumnCount: number
  totalCellCount: number
  totalTextLength: number
  includedRowCount: number
  includedCellCount: number
  includedTextLength: number
}

export type GoogleSheetSpreadsheetPreviewMetadata = {
  truncated: boolean
  totalRangeCount: number
  includedRangeCount: number
  ranges: GoogleSheetRangePreviewMetadata[]
}

export type GoogleSheetSpreadsheetPreviewArtifact = GoogleSheetSpreadsheetArtifact & {
  preview: GoogleSheetSpreadsheetPreviewMetadata
}

export type PersistedGoogleSheetSpreadsheetArtifact = GoogleSheetSpreadsheetArtifact & {
  schemaVersion: 1
  cachedAt: number
}

export type ProjectArtifactsConfig = {
  version: 1
  sessions: Record<string, LinkedGoogleArtifact[]>
}

export type ProjectArtifactsListInput = {
  projectDirectory: string
}

export type ProjectSessionLinkedGoogleArtifactsListInput = ProjectArtifactsListInput & {
  sessionId: string
}

export type ProjectSessionLinkedDocsListInput = ProjectSessionLinkedGoogleArtifactsListInput

export type RecordLinkedGoogleArtifactInput = ProjectSessionLinkedGoogleArtifactsListInput & {
  messageId?: string | null
  artifact: LinkedGoogleArtifactRecord
}

export type RecordLinkedGoogleDocInput = ProjectSessionLinkedGoogleArtifactsListInput & {
  messageId?: string | null
  doc: LinkedGoogleDocRecord
}

export type UpdateLinkedGoogleArtifactListingInput =
  ProjectSessionLinkedGoogleArtifactsListInput & {
    id: string
    type?: LinkedGoogleArtifactType
  }

export type UpdateLinkedGoogleDocListingInput = UpdateLinkedGoogleArtifactListingInput
