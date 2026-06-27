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
  error?: {
    message?: string
  }
}

type GoogleDocsApiResponse = {
  error?: {
    message?: string
  }
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
  link: string | null
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

export type GoogleDocsAppendTextInput = {
  approve: (input: GoogleDocsAppendApprovalInput) => Promise<void>
  configPath?: string
  documentId: string
  fetch?: Fetch
  signal?: AbortSignal
  text: string
}

export type GoogleDocsAppendApprovalInput = {
  document: GoogleDocDocumentArtifact
  insertionIndex: number
  text: string
}

export type GoogleDocsAppendTextResult = {
  ok: true
  documentId: string
  insertedTextLength: number
  insertionIndex: number
  link: string | null
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
    throw new Error(toDriveApiErrorMessage(response.status, body.error?.message))
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
    throw new Error(toDocsApiErrorMessage('get', response.status, body.error?.message))
  }

  return {
    document: toSafeGoogleDocDocument(body, resolvedDocumentId)
  }
}

export async function appendTextToGoogleDocDocument({
  approve,
  configPath = process.env.OPENKHODAM_CONFIG_PATH,
  documentId,
  fetch: fetchImpl = fetch,
  signal,
  text
}: GoogleDocsAppendTextInput): Promise<GoogleDocsAppendTextResult> {
  if (typeof approve !== 'function') {
    throw new Error('Google Docs append requires approval before writing to Google Docs.')
  }

  const resolvedDocumentId = normalizeDocumentId(documentId)
  const textToAppend = normalizeAppendText(text)
  const { token } = await getGoogleWorkspaceAccessToken({
    configPath,
    disconnectedToolName: 'google_docs_append_text',
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
    throw new Error(
      toDocsApiErrorMessage('get', documentResponse.status, documentBody.error?.message)
    )
  }

  const document = toSafeGoogleDocDocument(documentBody, resolvedDocumentId)
  const insertionIndex = getBodyEndInsertionIndex(documentBody)
  await approve({ document, insertionIndex, text: textToAppend })

  const response = await fetchImpl(createDocsBatchUpdateUrl(resolvedDocumentId), {
    body: JSON.stringify({
      requests: [
        {
          insertText: {
            location: { index: insertionIndex },
            text: textToAppend
          }
        }
      ]
    }),
    headers: {
      authorization: `Bearer ${token.accessToken}`,
      'content-type': 'application/json'
    },
    method: 'POST',
    signal
  })

  const body = (await response.json().catch(() => ({}))) as GoogleDocsBatchUpdateResponse
  if (!response.ok) {
    throw new Error(toDocsApiErrorMessage('batchUpdate', response.status, body.error?.message))
  }

  return {
    ok: true,
    documentId: body.documentId || document.id,
    insertedTextLength: textToAppend.length,
    insertionIndex,
    link: document.link,
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
    'documentId,title,revisionId,body(content(endIndex,paragraph(elements(textRun(content)))))'
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

function normalizeAppendText(text: string): string {
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('Text to append to the Google Doc is required.')
  }
  return text
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

function toDriveApiErrorMessage(status: number, message: string | undefined): string {
  if (status === 401) {
    return 'Google Drive rejected the saved Google Workspace token. Reconnect Google Workspace in Settings.'
  }

  if (status === 403) {
    return 'Google Drive access was denied. Reconnect Google Workspace in Settings and ensure Drive metadata access is granted.'
  }

  return message ? `Google Drive files.list failed: ${message}` : 'Google Drive files.list failed.'
}

function toDocsApiErrorMessage(
  action: 'batchUpdate' | 'get',
  status: number,
  message: string | undefined
): string {
  if (status === 401) {
    return 'Google Docs rejected the saved Google Workspace token. Reconnect Google Workspace in Settings.'
  }

  if (status === 403) {
    return 'Google Docs access was denied. Reconnect Google Workspace in Settings and ensure Google Docs access is granted.'
  }

  if (status === 404) {
    return 'Google Docs document was not found or is not available to the connected account.'
  }

  return message
    ? `Google Docs documents.${action} failed: ${message}`
    : `Google Docs documents.${action} failed.`
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
  return {
    type: 'google.doc.document',
    id,
    title: typeof value.title === 'string' && value.title ? value.title : null,
    revision: typeof value.revisionId === 'string' && value.revisionId ? value.revisionId : null,
    text: extractGoogleDocText(value),
    link: createGoogleDocLink(id)
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

function createGoogleDocLink(documentId: string): string | null {
  return documentId
    ? `https://docs.google.com/document/d/${encodeURIComponent(documentId)}/edit`
    : null
}
