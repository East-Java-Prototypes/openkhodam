export const protocolVersion = '1' as const

export interface ConnectionInfo {
  baseUrl: string
  token: string
}

export interface HealthResponse {
  status: 'ok'
}

export interface CapabilitiesResponse {
  protocolVersion: typeof protocolVersion
  capabilities: string[]
}

export interface VersionResponse {
  version: string
}

export type ErrorCode = 'unauthorized' | 'not_found' | 'validation_error' | 'internal_error'

export interface ApiError {
  error: {
    code: ErrorCode
    message: string
  }
}

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

export type GoogleDocBodyBlock = { id: string; ordinal: number; type: 'paragraph'; text: string }
export type GoogleDocDocumentArtifact = {
  type: 'google.doc.document'
  id: string
  title: string | null
  revision: string | null
  text: string
  link: string | null
  body: { blocks: GoogleDocBodyBlock[] }
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
export type ProjectArtifactsConfig = {
  version: 1
  sessions: Record<string, LinkedGoogleArtifact[]>
}

export type ProjectArtifactsListInput = { projectDirectory: string }
export type ProjectSessionLinkedGoogleArtifactsListInput = ProjectArtifactsListInput & {
  sessionId: string
}
export type RecordLinkedGoogleArtifactInput = ProjectSessionLinkedGoogleArtifactsListInput & {
  messageId?: string | null
  artifact: LinkedGoogleArtifactRecord
}
export type UpdateLinkedGoogleArtifactListingInput =
  ProjectSessionLinkedGoogleArtifactsListInput & { id: string; type?: LinkedGoogleArtifactType }
export type PersistGoogleDocDocumentArtifactInput = ProjectArtifactsListInput & {
  document: GoogleDocDocumentArtifact
}
export type PersistGoogleDocDocumentArtifactResult = { artifactPath: string; created: boolean }
export type PersistGoogleSheetSpreadsheetArtifactInput = ProjectArtifactsListInput & {
  spreadsheet: GoogleSheetSpreadsheetArtifact
}
export type PersistGoogleSheetSpreadsheetArtifactResult = { artifactPath: string; created: boolean }
export type DeleteGoogleDocDocumentArtifactInput = ProjectArtifactsListInput & {
  artifactPath: string
}
export type DeleteGoogleDocDocumentArtifactResult = { deleted: boolean }
export type DeleteGoogleSheetSpreadsheetArtifactInput = ProjectArtifactsListInput & {
  artifactPath: string
}
export type DeleteGoogleSheetSpreadsheetArtifactResult = { deleted: boolean }
export type SnapshotGoogleDocDocumentInput = PersistGoogleDocDocumentArtifactInput & {
  sessionId: string
  messageId?: string | null
}
export type SnapshotGoogleSheetSpreadsheetInput = PersistGoogleSheetSpreadsheetArtifactInput & {
  sessionId: string
  messageId?: string | null
}
export type SnapshotGoogleDocDocumentResult = LinkedGoogleArtifact
export type SnapshotGoogleSheetSpreadsheetResult = LinkedGoogleArtifact

export class ProtocolValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProtocolValidationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function expectRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ProtocolValidationError(`${name} must be an object`)
  return value
}

function expectString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new ProtocolValidationError(`${name} must be a string`)
  return value
}

function expectNullableString(value: unknown, name: string): string | null {
  return value === null ? null : expectString(value, name)
}

function expectBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new ProtocolValidationError(`${name} must be a boolean`)
  return value
}

function expectNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new ProtocolValidationError(`${name} must be a finite number`)
  return value
}

function expectArtifactType(value: unknown, name: string): LinkedGoogleArtifactType {
  if (value === 'google.doc.document' || value === 'google.sheet.spreadsheet') return value
  throw new ProtocolValidationError(`${name} is not recognized`)
}

export function parseProjectArtifactsListInput(value: unknown): ProjectArtifactsListInput {
  const record = expectRecord(value, 'project artifacts input')
  return { projectDirectory: expectString(record.projectDirectory, 'projectDirectory') }
}

export function parseRecordLinkedGoogleArtifactInput(
  value: unknown
): RecordLinkedGoogleArtifactInput {
  const base = parseProjectArtifactsListInput(value)
  const record = expectRecord(value, 'record artifact input')
  const artifact = expectRecord(record.artifact, 'artifact')
  const rawType = artifact.type
  if (
    rawType !== undefined &&
    rawType !== 'google.doc.document' &&
    rawType !== 'google.sheet.spreadsheet'
  )
    throw new ProtocolValidationError('artifact.type is not recognized')
  return {
    ...base,
    sessionId: expectString(record.sessionId, 'sessionId'),
    messageId:
      record.messageId === undefined
        ? undefined
        : expectNullableString(record.messageId, 'messageId'),
    artifact: {
      type: rawType as LinkedGoogleArtifactType | undefined,
      artifactPath:
        artifact.artifactPath === undefined
          ? undefined
          : expectNullableString(artifact.artifactPath, 'artifact.artifactPath'),
      id: expectString(artifact.id, 'artifact.id'),
      title:
        artifact.title === undefined
          ? undefined
          : expectNullableString(artifact.title, 'artifact.title'),
      url:
        artifact.url === undefined ? undefined : expectNullableString(artifact.url, 'artifact.url')
    }
  }
}

export function parseUpdateLinkedGoogleArtifactListingInput(
  value: unknown
): UpdateLinkedGoogleArtifactListingInput {
  const base = parseProjectArtifactsListInput(value)
  const record = expectRecord(value, 'update artifact input')
  return {
    ...base,
    sessionId: expectString(record.sessionId, 'sessionId'),
    id: expectString(record.id, 'id'),
    type: record.type === undefined ? undefined : expectArtifactType(record.type, 'type')
  }
}

export function parseSnapshotGoogleDocDocumentInput(
  value: unknown
): SnapshotGoogleDocDocumentInput {
  const record = expectRecord(value, 'Google Doc snapshot input')
  return {
    projectDirectory: expectString(record.projectDirectory, 'projectDirectory'),
    sessionId: expectString(record.sessionId, 'sessionId'),
    messageId:
      record.messageId === undefined
        ? undefined
        : expectNullableString(record.messageId, 'messageId'),
    document: parseGoogleDocDocumentArtifact(record.document)
  }
}

export function parseSnapshotGoogleSheetSpreadsheetInput(
  value: unknown
): SnapshotGoogleSheetSpreadsheetInput {
  const record = expectRecord(value, 'Google Sheet snapshot input')
  return {
    projectDirectory: expectString(record.projectDirectory, 'projectDirectory'),
    sessionId: expectString(record.sessionId, 'sessionId'),
    messageId:
      record.messageId === undefined
        ? undefined
        : expectNullableString(record.messageId, 'messageId'),
    spreadsheet: parseGoogleSheetSpreadsheetArtifact(record.spreadsheet)
  }
}

export function parseGoogleDocDocumentArtifact(value: unknown): GoogleDocDocumentArtifact {
  const record = expectRecord(value, 'Google Doc artifact')
  if (record.type !== 'google.doc.document')
    throw new ProtocolValidationError('document.type must be google.doc.document')
  const body = expectRecord(record.body, 'document.body')
  if (!Array.isArray(body.blocks))
    throw new ProtocolValidationError('document.body.blocks must be an array')
  return {
    type: 'google.doc.document',
    id: expectString(record.id, 'document.id'),
    title: expectNullableString(record.title, 'document.title'),
    revision: expectNullableString(record.revision, 'document.revision'),
    text: expectString(record.text, 'document.text'),
    link: expectNullableString(record.link, 'document.link'),
    body: {
      blocks: body.blocks.map((value, index) => {
        const block = expectRecord(value, `document.body.blocks.${index}`)
        if (block.type !== 'paragraph')
          throw new ProtocolValidationError('document body block type must be paragraph')
        return {
          id: expectString(block.id, 'block.id'),
          ordinal: expectNumber(block.ordinal, 'block.ordinal'),
          type: 'paragraph' as const,
          text: expectString(block.text, 'block.text')
        }
      })
    }
  }
}

export function parseGoogleSheetSpreadsheetArtifact(
  value: unknown
): GoogleSheetSpreadsheetArtifact {
  const record = expectRecord(value, 'Google Sheet artifact')
  if (record.type !== 'google.sheet.spreadsheet')
    throw new ProtocolValidationError('spreadsheet.type must be google.sheet.spreadsheet')
  if (!Array.isArray(record.sheets) || !Array.isArray(record.ranges))
    throw new ProtocolValidationError('spreadsheet sheets and ranges must be arrays')
  const nullableNumber = (value: unknown, name: string) =>
    value === null ? null : expectNumber(value, name)
  const nullableString = (value: unknown, name: string) =>
    value === null ? null : expectString(value, name)
  return {
    type: 'google.sheet.spreadsheet',
    id: expectString(record.id, 'spreadsheet.id'),
    title: expectNullableString(record.title, 'spreadsheet.title'),
    link: expectNullableString(record.link, 'spreadsheet.link'),
    sheets: record.sheets.map((value, index) => {
      const sheet = expectRecord(value, `spreadsheet.sheets.${index}`)
      return {
        id: nullableNumber(sheet.id, 'sheet.id'),
        title: expectString(sheet.title, 'sheet.title'),
        index: nullableNumber(sheet.index, 'sheet.index'),
        hidden: expectBoolean(sheet.hidden, 'sheet.hidden'),
        sheetType: nullableString(sheet.sheetType, 'sheet.sheetType'),
        rowCount: nullableNumber(sheet.rowCount, 'sheet.rowCount'),
        columnCount: nullableNumber(sheet.columnCount, 'sheet.columnCount')
      }
    }),
    ranges: record.ranges.map((value, index) => {
      const range = expectRecord(value, `spreadsheet.ranges.${index}`)
      if (!Array.isArray(range.values))
        throw new ProtocolValidationError('range.values must be an array')
      return {
        range: expectString(range.range, 'range.range'),
        majorDimension: nullableString(range.majorDimension, 'range.majorDimension'),
        values: range.values.map((row, rowIndex) => {
          if (!Array.isArray(row))
            throw new ProtocolValidationError(`range.values.${rowIndex} must be an array`)
          return row.map((cell) => {
            if (
              cell === null ||
              typeof cell === 'string' ||
              typeof cell === 'number' ||
              typeof cell === 'boolean'
            )
              return cell
            throw new ProtocolValidationError('range cell must be scalar')
          })
        }),
        rowCount: expectNumber(range.rowCount, 'range.rowCount'),
        columnCount: expectNumber(range.columnCount, 'range.columnCount'),
        cellCount: expectNumber(range.cellCount, 'range.cellCount'),
        truncated: expectBoolean(range.truncated, 'range.truncated')
      }
    })
  }
}

export function parseLinkedGoogleArtifact(value: unknown): LinkedGoogleArtifact {
  const record = expectRecord(value, 'linked artifact')
  return {
    type: expectArtifactType(record.type, 'type'),
    artifactPath: expectNullableString(record.artifactPath, 'artifactPath'),
    id: expectString(record.id, 'id'),
    title: expectNullableString(record.title, 'title'),
    url: expectNullableString(record.url, 'url'),
    listed: expectBoolean(record.listed, 'listed'),
    firstSeenAt: expectNumber(record.firstSeenAt, 'firstSeenAt'),
    lastSeenAt: expectNumber(record.lastSeenAt, 'lastSeenAt'),
    firstMessageId: expectNullableString(record.firstMessageId, 'firstMessageId'),
    lastMessageId: expectNullableString(record.lastMessageId, 'lastMessageId')
  }
}

export function parseSnapshotGoogleDocDocumentResult(
  value: unknown
): SnapshotGoogleDocDocumentResult {
  return parseLinkedGoogleArtifact(value)
}

export function parseSnapshotGoogleSheetSpreadsheetResult(
  value: unknown
): SnapshotGoogleSheetSpreadsheetResult {
  return parseLinkedGoogleArtifact(value)
}

export function parseProjectArtifactsConfig(value: unknown): ProjectArtifactsConfig {
  const record = expectRecord(value, 'project artifacts config')
  if (record.version !== 1) throw new ProtocolValidationError('version must be 1')
  const sessions = expectRecord(record.sessions, 'sessions')
  return {
    version: 1,
    sessions: Object.fromEntries(
      Object.entries(sessions).map(([key, artifacts]) => {
        if (!Array.isArray(artifacts))
          throw new ProtocolValidationError(`sessions.${key} must be an array`)
        return [key, artifacts.map(parseLinkedGoogleArtifact)]
      })
    )
  }
}

export function parseHealthResponse(value: unknown): HealthResponse {
  const record = expectRecord(value, 'health response')
  if (record.status !== 'ok') throw new ProtocolValidationError('health response status must be ok')
  return { status: 'ok' }
}

export function parseVersionResponse(value: unknown): VersionResponse {
  const record = expectRecord(value, 'version response')
  return { version: expectString(record.version, 'version') }
}

export function parseCapabilitiesResponse(value: unknown): CapabilitiesResponse {
  const record = expectRecord(value, 'capabilities response')
  if (record.protocolVersion !== protocolVersion) {
    throw new ProtocolValidationError(`protocolVersion must be ${protocolVersion}`)
  }
  if (
    !Array.isArray(record.capabilities) ||
    !record.capabilities.every((item) => typeof item === 'string')
  ) {
    throw new ProtocolValidationError('capabilities must be an array of strings')
  }
  return { protocolVersion, capabilities: record.capabilities }
}

export function parseApiError(value: unknown): ApiError {
  const record = expectRecord(value, 'error response')
  const error = expectRecord(record.error, 'error')
  const codes: ErrorCode[] = ['unauthorized', 'not_found', 'validation_error', 'internal_error']
  if (!codes.includes(error.code as ErrorCode)) {
    throw new ProtocolValidationError('error.code is not recognized')
  }
  return {
    error: {
      code: error.code as ErrorCode,
      message: expectString(error.message, 'error.message')
    }
  }
}
