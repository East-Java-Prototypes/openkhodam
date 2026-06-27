import type { GoogleWorkspaceTokenConfig } from './openkhodam-config'
import { OpenKhodamConfigFileStore } from './openkhodam-config'

export const GOOGLE_DRIVE_METADATA_READONLY_SCOPE =
  'https://www.googleapis.com/auth/drive.metadata.readonly'
export const GOOGLE_DOCS_DOCUMENTS_SCOPE = 'https://www.googleapis.com/auth/documents'

const GOOGLE_DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const GOOGLE_DOCS_DOCUMENTS_URL = 'https://docs.googleapis.com/v1/documents'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const DEFAULT_DRIVE_SEARCH_LIMIT = 10
const MAX_DRIVE_SEARCH_LIMIT = 20
const TOKEN_EXPIRY_SKEW_MS = 60 * 1000

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

export type GoogleDocDocumentArtifact = {
  type: 'google.doc.document'
  id: string
  title: string | null
  revision: string | null
  text: string
  markdown: string
  link: string | null
  body: {
    blocks: GoogleDocBodyBlock[]
  }
}

export type GoogleDocBodyBlock = {
  id: string
  ordinal: number
  type: 'paragraph'
  text: string
  markdown: string
}

type IndexedGoogleDocBodyBlock = {
  type: 'paragraph'
  startIndex: number | null
  endIndex: number | null
  textStartIndex: number | null
  textEndIndex: number | null
  text: string
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

export type GoogleDocsEditInput = {
  approve: (input: GoogleDocsEditApprovalInput) => Promise<void>
  configPath?: string
  documentId: string
  fetch?: Fetch
  operation: GoogleDocsEditOperation
  signal?: AbortSignal
}

export type GoogleDocsEditApprovalInput = {
  document: GoogleDocDocumentArtifact
  operation: GoogleDocsEditApprovalOperation
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

export type GoogleDocsTextOccurrence = 'first' | 'last' | number

export type GoogleDocsEditApprovalOperation =
  | {
      text: string
      type: 'append_text'
    }
  | {
      match: string
      occurrence: GoogleDocsTextOccurrence
      text: string
      type: 'insert_after_text'
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

export type GoogleDocsEditResult = {
  ok: true
  documentId: string
  insertedTextLength: number
  link: string | null
  operation: GoogleDocsEditOperation['type']
  revision: string | null
  title: string | null
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

  const response = await fetchImpl(createDocsDocumentUrl(resolvedDocumentId), {
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
    document: toSafeGoogleDocDocument(body, resolvedDocumentId)
  }
}

export async function editGoogleDocDocument({
  approve,
  configPath = process.env.OPENKHODAM_CONFIG_PATH,
  documentId,
  fetch: fetchImpl = fetch,
  operation,
  signal
}: GoogleDocsEditInput): Promise<GoogleDocsEditResult> {
  if (typeof approve !== 'function') {
    throw new Error('Google Docs edit requires approval before writing to Google Docs.')
  }

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

  const documentResponse = await fetchImpl(createDocsDocumentUrl(resolvedDocumentId), {
    headers: {
      authorization: `Bearer ${token.accessToken}`
    },
    signal
  })
  const documentBody = (await documentResponse
    .json()
    .catch(() => ({}))) as GoogleDocsDocumentResponse
  if (!documentResponse.ok) {
    throwGoogleApiFailure('Google Docs documents.get', documentResponse.status, documentBody)
  }

  const document = toSafeGoogleDocDocument(documentBody, resolvedDocumentId)
  const indexedBlocks = extractIndexedGoogleDocBodyBlocks(documentBody)
  const resolvedOperation = resolveGoogleDocsEditOperation(
    indexedBlocks,
    normalizedOperation,
    getBodyEndInsertionIndex(documentBody)
  )
  await approve({ document, operation: toGoogleDocsEditApprovalOperation(resolvedOperation) })

  const requestBody: {
    requests: Array<{
      insertText: {
        location: { index: number }
        text: string
      }
    }>
    writeControl?: {
      requiredRevisionId: string
    }
  } = {
    requests: [
      {
        insertText: {
          location: { index: resolvedOperation.insertionIndex },
          text: resolvedOperation.text
        }
      }
    ]
  }

  if (document.revision) {
    requestBody.writeControl = { requiredRevisionId: document.revision }
  }

  const response = await fetchImpl(createDocsBatchUpdateUrl(resolvedDocumentId), {
    body: JSON.stringify(requestBody),
    headers: {
      authorization: `Bearer ${token.accessToken}`,
      'content-type': 'application/json'
    },
    method: 'POST',
    signal
  })

  const body = (await response.json().catch(() => ({}))) as GoogleDocsBatchUpdateResponse
  if (!response.ok) {
    throwGoogleApiFailure('Google Docs documents.batchUpdate', response.status, body)
  }

  return {
    ok: true,
    documentId: body.documentId || document.id,
    insertedTextLength: resolvedOperation.text.length,
    link: document.link,
    operation: resolvedOperation.type,
    revision:
      body.writeControl?.requiredRevisionId ??
      body.writeControl?.targetRevisionId ??
      document.revision,
    title: document.title
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

function normalizeDocumentId(documentId: string): string {
  const trimmed = documentId.trim()
  if (!trimmed) throw new Error('Google Docs document ID is required.')
  return trimmed
}

function normalizeGoogleDocsEditOperation(
  operation: GoogleDocsEditOperation
): GoogleDocsEditOperation {
  if (!operation || typeof operation !== 'object') {
    throw new Error('Google Docs edit operation is required.')
  }

  if (operation.type === 'append_text') {
    return {
      type: 'append_text',
      text: normalizeGoogleDocsEditText(operation.text)
    }
  }

  if (operation.type === 'insert_after_text') {
    const match = typeof operation.match === 'string' ? operation.match : ''
    if (!match) throw new Error('Google Docs insert_after_text requires match text.')

    return {
      type: 'insert_after_text',
      match,
      occurrence: normalizeTextOccurrence(operation.occurrence),
      text: normalizeGoogleDocsEditText(operation.text)
    }
  }

  throw new Error('Google Docs edit operation type must be append_text or insert_after_text.')
}

function normalizeGoogleDocsEditText(text: string): string {
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('Text to insert into the Google Doc is required.')
  }

  return text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

function normalizeTextOccurrence(occurrence: unknown): GoogleDocsTextOccurrence {
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
    'Google Docs insert_after_text occurrence must be first, last, or a 1-based number.'
  )
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
    markdown: text,
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
        text,
        markdown: text
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
        type: 'paragraph' as const,
        startIndex: finiteNumberOrNull(entry.startIndex),
        endIndex: finiteNumberOrNull(entry.endIndex),
        textStartIndex: minFiniteNumber(textRuns.map((run) => run.startIndex)),
        textEndIndex: maxFiniteNumber(textRuns.map((run) => run.endIndex)),
        text
      }
    ]
  })
}

function extractParagraphTextRuns(value: unknown): Array<{
  startIndex: number | null
  endIndex: number | null
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
        startIndex: finiteNumberOrNull(entry.startIndex),
        endIndex: finiteNumberOrNull(entry.endIndex),
        text
      }
    ]
  })
}

function toGoogleDocsEditApprovalOperation(
  operation: ResolvedGoogleDocsEditOperation
): GoogleDocsEditApprovalOperation {
  if (operation.type === 'append_text') {
    return {
      type: 'append_text',
      text: operation.text
    }
  }

  return {
    type: 'insert_after_text',
    match: operation.match,
    occurrence: operation.occurrence,
    text: operation.text
  }
}

function resolveGoogleDocsEditOperation(
  indexedBlocks: IndexedGoogleDocBodyBlock[],
  operation: GoogleDocsEditOperation,
  appendInsertionIndex: number
): ResolvedGoogleDocsEditOperation {
  if (operation.type === 'append_text') {
    return {
      type: 'append_text',
      insertionIndex: appendInsertionIndex,
      text: operation.text
    }
  }

  return resolveInsertAfterTextOperation(indexedBlocks, operation)
}

function resolveInsertAfterTextOperation(
  indexedBlocks: IndexedGoogleDocBodyBlock[],
  operation: Extract<GoogleDocsEditOperation, { type: 'insert_after_text' }>
): ResolvedGoogleDocsEditOperation {
  const matches = indexedBlocks.flatMap((block) => findBlockMatchCandidates(block, operation.match))

  if (!matches.length) {
    throw new Error('Google Docs insert_after_text could not find the requested match text.')
  }

  const match = selectTextMatch(matches, operation.occurrence ?? 'last')
  if (
    match.insertionIndex === null ||
    match.matchStartIndex === null ||
    match.matchEndIndex === null
  ) {
    throw new Error(
      'Google Docs insert_after_text matched text in an unsupported paragraph structure.'
    )
  }

  return {
    type: 'insert_after_text',
    insertionIndex: match.insertionIndex,
    match: operation.match,
    matchEndIndex: match.matchEndIndex,
    matchStartIndex: match.matchStartIndex,
    occurrence: operation.occurrence ?? 'last',
    text: operation.text
  }
}

function findBlockMatchCandidates(
  block: IndexedGoogleDocBodyBlock,
  matchText: string
): Array<{
  insertionIndex: number | null
  matchEndIndex: number | null
  matchStartIndex: number | null
}> {
  if (block.type !== 'paragraph') return []
  const matches = [] as Array<{
    insertionIndex: number | null
    matchEndIndex: number | null
    matchStartIndex: number | null
  }>
  const textStartIndex = block.textStartIndex
  const textEndIndex = block.textEndIndex
  const baseTextStartIndex =
    textStartIndex !== null &&
    textEndIndex !== null &&
    textEndIndex - textStartIndex === block.text.length
      ? textStartIndex
      : null
  let searchIndex = 0

  while (searchIndex <= block.text.length) {
    const matchOffset = block.text.indexOf(matchText, searchIndex)
    if (matchOffset === -1) break

    const matchStartIndex = baseTextStartIndex === null ? null : baseTextStartIndex + matchOffset
    const matchEndIndex = matchStartIndex === null ? null : matchStartIndex + matchText.length
    matches.push({
      insertionIndex: matchEndIndex,
      matchEndIndex,
      matchStartIndex
    })
    searchIndex = matchOffset + Math.max(1, matchText.length)
  }

  return matches
}

function selectTextMatch<T>(matches: T[], occurrence: GoogleDocsTextOccurrence): T {
  const match =
    occurrence === 'first'
      ? matches[0]
      : occurrence === 'last'
        ? matches[matches.length - 1]
        : matches[occurrence - 1]
  if (!match) {
    throw new Error(`Google Docs insert_after_text occurrence ${occurrence} was not found.`)
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
  const maxEndIndex = endIndexes.length ? Math.max(...endIndexes) : 2
  return Math.max(1, maxEndIndex - 1)
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
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
  body: GoogleDocsApiResponse | GoogleDriveFilesResponse
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
