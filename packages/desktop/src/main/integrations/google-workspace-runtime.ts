import type {
  GoogleDocBodyBlock,
  GoogleDocDocumentArtifact,
  GoogleDocDocumentPreviewArtifact,
  GoogleDocDocumentPreviewMetadata,
  GoogleSheetCellValue,
  GoogleSheetRangeArtifact,
  GoogleSheetRangePreviewMetadata,
  GoogleSheetSheetArtifact,
  GoogleSheetSpreadsheetArtifact,
  GoogleSheetSpreadsheetPreviewArtifact,
  GoogleSheetSpreadsheetPreviewMetadata
} from '@openkhodam/ui/types'

import type { GoogleWorkspaceTokenConfig } from './openkhodam-config'
import { OpenKhodamConfigFileStore } from './openkhodam-config'

export type {
  GoogleDocBodyBlock,
  GoogleDocDocumentArtifact,
  GoogleDocDocumentPreviewArtifact,
  GoogleDocDocumentPreviewMetadata,
  GoogleSheetCellValue,
  GoogleSheetRangeArtifact,
  GoogleSheetRangePreviewMetadata,
  GoogleSheetSheetArtifact,
  GoogleSheetSpreadsheetArtifact,
  GoogleSheetSpreadsheetPreviewArtifact,
  GoogleSheetSpreadsheetPreviewMetadata
}

export const GOOGLE_DRIVE_METADATA_READONLY_SCOPE =
  'https://www.googleapis.com/auth/drive.metadata.readonly'
export const GOOGLE_DOCS_DOCUMENTS_SCOPE = 'https://www.googleapis.com/auth/documents'
export const GOOGLE_SHEETS_SPREADSHEETS_SCOPE =
  'https://www.googleapis.com/auth/spreadsheets.readonly'

const GOOGLE_DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const GOOGLE_DOCS_DOCUMENTS_URL = 'https://docs.googleapis.com/v1/documents'
const GOOGLE_SHEETS_SPREADSHEETS_URL = 'https://sheets.googleapis.com/v4/spreadsheets'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const DEFAULT_DRIVE_SEARCH_LIMIT = 10
const MAX_DRIVE_SEARCH_LIMIT = 20
const TOKEN_EXPIRY_SKEW_MS = 60 * 1000
const GOOGLE_DOCS_READ_PREVIEW_BLOCK_LIMIT = 20
const GOOGLE_DOCS_READ_PREVIEW_TEXT_LIMIT = 12_000
const GOOGLE_SHEETS_DEFAULT_RANGE_A1 = 'A1:Z200'
const GOOGLE_SHEETS_MAX_READ_RANGES = 5
const GOOGLE_SHEETS_MAX_RANGE_ROWS = 200
const GOOGLE_SHEETS_MAX_RANGE_COLUMNS = 26
const GOOGLE_SHEETS_MAX_CELL_TEXT_LENGTH = 2_000
const GOOGLE_SHEETS_MAX_ARTIFACT_TEXT_LENGTH = 120_000
const GOOGLE_SHEETS_PREVIEW_ROW_LIMIT = 50
const GOOGLE_SHEETS_PREVIEW_TEXT_LIMIT = 12_000
const GOOGLE_SHEETS_VALUE_RENDER_OPTIONS = [
  'FORMATTED_VALUE',
  'UNFORMATTED_VALUE',
  'FORMULA'
] as const

type Fetch = typeof fetch

type GoogleTokenRefreshResponse = {
  access_token?: string
  expires_in?: number
  id_token?: string
  refresh_token?: string
  scope?: string
  token_type?: string
  error?: string
  error_description?: string
}

type GoogleDriveFilesResponse = {
  files?: unknown[]
  error?: GoogleApiErrorBody
}

type GoogleDocsApiResponse = {
  error?: GoogleApiErrorBody
}

type GoogleApiErrorBody = {
  code?: number | string
  errors?: Array<{
    message?: string
    reason?: string
  }>
  message?: string
  status?: string
}

type GoogleDocsDocumentResponse = GoogleDocsApiResponse & {
  body?: {
    content?: unknown[]
  }
  documentId?: string
  revisionId?: string
  title?: string
}

type GoogleDocsBatchUpdateResponse = GoogleDocsApiResponse & {
  documentId?: string
  writeControl?: {
    requiredRevisionId?: string
    targetRevisionId?: string
  }
}

type GoogleSheetsApiResponse = {
  error?: GoogleApiErrorBody
}

type GoogleSheetsSpreadsheetResponse = GoogleSheetsApiResponse & {
  properties?: {
    title?: string
  }
  sheets?: unknown[]
  spreadsheetId?: string
  spreadsheetUrl?: string
}

type GoogleSheetsValuesBatchGetResponse = GoogleSheetsApiResponse & {
  spreadsheetId?: string
  valueRanges?: unknown[]
}

export type GoogleSheetsValueRenderOption = 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA'

export type GoogleDriveFileMetadata = {
  id: string
  mimeType: string
  modifiedTime: string | null
  name: string
  webViewLink: string | null
}

export type GoogleDriveSearchFilesResult = {
  files: GoogleDriveFileMetadata[]
}

export type GoogleDriveSearchFilesInput = {
  configPath?: string
  fetch?: Fetch
  limit?: number
  query: string
  signal?: AbortSignal
}

export type GoogleDocsReadDocumentResult = {
  document: GoogleDocDocumentArtifact
}

export type GoogleDocsReadDocumentInput = {
  configPath?: string
  documentId: string
  fetch?: Fetch
  signal?: AbortSignal
}

export type GoogleSheetsReadSpreadsheetResult = {
  spreadsheet: GoogleSheetSpreadsheetArtifact
}

export type GoogleSheetsReadSpreadsheetInput = {
  configPath?: string
  fetch?: Fetch
  ranges?: string[]
  signal?: AbortSignal
  spreadsheetId: string
  valueRenderOption?: GoogleSheetsValueRenderOption
}

export type GoogleDocsEditDocumentInput = {
  configPath?: string
  documentId: string
  fetch?: Fetch
  operation: GoogleDocsEditOperation
  signal?: AbortSignal
}

export type GoogleDocsEditOperation =
  | {
      text: string
      type: 'append_text'
    }
  | {
      match: string
      occurrence?: GoogleDocsTextOccurrence
      text: string
      type: 'insert_after_text'
    }
  | {
      match: string
      occurrence?: GoogleDocsTextOccurrence
      text: string
      type: 'insert_before_text'
    }
  | {
      match: string
      occurrence?: GoogleDocsTextOccurrence
      text: string
      type: 'replace_text'
    }
  | {
      match: string
      occurrence?: GoogleDocsTextOccurrence
      type: 'delete_text'
    }

export type GoogleDocsTextOccurrence = 'first' | 'last' | number

export type GoogleDocsEditDocumentResult = {
  document: GoogleDocDocumentArtifact
  edit: {
    documentId: string
    deletedTextLength: number
    insertedTextLength: number
    link: string | null
    ok: true
    operation: GoogleDocsEditOperation['type']
    revision: string | null
    textLengthDelta: number
    title: string | null
  }
}

type IndexedGoogleDocBodyBlock = {
  endIndex: number | null
  startIndex: number | null
  text: string
  textEndIndex: number | null
  textStartIndex: number | null
  type: 'paragraph'
}

type ResolvedGoogleDocsEditOperation =
  | {
      insertionIndex: number
      text: string
      type: 'append_text'
    }
  | {
      insertionIndex: number
      match: string
      matchEndIndex: number
      matchStartIndex: number
      occurrence: GoogleDocsTextOccurrence
      text: string
      type: 'insert_after_text'
    }
  | {
      insertionIndex: number
      match: string
      matchEndIndex: number
      matchStartIndex: number
      occurrence: GoogleDocsTextOccurrence
      text: string
      type: 'insert_before_text'
    }
  | {
      match: string
      matchEndIndex: number
      matchStartIndex: number
      occurrence: GoogleDocsTextOccurrence
      text: string
      type: 'replace_text'
    }
  | {
      match: string
      matchEndIndex: number
      matchStartIndex: number
      occurrence: GoogleDocsTextOccurrence
      type: 'delete_text'
    }

type GoogleDocsBatchUpdateRequestBody = {
  requests: GoogleDocsBatchUpdateRequest[]
  writeControl?: { requiredRevisionId: string }
}

type GoogleDocsBatchUpdateRequest =
  | {
      insertText: {
        location: { index: number }
        text: string
      }
    }
  | {
      deleteContentRange: {
        range: {
          endIndex: number
          startIndex: number
        }
      }
    }

type GoogleDocsTextMatchOperation = Exclude<GoogleDocsEditOperation, { type: 'append_text' }>

type GoogleDocsTextMatchCandidate = {
  matchEndIndex: number | null
  matchStartIndex: number | null
}

type GoogleWorkspaceAccessInput = {
  configPath: string | undefined
  disconnectedToolName: string
  expiredMessage: string
  fetch: Fetch
  missingScopeMessage: string
  requiredScope: string
  signal?: AbortSignal
}

export async function searchGoogleDriveFiles({
  configPath = process.env.OPENKHODAM_CONFIG_PATH,
  fetch: fetchImpl = fetch,
  limit,
  query,
  signal
}: GoogleDriveSearchFilesInput): Promise<GoogleDriveSearchFilesResult> {
  const { token } = await getGoogleWorkspaceAccessToken({
    configPath,
    disconnectedToolName: 'google_drive_search_files',
    expiredMessage:
      'Google Workspace token is expired. Reconnect Google Workspace in Settings to refresh Drive access.',
    fetch: fetchImpl,
    missingScopeMessage:
      'Google Drive access is not enabled. Reconnect Google Workspace in Settings to grant Drive metadata read-only access.',
    requiredScope: GOOGLE_DRIVE_METADATA_READONLY_SCOPE,
    signal
  })

  const resolvedLimit = clampDriveSearchLimit(limit)
  const response = await fetchImpl(createDriveFilesUrl(query, resolvedLimit), {
    headers: {
      authorization: `Bearer ${token.accessToken}`
    },
    signal
  })

  const body = (await response.json().catch(() => ({}))) as GoogleDriveFilesResponse
  if (!response.ok) {
    throwGoogleApiFailure('Google Drive files.list', response.status, body)
  }

  return {
    files: (body.files ?? []).map(toSafeDriveFileMetadata).filter(isGoogleDriveFileMetadata)
  }
}

export async function readGoogleDocDocument({
  configPath = process.env.OPENKHODAM_CONFIG_PATH,
  documentId,
  fetch: fetchImpl = fetch,
  signal
}: GoogleDocsReadDocumentInput): Promise<GoogleDocsReadDocumentResult> {
  const resolvedDocumentId = normalizeDocumentId(documentId)
  const { token } = await getGoogleWorkspaceAccessToken({
    configPath,
    disconnectedToolName: 'google_docs_read',
    expiredMessage:
      'Google Workspace token is expired. Reconnect Google Workspace in Settings to refresh Google Docs access.',
    fetch: fetchImpl,
    missingScopeMessage: docsMissingScopeMessage(),
    requiredScope: GOOGLE_DOCS_DOCUMENTS_SCOPE,
    signal
  })

  const result = await fetchGoogleDocDocument({
    documentId: resolvedDocumentId,
    fetch: fetchImpl,
    signal,
    token
  })

  return { document: result.document }
}

export async function readGoogleSheetSpreadsheet({
  configPath = process.env.OPENKHODAM_CONFIG_PATH,
  fetch: fetchImpl = fetch,
  ranges,
  signal,
  spreadsheetId,
  valueRenderOption
}: GoogleSheetsReadSpreadsheetInput): Promise<GoogleSheetsReadSpreadsheetResult> {
  const resolvedSpreadsheetId = normalizeSpreadsheetId(spreadsheetId)
  const resolvedValueRenderOption = normalizeGoogleSheetsValueRenderOption(valueRenderOption)
  const { token } = await getGoogleWorkspaceAccessToken({
    configPath,
    disconnectedToolName: 'google_sheets_read',
    expiredMessage:
      'Google Workspace token is expired. Reconnect Google Workspace in Settings to refresh Google Sheets access.',
    fetch: fetchImpl,
    missingScopeMessage: sheetsMissingScopeMessage(),
    requiredScope: GOOGLE_SHEETS_SPREADSHEETS_SCOPE,
    signal
  })

  const metadata = await fetchGoogleSheetSpreadsheetMetadata({
    fetch: fetchImpl,
    signal,
    spreadsheetId: resolvedSpreadsheetId,
    token
  })
  const resolvedRanges = normalizeGoogleSheetsReadRanges(
    ranges,
    createDefaultGoogleSheetsReadRanges(metadata)
  )
  const values = resolvedRanges.length
    ? await fetchGoogleSheetSpreadsheetValues({
        fetch: fetchImpl,
        ranges: resolvedRanges,
        signal,
        spreadsheetId: resolvedSpreadsheetId,
        token,
        valueRenderOption: resolvedValueRenderOption
      })
    : ({
        spreadsheetId: resolvedSpreadsheetId,
        valueRanges: []
      } satisfies GoogleSheetsValuesBatchGetResponse)

  return {
    spreadsheet: toSafeGoogleSheetSpreadsheet(
      metadata,
      values,
      resolvedSpreadsheetId,
      resolvedRanges
    )
  }
}

export async function editGoogleDocDocument({
  configPath = process.env.OPENKHODAM_CONFIG_PATH,
  documentId,
  fetch: fetchImpl = fetch,
  operation,
  signal
}: GoogleDocsEditDocumentInput): Promise<GoogleDocsEditDocumentResult> {
  const resolvedDocumentId = normalizeDocumentId(documentId)
  const normalizedOperation = normalizeGoogleDocsEditOperation(operation)
  const { token } = await getGoogleWorkspaceAccessToken({
    configPath,
    disconnectedToolName: 'google_docs_edit',
    expiredMessage:
      'Google Workspace token is expired. Reconnect Google Workspace in Settings to refresh Google Docs access.',
    fetch: fetchImpl,
    missingScopeMessage: docsMissingScopeMessage(),
    requiredScope: GOOGLE_DOCS_DOCUMENTS_SCOPE,
    signal
  })

  const current = await fetchGoogleDocDocument({
    documentId: resolvedDocumentId,
    fetch: fetchImpl,
    signal,
    token
  })
  const resolvedOperation = resolveGoogleDocsEditOperation(
    extractIndexedGoogleDocBodyBlocks(current.rawDocument),
    normalizedOperation,
    getBodyEndInsertionIndex(current.rawDocument)
  )

  const batchUpdateResponse = await fetchImpl(createDocsBatchUpdateUrl(resolvedDocumentId), {
    body: JSON.stringify(createGoogleDocsBatchUpdateRequest(current.document, resolvedOperation)),
    headers: {
      authorization: `Bearer ${token.accessToken}`,
      'content-type': 'application/json'
    },
    method: 'POST',
    signal
  })

  const batchUpdateBody = (await batchUpdateResponse
    .json()
    .catch(() => ({}))) as GoogleDocsBatchUpdateResponse
  if (!batchUpdateResponse.ok) {
    throwGoogleApiFailure(
      'Google Docs documents.batchUpdate',
      batchUpdateResponse.status,
      batchUpdateBody
    )
  }

  const updated = await fetchGoogleDocDocument({
    documentId: resolvedDocumentId,
    fetch: fetchImpl,
    signal,
    token
  })

  return {
    document: updated.document,
    edit: {
      deletedTextLength: getResolvedDeletedTextLength(resolvedOperation),
      documentId: updated.document.id || batchUpdateBody.documentId || current.document.id,
      insertedTextLength: getResolvedInsertedTextLength(resolvedOperation),
      link: updated.document.link,
      ok: true,
      operation: resolvedOperation.type,
      revision:
        updated.document.revision ??
        batchUpdateBody.writeControl?.targetRevisionId ??
        batchUpdateBody.writeControl?.requiredRevisionId ??
        current.document.revision,
      textLengthDelta: getResolvedTextLengthDelta(resolvedOperation),
      title: updated.document.title
    }
  }
}

export function clampDriveSearchLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return DEFAULT_DRIVE_SEARCH_LIMIT
  return Math.min(MAX_DRIVE_SEARCH_LIMIT, Math.max(1, Math.trunc(limit)))
}

export function createDriveFilesUrl(query: string, limit: number): URL {
  const url = new URL(GOOGLE_DRIVE_FILES_URL)
  url.searchParams.set('pageSize', String(clampDriveSearchLimit(limit)))
  url.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime,webViewLink)')
  url.searchParams.set('orderBy', 'modifiedTime desc')
  url.searchParams.set('spaces', 'drive')
  url.searchParams.set('q', createDriveQuery(query))
  return url
}

export function createDocsDocumentUrl(documentId: string): URL {
  const url = new URL(`${GOOGLE_DOCS_DOCUMENTS_URL}/${encodeURIComponent(documentId)}`)
  url.searchParams.set(
    'fields',
    'documentId,title,revisionId,body(content(startIndex,endIndex,paragraph(elements(startIndex,endIndex,textRun(content)))))'
  )
  return url
}

export function createDocsBatchUpdateUrl(documentId: string): URL {
  return new URL(`${GOOGLE_DOCS_DOCUMENTS_URL}/${encodeURIComponent(documentId)}:batchUpdate`)
}

export function createSheetsSpreadsheetMetadataUrl(spreadsheetId: string): URL {
  const url = new URL(`${GOOGLE_SHEETS_SPREADSHEETS_URL}/${encodeURIComponent(spreadsheetId)}`)
  url.searchParams.set(
    'fields',
    'spreadsheetId,properties(title),spreadsheetUrl,sheets(properties(sheetId,title,index,sheetType,hidden,gridProperties(rowCount,columnCount)))'
  )
  return url
}

export function createSheetsValuesBatchGetUrl({
  ranges,
  spreadsheetId,
  valueRenderOption
}: {
  ranges: string[]
  spreadsheetId: string
  valueRenderOption: GoogleSheetsValueRenderOption
}): URL {
  const url = new URL(
    `${GOOGLE_SHEETS_SPREADSHEETS_URL}/${encodeURIComponent(spreadsheetId)}/values:batchGet`
  )
  for (const range of ranges.slice(0, GOOGLE_SHEETS_MAX_READ_RANGES)) {
    url.searchParams.append('ranges', range)
  }
  url.searchParams.set('valueRenderOption', valueRenderOption)
  url.searchParams.set('fields', 'spreadsheetId,valueRanges(range,majorDimension,values)')
  return url
}

export function createGoogleDocDocumentPreview(
  document: GoogleDocDocumentArtifact
): GoogleDocDocumentPreviewArtifact {
  const blocks = limitGoogleDocBodyBlocksForPreview(document.body.blocks)
  const text = blocks
    .map((block) => block.text)
    .join('')
    .trimEnd()

  return {
    ...document,
    text,
    body: {
      blocks
    },
    preview: {
      truncated: text.length < document.text.length || blocks.length < document.body.blocks.length,
      totalTextLength: document.text.length,
      totalBlockCount: document.body.blocks.length,
      includedBlockCount: blocks.length
    }
  }
}

export function createGoogleSheetSpreadsheetPreview(
  spreadsheet: GoogleSheetSpreadsheetArtifact
): GoogleSheetSpreadsheetPreviewArtifact {
  const rangePreviews: GoogleSheetRangeArtifact[] = []
  const previewRanges: GoogleSheetRangePreviewMetadata[] = []
  let remainingTextLength = GOOGLE_SHEETS_PREVIEW_TEXT_LIMIT

  for (const range of spreadsheet.ranges) {
    const preview = limitGoogleSheetRangeForPreview(range, remainingTextLength)
    rangePreviews.push(preview.range)
    previewRanges.push(preview.metadata)
    remainingTextLength = Math.max(0, remainingTextLength - preview.metadata.includedTextLength)
  }

  const preview: GoogleSheetSpreadsheetPreviewMetadata = {
    truncated: previewRanges.some((range) => range.truncated),
    totalRangeCount: spreadsheet.ranges.length,
    includedRangeCount: rangePreviews.length,
    ranges: previewRanges
  }

  return {
    ...spreadsheet,
    ranges: rangePreviews,
    preview
  }
}

function normalizeDocumentId(documentId: string): string {
  const trimmed = documentId.trim()
  if (!trimmed) throw new Error('Google Docs document ID is required.')
  return trimmed
}

function normalizeSpreadsheetId(spreadsheetId: string): string {
  const trimmed = spreadsheetId.trim()
  if (!trimmed) throw new Error('Google Sheets spreadsheet ID is required.')
  return trimmed
}

async function fetchGoogleSheetSpreadsheetMetadata({
  fetch: fetchImpl,
  signal,
  spreadsheetId,
  token
}: {
  fetch: Fetch
  signal?: AbortSignal
  spreadsheetId: string
  token: GoogleWorkspaceTokenConfig
}): Promise<GoogleSheetsSpreadsheetResponse> {
  const response = await fetchImpl(createSheetsSpreadsheetMetadataUrl(spreadsheetId), {
    headers: {
      authorization: `Bearer ${token.accessToken}`
    },
    signal
  })

  const body = (await response.json().catch(() => ({}))) as GoogleSheetsSpreadsheetResponse
  if (!response.ok) {
    throwGoogleApiFailure('Google Sheets spreadsheets.get', response.status, body)
  }

  return body
}

async function fetchGoogleSheetSpreadsheetValues({
  fetch: fetchImpl,
  ranges,
  signal,
  spreadsheetId,
  token,
  valueRenderOption
}: {
  fetch: Fetch
  ranges: string[]
  signal?: AbortSignal
  spreadsheetId: string
  token: GoogleWorkspaceTokenConfig
  valueRenderOption: GoogleSheetsValueRenderOption
}): Promise<GoogleSheetsValuesBatchGetResponse> {
  const response = await fetchImpl(
    createSheetsValuesBatchGetUrl({ ranges, spreadsheetId, valueRenderOption }),
    {
      headers: {
        authorization: `Bearer ${token.accessToken}`
      },
      signal
    }
  )

  const body = (await response.json().catch(() => ({}))) as GoogleSheetsValuesBatchGetResponse
  if (!response.ok) {
    throwGoogleApiFailure('Google Sheets values.batchGet', response.status, body)
  }

  return body
}

async function fetchGoogleDocDocument({
  documentId,
  fetch: fetchImpl,
  signal,
  token
}: {
  documentId: string
  fetch: Fetch
  signal?: AbortSignal
  token: GoogleWorkspaceTokenConfig
}): Promise<GoogleDocsReadDocumentResult & { rawDocument: GoogleDocsDocumentResponse }> {
  const response = await fetchImpl(createDocsDocumentUrl(documentId), {
    headers: {
      authorization: `Bearer ${token.accessToken}`
    },
    signal
  })

  const body = (await response.json().catch(() => ({}))) as GoogleDocsDocumentResponse
  if (!response.ok) {
    throwGoogleApiFailure('Google Docs documents.get', response.status, body)
  }

  return {
    document: toSafeGoogleDocDocument(body, documentId),
    rawDocument: body
  }
}

function normalizeGoogleDocsEditOperation(
  operation: GoogleDocsEditOperation
): GoogleDocsEditOperation {
  if (!operation || typeof operation !== 'object') {
    throw new Error('Google Docs edit operation is required.')
  }

  if (operation.type === 'append_text') {
    return {
      text: normalizeGoogleDocsEditText(operation.text),
      type: 'append_text'
    }
  }

  if (operation.type === 'insert_after_text') {
    return {
      match: normalizeGoogleDocsMatchText(operation.match, operation.type),
      occurrence: normalizeTextOccurrence(operation.occurrence, operation.type),
      text: normalizeGoogleDocsEditText(operation.text),
      type: 'insert_after_text'
    }
  }

  if (operation.type === 'insert_before_text') {
    return {
      match: normalizeGoogleDocsMatchText(operation.match, operation.type),
      occurrence: normalizeTextOccurrence(operation.occurrence, operation.type),
      text: normalizeGoogleDocsEditText(operation.text),
      type: 'insert_before_text'
    }
  }

  if (operation.type === 'replace_text') {
    return {
      match: normalizeGoogleDocsMatchText(operation.match, operation.type),
      occurrence: normalizeTextOccurrence(operation.occurrence, operation.type),
      text: normalizeGoogleDocsEditText(operation.text),
      type: 'replace_text'
    }
  }

  if (operation.type === 'delete_text') {
    return {
      match: normalizeGoogleDocsMatchText(operation.match, operation.type),
      occurrence: normalizeTextOccurrence(operation.occurrence, operation.type),
      type: 'delete_text'
    }
  }

  throw new Error(
    'Google Docs edit operation type must be append_text, insert_after_text, insert_before_text, replace_text, or delete_text.'
  )
}

function normalizeGoogleDocsMatchText(
  match: unknown,
  operationType: GoogleDocsTextMatchOperation['type']
): string {
  const normalized = typeof match === 'string' ? match : ''
  if (!normalized) throw new Error(`Google Docs ${operationType} requires match text.`)

  return normalized
}

function normalizeGoogleDocsEditText(text: string): string {
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('Text to insert or replace in the Google Doc is required.')
  }

  return text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

function normalizeTextOccurrence(
  occurrence: unknown,
  operationType: GoogleDocsTextMatchOperation['type']
): GoogleDocsTextOccurrence {
  if (occurrence === undefined || occurrence === null || occurrence === '') return 'last'
  if (occurrence === 'first' || occurrence === 'last') return occurrence

  const numericOccurrence =
    typeof occurrence === 'number'
      ? occurrence
      : typeof occurrence === 'string'
        ? Number(occurrence.trim())
        : NaN

  if (Number.isInteger(numericOccurrence) && numericOccurrence > 0) return numericOccurrence

  throw new Error(
    `Google Docs ${operationType} occurrence must be first, last, or a 1-based number.`
  )
}

function createGoogleDocsBatchUpdateRequest(
  document: GoogleDocDocumentArtifact,
  operation: ResolvedGoogleDocsEditOperation
): GoogleDocsBatchUpdateRequestBody {
  const request: GoogleDocsBatchUpdateRequestBody = {
    requests: createGoogleDocsBatchUpdateRequests(operation)
  }

  if (document.revision) {
    request.writeControl = { requiredRevisionId: document.revision }
  }

  return request
}

function createGoogleDocsBatchUpdateRequests(
  operation: ResolvedGoogleDocsEditOperation
): GoogleDocsBatchUpdateRequest[] {
  if (
    operation.type === 'append_text' ||
    operation.type === 'insert_after_text' ||
    operation.type === 'insert_before_text'
  ) {
    return [
      {
        insertText: {
          location: { index: operation.insertionIndex },
          text: operation.text
        }
      }
    ]
  }

  if (operation.type === 'delete_text') {
    return [createDeleteContentRangeRequest(operation.matchStartIndex, operation.matchEndIndex)]
  }

  return [
    createDeleteContentRangeRequest(operation.matchStartIndex, operation.matchEndIndex),
    {
      insertText: {
        location: { index: operation.matchStartIndex },
        text: operation.text
      }
    }
  ]
}

function createDeleteContentRangeRequest(
  startIndex: number,
  endIndex: number
): GoogleDocsBatchUpdateRequest {
  return {
    deleteContentRange: {
      range: {
        endIndex,
        startIndex
      }
    }
  }
}

function getResolvedInsertedTextLength(operation: ResolvedGoogleDocsEditOperation): number {
  return 'text' in operation ? operation.text.length : 0
}

function getResolvedDeletedTextLength(operation: ResolvedGoogleDocsEditOperation): number {
  if (operation.type !== 'delete_text' && operation.type !== 'replace_text') return 0

  return operation.matchEndIndex - operation.matchStartIndex
}

function getResolvedTextLengthDelta(operation: ResolvedGoogleDocsEditOperation): number {
  return getResolvedInsertedTextLength(operation) - getResolvedDeletedTextLength(operation)
}

function createDriveQuery(query: string): string {
  const trimmed = query.trim()
  if (!trimmed) return 'trashed = false'

  return `name contains '${escapeDriveQueryString(trimmed)}' and trashed = false`
}

function escapeDriveQueryString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function hasScope(scopes: string[], requiredScope: string): boolean {
  return scopes.includes(requiredScope)
}

function sortScopes(scopes: string[]): string[] {
  return [...new Set(scopes)].sort()
}

function isUsableAccessToken(token: GoogleWorkspaceTokenConfig): boolean {
  return typeof token.accessToken === 'string' && token.accessToken.trim().length > 0
}

function isTokenExpired(token: GoogleWorkspaceTokenConfig, now: number): boolean {
  return typeof token.expiresAt === 'number' && token.expiresAt <= now + TOKEN_EXPIRY_SKEW_MS
}

async function getGoogleWorkspaceAccessToken({
  configPath,
  disconnectedToolName,
  expiredMessage,
  fetch: fetchImpl,
  missingScopeMessage,
  requiredScope,
  signal
}: GoogleWorkspaceAccessInput): Promise<{ token: GoogleWorkspaceTokenConfig }> {
  const resolvedConfigPath = configPath?.trim()
  if (!resolvedConfigPath) {
    throw new Error('Google Workspace config path is missing. Restart OpenKhodam and try again.')
  }

  const store = new OpenKhodamConfigFileStore(resolvedConfigPath)
  const config = await store.read()
  const google = config.integrations.googleWorkspace

  if (!google.account || !google.token || !isUsableAccessToken(google.token)) {
    throw new Error(
      `Google Workspace is disconnected. Connect Google Workspace in Settings before using ${disconnectedToolName}.`
    )
  }

  if (!hasScope(google.scopes, requiredScope)) {
    throw new Error(missingScopeMessage)
  }

  const now = Date.now()
  let token = google.token

  if (isTokenExpired(token, now)) {
    if (!token.refreshToken) {
      throw new Error(expiredMessage)
    }

    const refreshed = await refreshAccessToken({
      fetch: fetchImpl,
      refreshToken: token.refreshToken,
      signal,
      token
    })

    if (refreshed.scopes.length > 0 && !hasScope(refreshed.scopes, requiredScope)) {
      throw new Error(missingScopeMessage)
    }

    token = refreshed.token
    config.integrations.googleWorkspace = {
      ...google,
      scopes: refreshed.scopes.length > 0 ? sortScopes(refreshed.scopes) : google.scopes,
      token,
      updatedAt: now
    }
    await store.write(config)
  }

  return { token }
}

async function refreshAccessToken({
  fetch: fetchImpl,
  refreshToken,
  signal,
  token
}: {
  fetch: Fetch
  refreshToken: string
  signal?: AbortSignal
  token: GoogleWorkspaceTokenConfig
}): Promise<{ scopes: string[]; token: GoogleWorkspaceTokenConfig }> {
  const clientId = process.env.OPENKHODAM_GOOGLE_OAUTH_CLIENT_ID?.trim()
  const clientSecret = process.env.OPENKHODAM_GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) {
    throw new Error(
      'Google OAuth client ID or client secret is not configured. Configure it and reconnect Google Workspace in Settings.'
    )
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  })
  const response = await fetchImpl(GOOGLE_TOKEN_URL, { method: 'POST', body, signal })
  const payload = (await response.json().catch(() => ({}))) as GoogleTokenRefreshResponse

  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description ||
        payload.error ||
        'Google OAuth token refresh failed. Reconnect Google Workspace in Settings.'
    )
  }

  return {
    scopes: parseScopes(payload.scope),
    token: {
      accessToken: payload.access_token,
      expiresAt:
        typeof payload.expires_in === 'number' ? Date.now() + payload.expires_in * 1000 : null,
      idToken: payload.id_token ?? token.idToken,
      refreshToken: payload.refresh_token ?? token.refreshToken,
      tokenType: payload.token_type ?? token.tokenType
    }
  }
}

function parseScopes(scope: string | undefined): string[] {
  return scope?.split(' ').filter(Boolean) ?? []
}

function docsMissingScopeMessage(): string {
  return 'Google Docs access is not enabled. Reconnect Google Workspace in Settings to grant Google Docs read/write access.'
}

function sheetsMissingScopeMessage(): string {
  return 'Google Sheets access is not enabled. Reconnect Google Workspace in Settings with Sheets access enabled.'
}

function normalizeGoogleSheetsValueRenderOption(value: unknown): GoogleSheetsValueRenderOption {
  if (value === undefined || value === null || value === '') return 'FORMATTED_VALUE'
  if (isGoogleSheetsValueRenderOption(value)) return value

  throw new Error(
    'Google Sheets valueRenderOption must be FORMATTED_VALUE, UNFORMATTED_VALUE, or FORMULA.'
  )
}

function isGoogleSheetsValueRenderOption(value: unknown): value is GoogleSheetsValueRenderOption {
  return (
    typeof value === 'string' &&
    (GOOGLE_SHEETS_VALUE_RENDER_OPTIONS as readonly string[]).includes(value)
  )
}

function normalizeGoogleSheetsReadRanges(
  ranges: string[] | undefined,
  defaultRanges: string[]
): string[] {
  if (!Array.isArray(ranges) || ranges.length === 0) {
    return defaultRanges.slice(0, GOOGLE_SHEETS_MAX_READ_RANGES)
  }

  const normalized = ranges.map((range) => (typeof range === 'string' ? range.trim() : ''))
  if (normalized.some((range) => !range)) {
    throw new Error('Google Sheets ranges must be non-empty A1 notation strings.')
  }

  return normalized.slice(0, GOOGLE_SHEETS_MAX_READ_RANGES)
}

function createDefaultGoogleSheetsReadRanges(metadata: GoogleSheetsSpreadsheetResponse): string[] {
  return extractGoogleSheetSheetArtifacts(metadata)
    .filter((sheet) => !sheet.hidden)
    .filter((sheet) => sheet.sheetType === null || sheet.sheetType === 'GRID')
    .sort(
      (left, right) =>
        (left.index ?? Number.MAX_SAFE_INTEGER) - (right.index ?? Number.MAX_SAFE_INTEGER)
    )
    .slice(0, GOOGLE_SHEETS_MAX_READ_RANGES)
    .map((sheet) => `${quoteGoogleSheetTitleForA1(sheet.title)}!${GOOGLE_SHEETS_DEFAULT_RANGE_A1}`)
}

function quoteGoogleSheetTitleForA1(title: string): string {
  return `'${title.replace(/'/g, "''")}'`
}

function toSafeGoogleSheetSpreadsheet(
  metadata: GoogleSheetsSpreadsheetResponse,
  values: GoogleSheetsValuesBatchGetResponse,
  fallbackSpreadsheetId: string,
  requestedRanges: string[]
): GoogleSheetSpreadsheetArtifact {
  const id =
    typeof metadata.spreadsheetId === 'string' && metadata.spreadsheetId
      ? metadata.spreadsheetId
      : typeof values.spreadsheetId === 'string' && values.spreadsheetId
        ? values.spreadsheetId
        : fallbackSpreadsheetId

  return {
    type: 'google.sheet.spreadsheet',
    id,
    title: normalizeOptionalGoogleApiString(metadata.properties?.title),
    link: normalizeOptionalGoogleApiString(metadata.spreadsheetUrl) ?? createGoogleSheetLink(id),
    sheets: extractGoogleSheetSheetArtifacts(metadata),
    ranges: extractGoogleSheetRangeArtifacts(values, requestedRanges)
  }
}

function extractGoogleSheetSheetArtifacts(
  metadata: GoogleSheetsSpreadsheetResponse
): GoogleSheetSheetArtifact[] {
  const sheets = Array.isArray(metadata.sheets) ? metadata.sheets : []
  return sheets.flatMap((sheet) => {
    if (!sheet || typeof sheet !== 'object') return []

    const properties = (sheet as Record<string, unknown>).properties
    if (!properties || typeof properties !== 'object') return []

    const propertyRecord = properties as Record<string, unknown>
    const title = normalizeOptionalGoogleApiString(propertyRecord.title)
    if (!title) return []

    const gridProperties = isRecord(propertyRecord.gridProperties)
      ? propertyRecord.gridProperties
      : {}

    return [
      {
        id: finiteNumberOrNull(propertyRecord.sheetId),
        title,
        index: finiteNumberOrNull(propertyRecord.index),
        hidden: propertyRecord.hidden === true,
        sheetType: normalizeOptionalGoogleApiString(propertyRecord.sheetType),
        rowCount: finiteNumberOrNull(gridProperties.rowCount),
        columnCount: finiteNumberOrNull(gridProperties.columnCount)
      }
    ]
  })
}

function extractGoogleSheetRangeArtifacts(
  values: GoogleSheetsValuesBatchGetResponse,
  requestedRanges: string[]
): GoogleSheetRangeArtifact[] {
  const valueRanges = Array.isArray(values.valueRanges) ? values.valueRanges : []
  return requestedRanges
    .slice(0, GOOGLE_SHEETS_MAX_READ_RANGES)
    .map((requestedRange, index) =>
      toSafeGoogleSheetRangeArtifact(valueRanges[index], requestedRange)
    )
}

function toSafeGoogleSheetRangeArtifact(
  value: unknown,
  fallbackRange: string
): GoogleSheetRangeArtifact {
  const valueRange = isRecord(value) ? value : {}
  const range = normalizeOptionalGoogleApiString(valueRange.range) ?? fallbackRange
  const rawValues = Array.isArray(valueRange.values) ? valueRange.values : []
  const normalized = normalizeGoogleSheetValues(rawValues)

  return {
    range,
    majorDimension: normalizeOptionalGoogleApiString(valueRange.majorDimension),
    values: normalized.values,
    rowCount: normalized.values.length,
    columnCount: maxFiniteNumber(normalized.values.map((row) => row.length)) ?? 0,
    cellCount: normalized.values.reduce((count, row) => count + row.length, 0),
    truncated: normalized.truncated
  }
}

function normalizeGoogleSheetValues(values: unknown[]): {
  truncated: boolean
  values: GoogleSheetCellValue[][]
} {
  const normalizedValues: GoogleSheetCellValue[][] = []
  let remainingTextLength = GOOGLE_SHEETS_MAX_ARTIFACT_TEXT_LENGTH
  let truncated = values.length > GOOGLE_SHEETS_MAX_RANGE_ROWS

  for (const row of values.slice(0, GOOGLE_SHEETS_MAX_RANGE_ROWS)) {
    if (!Array.isArray(row)) continue
    const normalizedRow: GoogleSheetCellValue[] = []
    if (row.length > GOOGLE_SHEETS_MAX_RANGE_COLUMNS) truncated = true

    for (const cell of row.slice(0, GOOGLE_SHEETS_MAX_RANGE_COLUMNS)) {
      const normalizedCell = normalizeGoogleSheetCellValue(cell, remainingTextLength)
      normalizedRow.push(normalizedCell.value)
      remainingTextLength = Math.max(0, remainingTextLength - normalizedCell.textLength)
      if (normalizedCell.truncated) truncated = true
    }

    normalizedValues.push(normalizedRow)
  }

  return { values: normalizedValues, truncated }
}

function normalizeGoogleSheetCellValue(
  value: unknown,
  remainingTextLength: number
): { textLength: number; truncated: boolean; value: GoogleSheetCellValue } {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { textLength: String(value).length, truncated: false, value }
  }
  if (typeof value === 'boolean') {
    return { textLength: String(value).length, truncated: false, value }
  }
  if (value === null || value === undefined) {
    return { textLength: 0, truncated: false, value: null }
  }

  const text = typeof value === 'string' ? value : String(value)
  const maxLength = Math.min(GOOGLE_SHEETS_MAX_CELL_TEXT_LENGTH, Math.max(0, remainingTextLength))
  const normalizedText = text.slice(0, maxLength)
  return {
    textLength: normalizedText.length,
    truncated: normalizedText.length < text.length,
    value: normalizedText
  }
}

function limitGoogleSheetRangeForPreview(
  range: GoogleSheetRangeArtifact,
  remainingTextLength: number
): {
  metadata: GoogleSheetRangePreviewMetadata
  range: GoogleSheetRangeArtifact
} {
  const values: GoogleSheetCellValue[][] = []
  const totalTextLength = getGoogleSheetValuesTextLength(range.values)
  let includedTextLength = 0
  let truncated = range.truncated || range.values.length > GOOGLE_SHEETS_PREVIEW_ROW_LIMIT

  const rowsForPreview = range.values.slice(0, GOOGLE_SHEETS_PREVIEW_ROW_LIMIT)
  for (let rowIndex = 0; rowIndex < rowsForPreview.length; rowIndex += 1) {
    const row = rowsForPreview[rowIndex]
    if (remainingTextLength <= 0) {
      truncated = true
      break
    }

    const previewRow: GoogleSheetCellValue[] = []
    for (let cellIndex = 0; cellIndex < row.length; cellIndex += 1) {
      const cell = row[cellIndex]
      const previewCell = limitGoogleSheetCellForPreview(cell, remainingTextLength)
      previewRow.push(previewCell.value)
      remainingTextLength = Math.max(0, remainingTextLength - previewCell.textLength)
      includedTextLength += previewCell.textLength
      if (previewCell.truncated) truncated = true
      if (remainingTextLength <= 0) {
        if (
          previewCell.textLength < getGoogleSheetCellTextLength(cell) ||
          cellIndex < row.length - 1 ||
          rowIndex < rowsForPreview.length - 1 ||
          range.values.length > rowsForPreview.length
        ) {
          truncated = true
        }
        break
      }
    }
    values.push(previewRow)
  }

  const previewRange = {
    ...range,
    values,
    rowCount: values.length,
    columnCount: maxFiniteNumber(values.map((row) => row.length)) ?? 0,
    cellCount: values.reduce((count, row) => count + row.length, 0),
    truncated
  }

  return {
    range: previewRange,
    metadata: {
      range: range.range,
      truncated,
      totalRowCount: range.rowCount,
      totalColumnCount: range.columnCount,
      totalCellCount: range.cellCount,
      totalTextLength,
      includedRowCount: previewRange.rowCount,
      includedCellCount: previewRange.cellCount,
      includedTextLength
    }
  }
}

function limitGoogleSheetCellForPreview(
  value: GoogleSheetCellValue,
  remainingTextLength: number
): { textLength: number; truncated: boolean; value: GoogleSheetCellValue } {
  if (typeof value !== 'string') {
    return {
      textLength: getGoogleSheetCellTextLength(value),
      truncated: false,
      value
    }
  }

  const normalizedText = value.slice(0, Math.max(0, remainingTextLength))
  return {
    textLength: normalizedText.length,
    truncated: normalizedText.length < value.length,
    value: normalizedText
  }
}

function getGoogleSheetValuesTextLength(values: GoogleSheetCellValue[][]): number {
  return values.reduce<number>(
    (total, row) =>
      total +
      row.reduce<number>((rowTotal, cell) => rowTotal + getGoogleSheetCellTextLength(cell), 0),
    0
  )
}

function getGoogleSheetCellTextLength(value: GoogleSheetCellValue): number {
  if (value === null) return 0
  return String(value).length
}

function normalizeOptionalGoogleApiString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function toSafeDriveFileMetadata(value: unknown): GoogleDriveFileMetadata | null {
  if (!value || typeof value !== 'object') return null

  const file = value as Record<string, unknown>
  if (typeof file.id !== 'string') return null
  if (typeof file.name !== 'string') return null
  if (typeof file.mimeType !== 'string') return null

  return {
    id: file.id,
    mimeType: file.mimeType,
    modifiedTime: typeof file.modifiedTime === 'string' ? file.modifiedTime : null,
    name: file.name,
    webViewLink: typeof file.webViewLink === 'string' ? file.webViewLink : null
  }
}

function isGoogleDriveFileMetadata(
  value: GoogleDriveFileMetadata | null
): value is GoogleDriveFileMetadata {
  return value !== null
}

function toSafeGoogleDocDocument(
  value: GoogleDocsDocumentResponse,
  fallbackDocumentId: string
): GoogleDocDocumentArtifact {
  const id =
    typeof value.documentId === 'string' && value.documentId ? value.documentId : fallbackDocumentId
  const text = extractGoogleDocText(value)
  return {
    type: 'google.doc.document',
    id,
    title: typeof value.title === 'string' && value.title ? value.title : null,
    revision: typeof value.revisionId === 'string' && value.revisionId ? value.revisionId : null,
    text,
    link: createGoogleDocLink(id),
    body: {
      blocks: extractGoogleDocBodyBlocks(value)
    }
  }
}

function extractGoogleDocText(document: GoogleDocsDocumentResponse): string {
  const content = Array.isArray(document.body?.content) ? document.body.content : []
  return content
    .flatMap((block) => extractParagraphText(block))
    .join('')
    .trimEnd()
}

function extractParagraphText(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  const paragraph = (value as Record<string, unknown>).paragraph
  if (!paragraph || typeof paragraph !== 'object') return []
  const elements = (paragraph as Record<string, unknown>).elements
  if (!Array.isArray(elements)) return []
  return elements.flatMap((element) => {
    if (!element || typeof element !== 'object') return []
    const textRun = (element as Record<string, unknown>).textRun
    if (!textRun || typeof textRun !== 'object') return []
    const text = (textRun as Record<string, unknown>).content
    return typeof text === 'string' ? [text] : []
  })
}

function extractGoogleDocBodyBlocks(document: GoogleDocsDocumentResponse): GoogleDocBodyBlock[] {
  const content = Array.isArray(document.body?.content) ? document.body.content : []
  return content.flatMap((block, index) => {
    if (!block || typeof block !== 'object') return []

    const entry = block as Record<string, unknown>
    const paragraph = entry.paragraph
    if (!paragraph || typeof paragraph !== 'object') return []

    const textRuns = extractParagraphTextRuns(paragraph)
    const text = textRuns.map((run) => run.text).join('')
    return [
      {
        id: `body-block-${index + 1}`,
        ordinal: index + 1,
        type: 'paragraph' as const,
        text
      }
    ]
  })
}

function extractIndexedGoogleDocBodyBlocks(
  document: GoogleDocsDocumentResponse
): IndexedGoogleDocBodyBlock[] {
  const content = Array.isArray(document.body?.content) ? document.body.content : []
  return content.flatMap((block) => {
    if (!block || typeof block !== 'object') return []

    const entry = block as Record<string, unknown>
    const paragraph = entry.paragraph
    if (!paragraph || typeof paragraph !== 'object') return []

    const textRuns = extractParagraphTextRuns(paragraph)
    const text = textRuns.map((run) => run.text).join('')
    return [
      {
        endIndex: finiteNumberOrNull(entry.endIndex),
        startIndex: finiteNumberOrNull(entry.startIndex),
        text,
        textEndIndex: maxFiniteNumber(textRuns.map((run) => run.endIndex)),
        textStartIndex: minFiniteNumber(textRuns.map((run) => run.startIndex)),
        type: 'paragraph' as const
      }
    ]
  })
}

function limitGoogleDocBodyBlocksForPreview(blocks: GoogleDocBodyBlock[]): GoogleDocBodyBlock[] {
  const previewBlocks: GoogleDocBodyBlock[] = []
  let remainingTextLength = GOOGLE_DOCS_READ_PREVIEW_TEXT_LIMIT

  for (const block of blocks.slice(0, GOOGLE_DOCS_READ_PREVIEW_BLOCK_LIMIT)) {
    if (remainingTextLength <= 0) break

    if (block.text.length <= remainingTextLength) {
      previewBlocks.push(block)
      remainingTextLength -= block.text.length
      continue
    }

    previewBlocks.push({
      ...block,
      text: block.text.slice(0, remainingTextLength)
    })
    break
  }

  return previewBlocks
}

function extractParagraphTextRuns(value: unknown): Array<{
  endIndex: number | null
  startIndex: number | null
  text: string
}> {
  if (!value || typeof value !== 'object') return []

  const elements = (value as Record<string, unknown>).elements
  if (!Array.isArray(elements)) return []

  return elements.flatMap((element) => {
    if (!element || typeof element !== 'object') return []

    const entry = element as Record<string, unknown>
    const textRun = entry.textRun
    if (!textRun || typeof textRun !== 'object') return []

    const text = (textRun as Record<string, unknown>).content
    if (typeof text !== 'string') return []

    return [
      {
        endIndex: finiteNumberOrNull(entry.endIndex),
        startIndex: finiteNumberOrNull(entry.startIndex),
        text
      }
    ]
  })
}

function resolveGoogleDocsEditOperation(
  indexedBlocks: IndexedGoogleDocBodyBlock[],
  operation: GoogleDocsEditOperation,
  appendInsertionIndex: number
): ResolvedGoogleDocsEditOperation {
  if (operation.type === 'append_text') {
    return {
      insertionIndex: appendInsertionIndex,
      text: operation.text,
      type: 'append_text'
    }
  }

  return resolveTextMatchOperation(indexedBlocks, operation)
}

function resolveTextMatchOperation(
  indexedBlocks: IndexedGoogleDocBodyBlock[],
  operation: GoogleDocsTextMatchOperation
): ResolvedGoogleDocsEditOperation {
  const matches = indexedBlocks.flatMap((block) => findBlockMatchCandidates(block, operation.match))
  if (!matches.length) {
    throw new Error(`Google Docs ${operation.type} could not find the requested match text.`)
  }

  const occurrence = operation.occurrence ?? 'last'
  const match = selectTextMatch(matches, occurrence, operation.type)
  if (match.matchEndIndex === null || match.matchStartIndex === null) {
    throw new Error(
      `Google Docs ${operation.type} matched text in an unsupported paragraph structure.`
    )
  }

  const resolvedMatch = {
    match: operation.match,
    matchEndIndex: match.matchEndIndex,
    matchStartIndex: match.matchStartIndex,
    occurrence
  }

  if (operation.type === 'insert_after_text') {
    return {
      ...resolvedMatch,
      insertionIndex: match.matchEndIndex,
      text: operation.text,
      type: 'insert_after_text'
    }
  }

  if (operation.type === 'insert_before_text') {
    return {
      ...resolvedMatch,
      insertionIndex: match.matchStartIndex,
      text: operation.text,
      type: 'insert_before_text'
    }
  }

  if (operation.type === 'replace_text') {
    return {
      ...resolvedMatch,
      text: operation.text,
      type: 'replace_text'
    }
  }

  return {
    ...resolvedMatch,
    type: 'delete_text'
  }
}

function findBlockMatchCandidates(
  block: IndexedGoogleDocBodyBlock,
  matchText: string
): GoogleDocsTextMatchCandidate[] {
  const baseTextStartIndex = getContiguousTextStartIndex(block)
  const matches = [] as GoogleDocsTextMatchCandidate[]
  let searchIndex = 0

  while (searchIndex <= block.text.length) {
    const matchOffset = block.text.indexOf(matchText, searchIndex)
    if (matchOffset === -1) break

    const matchStartIndex = baseTextStartIndex === null ? null : baseTextStartIndex + matchOffset
    const matchEndIndex = matchStartIndex === null ? null : matchStartIndex + matchText.length
    matches.push({
      matchEndIndex,
      matchStartIndex
    })
    searchIndex = matchOffset + Math.max(1, matchText.length)
  }

  return matches
}

function getContiguousTextStartIndex(block: IndexedGoogleDocBodyBlock): number | null {
  if (
    block.textStartIndex !== null &&
    block.textEndIndex !== null &&
    block.textEndIndex - block.textStartIndex === block.text.length
  ) {
    return block.textStartIndex
  }

  return null
}

function selectTextMatch<T>(
  matches: T[],
  occurrence: GoogleDocsTextOccurrence,
  operationType: GoogleDocsTextMatchOperation['type']
): T {
  const match =
    occurrence === 'first'
      ? matches[0]
      : occurrence === 'last'
        ? matches[matches.length - 1]
        : matches[occurrence - 1]

  if (!match) {
    throw new Error(`Google Docs ${operationType} occurrence ${occurrence} was not found.`)
  }

  return match
}

function getBodyEndInsertionIndex(document: GoogleDocsDocumentResponse): number {
  const content = Array.isArray(document.body?.content) ? document.body.content : []
  const endIndexes = content
    .map((block) =>
      block && typeof block === 'object' ? (block as Record<string, unknown>).endIndex : null
    )
    .filter((index): index is number => typeof index === 'number' && Number.isFinite(index))
  if (!endIndexes.length) {
    throw new Error('Google Docs append_text could not resolve the document body end.')
  }

  const maxEndIndex = Math.max(...endIndexes)
  return Math.max(1, maxEndIndex - 1)
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function minFiniteNumber(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => value !== null)
  return finite.length ? Math.min(...finite) : null
}

function maxFiniteNumber(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => value !== null)
  return finite.length ? Math.max(...finite) : null
}

function throwGoogleApiFailure(
  operation: string,
  status: number,
  body: GoogleDocsApiResponse | GoogleDriveFilesResponse | GoogleSheetsApiResponse
): never {
  const diagnostics = toGoogleApiFailureDiagnostics(operation, status, body.error)
  console.warn('Google Workspace API request failed', diagnostics)
  throw new Error(toGoogleApiFailureMessage(diagnostics))
}

function toGoogleApiFailureDiagnostics(
  operation: string,
  status: number,
  error: GoogleApiErrorBody | undefined
): {
  code: string | null
  message: string | null
  operation: string
  reason: string | null
  status: number
} {
  const firstError = Array.isArray(error?.errors) ? error?.errors.find(Boolean) : undefined
  return {
    operation,
    status,
    code: sanitizeDiagnosticText(error?.status ?? error?.code),
    reason: sanitizeDiagnosticText(firstError?.reason),
    message: sanitizeDiagnosticText(error?.message ?? firstError?.message)
  }
}

function toGoogleApiFailureMessage(input: {
  code: string | null
  message: string | null
  operation: string
  reason: string | null
  status: number
}): string {
  const details = [`HTTP ${input.status}`, input.code, input.reason].filter(
    (detail): detail is string => typeof detail === 'string' && detail.length > 0
  )
  const suffix = details.length ? ` (${details.join(', ')})` : ''
  return input.message
    ? `${input.operation} failed${suffix}: ${input.message}`
    : `${input.operation} failed${suffix}.`
}

function sanitizeDiagnosticText(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value).replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length > 300 ? `${text.slice(0, 297)}...` : text
}

function createGoogleDocLink(documentId: string): string | null {
  return documentId
    ? `https://docs.google.com/document/d/${encodeURIComponent(documentId)}/edit`
    : null
}

function createGoogleSheetLink(spreadsheetId: string): string | null {
  return spreadsheetId
    ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`
    : null
}
