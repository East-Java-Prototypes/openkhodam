import { Buffer } from 'node:buffer'
import { lstatSync, mkdirSync, realpathSync, statSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { isAbsolute, join, posix } from 'node:path'
import type {
  DeleteGoogleDocDocumentArtifactResult,
  DeleteGoogleSheetSpreadsheetArtifactResult,
  GoogleDocDocumentArtifact,
  GoogleSheetSpreadsheetArtifact,
  LinkedGoogleArtifact,
  LinkedGoogleArtifactRecord,
  LinkedGoogleArtifactType,
  PersistGoogleDocDocumentArtifactResult,
  PersistGoogleSheetSpreadsheetArtifactResult,
  ProjectArtifactsConfig
} from '@openkhodam/protocol'
import { JsonConfigFile, writeJsonConfigFile } from './json-config-file.js'

export const OPENKHODAM_PROJECT_DIRECTORY_NAME = '.openkhodam'
export const PROJECT_ARTIFACTS_CONFIG_VERSION = 1
export const GOOGLE_DOC_DOCUMENT_ARTIFACT_SCHEMA_VERSION = 1
export const GOOGLE_SHEET_SPREADSHEET_ARTIFACT_SCHEMA_VERSION = 1
export const PROJECT_ARTIFACTS_FILE_NAME = 'artifacts.json'
export const PROJECT_ARTIFACTS_DIRECTORY_NAME = 'artifacts'
export const GOOGLE_DOCS_ARTIFACTS_DIRECTORY_NAME = 'google-docs'
export const GOOGLE_SHEETS_ARTIFACTS_DIRECTORY_NAME = 'google-sheets'

type FileStat = NonNullable<ReturnType<typeof lstatSync>>
type WorkspaceConfig<T extends object> = {
  artifactDirectoryName: string
  artifactFileDisplayName: string
  getArtifactId: (value: T) => unknown
  schemaVersion: 1
  unsafeEncodedIdMessage: string
}
const docConfig: WorkspaceConfig<GoogleDocDocumentArtifact> = {
  artifactDirectoryName: GOOGLE_DOCS_ARTIFACTS_DIRECTORY_NAME,
  artifactFileDisplayName: 'Google Docs artifact file',
  getArtifactId: (x) => x.id,
  schemaVersion: 1,
  unsafeEncodedIdMessage: 'Google Docs document ID could not be encoded for an artifact file path.'
}
const sheetConfig: WorkspaceConfig<GoogleSheetSpreadsheetArtifact> = {
  artifactDirectoryName: GOOGLE_SHEETS_ARTIFACTS_DIRECTORY_NAME,
  artifactFileDisplayName: 'Google Sheets artifact file',
  getArtifactId: (x) => x.id,
  schemaVersion: 1,
  unsafeEncodedIdMessage:
    'Google Sheets spreadsheet ID could not be encoded for an artifact file path.'
}

export type ProjectArtifactsFileStoreOptions = { readonly now?: () => number }

export class ProjectArtifactsFileStore {
  readonly filePath: string
  readonly projectDirectory: string
  private readonly configFile: JsonConfigFile<ProjectArtifactsConfig>
  private readonly now: () => number
  constructor(projectDirectory: string, options: ProjectArtifactsFileStoreOptions = {}) {
    this.now = options.now ?? Date.now
    this.projectDirectory = normalizeProjectDirectory(projectDirectory)
    this.filePath = join(
      this.projectDirectory,
      OPENKHODAM_PROJECT_DIRECTORY_NAME,
      PROJECT_ARTIFACTS_FILE_NAME
    )
    this.configFile = new JsonConfigFile(this.filePath, {
      defaultValue: createDefaultProjectArtifactsConfig,
      normalize: normalizeProjectArtifactsConfig
    })
  }
  async read() {
    this.validateRead()
    return this.configFile.read()
  }
  async write(config: ProjectArtifactsConfig) {
    this.prepareWrite()
    await this.configFile.write(config)
  }
  listProjectArtifacts() {
    return this.read()
  }
  async listSessionLinkedGoogleArtifacts(sessionId: string) {
    return (await this.read()).sessions[required(sessionId, 'sessionId')] ?? []
  }
  async recordLinkedGoogleArtifact(input: {
    sessionId: string
    messageId?: string | null
    artifact: LinkedGoogleArtifactRecord
  }): Promise<LinkedGoogleArtifact> {
    const sessionId = required(input.sessionId, 'sessionId')
    const artifact = normalizeRecord(input.artifact)
    const config = await this.read()
    const items = [...(config.sessions[sessionId] ?? [])]
    const index = items.findIndex((x) => key(x) === key(artifact))
    const item = toArtifact(artifact, this.now(), optional(input.messageId))
    if (index >= 0) {
      const old = items[index]
      const updated = {
        ...item,
        artifactPath: item.artifactPath ?? old.artifactPath,
        firstSeenAt: old.firstSeenAt,
        firstMessageId: old.firstMessageId ?? item.firstMessageId,
        lastMessageId: item.lastMessageId ?? old.lastMessageId,
        listed: old.listed
      }
      items[index] = updated
      config.sessions[sessionId] = items
      await this.write(config)
      return updated
    }
    items.push(item)
    config.sessions[sessionId] = items
    await this.write(config)
    return item
  }
  recordLinkedGoogleDoc(input: {
    sessionId: string
    messageId?: string | null
    doc: Omit<LinkedGoogleArtifactRecord, 'type'> & { type?: 'google.doc.document' }
  }) {
    return this.recordLinkedGoogleArtifact({
      ...input,
      artifact: { ...input.doc, type: input.doc.type ?? 'google.doc.document' }
    })
  }
  async setLinkedGoogleArtifactListed(
    input: { sessionId: string; id: string; type?: LinkedGoogleArtifactType },
    listed: boolean
  ) {
    const config = await this.read()
    const items = config.sessions[required(input.sessionId, 'sessionId')]
    if (!items) return null
    const index = items.findIndex(
      (x) => x.id === required(input.id, 'id') && x.type === typeOf(input.type)
    )
    if (index < 0) return null
    const next = { ...items[index], listed }
    config.sessions[required(input.sessionId, 'sessionId')] = [
      ...items.slice(0, index),
      next,
      ...items.slice(index + 1)
    ]
    await this.write(config)
    return next
  }
  delistLinkedGoogleArtifact(input: {
    sessionId: string
    id: string
    type?: LinkedGoogleArtifactType
  }) {
    return this.setLinkedGoogleArtifactListed(input, false)
  }
  relistLinkedGoogleArtifact(input: {
    sessionId: string
    id: string
    type?: LinkedGoogleArtifactType
  }) {
    return this.setLinkedGoogleArtifactListed(input, true)
  }
  delistLinkedGoogleDoc(input: { sessionId: string; id: string; type?: 'google.doc.document' }) {
    return this.delistLinkedGoogleArtifact({ ...input, type: input.type ?? 'google.doc.document' })
  }
  relistLinkedGoogleDoc(input: { sessionId: string; id: string; type?: 'google.doc.document' }) {
    return this.relistLinkedGoogleArtifact({ ...input, type: input.type ?? 'google.doc.document' })
  }
  persistGoogleDocDocumentArtifact(document: GoogleDocDocumentArtifact) {
    return this.persist(document, docConfig)
  }
  persistGoogleSheetSpreadsheetArtifact(spreadsheet: GoogleSheetSpreadsheetArtifact) {
    return this.persist(spreadsheet, sheetConfig)
  }
  deleteGoogleDocDocumentArtifact(path: string) {
    return this.delete(path, docConfig, 'Google Docs')
  }
  deleteGoogleSheetSpreadsheetArtifact(path: string) {
    return this.delete(path, sheetConfig, 'Google Sheets')
  }
  private async persist<T extends object>(
    value: T,
    config: WorkspaceConfig<T>
  ): Promise<{ artifactPath: string; created: boolean }> {
    const id = required(config.getArtifactId(value), 'artifact.id')
    const name = `encoded-${encoded(id, config)}.json`
    const artifactPath = posix.join(
      OPENKHODAM_PROJECT_DIRECTORY_NAME,
      PROJECT_ARTIFACTS_DIRECTORY_NAME,
      config.artifactDirectoryName,
      name
    )
    const path = join(this.projectDirectory, artifactPath)
    this.prepareArtifactWrite(path, config)
    const exists = lstatIfExists(path) !== null
    await writeJsonConfigFile(path, {
      ...value,
      schemaVersion: config.schemaVersion,
      cachedAt: this.now()
    })
    return { artifactPath, created: !exists }
  }
  private async delete(
    artifactPath: string,
    config: Pick<WorkspaceConfig<object>, 'artifactDirectoryName' | 'artifactFileDisplayName'>,
    product: string
  ): Promise<{ deleted: boolean }> {
    const normalized = required(artifactPath, 'artifactPath')
    if (!safePath(normalized, config))
      throw new Error(`${product} artifact path must be a safe project-local path.`)
    const path = join(this.projectDirectory, normalized)
    this.prepareArtifactDelete(path, config)
    try {
      await unlink(path)
      return { deleted: true }
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return { deleted: false }
      throw error
    }
  }
  private validateProject() {
    if (normalizeProjectDirectory(this.projectDirectory) !== this.projectDirectory)
      throw new Error('projectDirectory canonical path changed.')
  }
  private validateRead() {
    this.validateProject()
    validateFile(
      join(this.projectDirectory, OPENKHODAM_PROJECT_DIRECTORY_NAME),
      'Project artifacts directory .openkhodam',
      true
    )
    validateFile(this.filePath, 'Project artifacts file artifacts.json', false)
  }
  private prepareWrite() {
    this.validateProject()
    ensureDir(
      join(this.projectDirectory, OPENKHODAM_PROJECT_DIRECTORY_NAME),
      'Project artifacts directory .openkhodam'
    )
    this.validateRead()
  }
  private prepareArtifactWrite(
    path: string,
    config: Pick<WorkspaceConfig<object>, 'artifactDirectoryName' | 'artifactFileDisplayName'>
  ) {
    this.validateProject()
    ensureDir(
      join(this.projectDirectory, OPENKHODAM_PROJECT_DIRECTORY_NAME),
      'Project artifacts directory .openkhodam'
    )
    ensureDir(
      join(
        this.projectDirectory,
        OPENKHODAM_PROJECT_DIRECTORY_NAME,
        PROJECT_ARTIFACTS_DIRECTORY_NAME
      ),
      'Project artifacts directory .openkhodam/artifacts'
    )
    ensureDir(
      join(
        this.projectDirectory,
        OPENKHODAM_PROJECT_DIRECTORY_NAME,
        PROJECT_ARTIFACTS_DIRECTORY_NAME,
        config.artifactDirectoryName
      ),
      `Project artifacts directory .openkhodam/artifacts/${config.artifactDirectoryName}`
    )
    validateFile(path, config.artifactFileDisplayName, false)
  }
  private prepareArtifactDelete(
    path: string,
    config: Pick<WorkspaceConfig<object>, 'artifactDirectoryName' | 'artifactFileDisplayName'>
  ) {
    this.validateProject()
    validateFile(
      join(this.projectDirectory, OPENKHODAM_PROJECT_DIRECTORY_NAME),
      'Project artifacts directory .openkhodam',
      true
    )
    validateFile(
      join(
        this.projectDirectory,
        OPENKHODAM_PROJECT_DIRECTORY_NAME,
        PROJECT_ARTIFACTS_DIRECTORY_NAME
      ),
      'Project artifacts directory .openkhodam/artifacts',
      true
    )
    validateFile(
      join(
        this.projectDirectory,
        OPENKHODAM_PROJECT_DIRECTORY_NAME,
        PROJECT_ARTIFACTS_DIRECTORY_NAME,
        config.artifactDirectoryName
      ),
      `Project artifacts directory .openkhodam/artifacts/${config.artifactDirectoryName}`,
      true
    )
    validateFile(path, config.artifactFileDisplayName, false)
  }
}

export class ProjectArtifactsModule {
  private static queues = new Map<string, Promise<void>>()
  constructor(
    private readonly now: () => number = Date.now,
    private readonly hooks: {
      beforeRecordLinkedGoogleArtifact?: () => Promise<void> | void
    } = {}
  ) {}
  private enqueue<T>(
    projectDirectory: string,
    action: (store: ProjectArtifactsFileStore) => Promise<T>
  ): Promise<T> {
    const canonical = normalizeProjectDirectory(projectDirectory)
    const previous = ProjectArtifactsModule.queues.get(canonical) ?? Promise.resolve()
    const result = previous.then(() =>
      action(new ProjectArtifactsFileStore(canonical, { now: this.now }))
    )
    const done = result.then(
      () => undefined,
      () => undefined
    )
    ProjectArtifactsModule.queues.set(canonical, done)
    void done.finally(() => {
      if (ProjectArtifactsModule.queues.get(canonical) === done)
        ProjectArtifactsModule.queues.delete(canonical)
    })
    return result
  }
  listProjectArtifacts(projectDirectory: string) {
    return this.enqueue(projectDirectory, (x) => x.listProjectArtifacts())
  }
  listSessionLinkedGoogleArtifacts(projectDirectory: string, sessionId: string) {
    return this.enqueue(projectDirectory, (x) => x.listSessionLinkedGoogleArtifacts(sessionId))
  }
  recordLinkedGoogleArtifact(input: {
    projectDirectory: string
    sessionId: string
    messageId?: string | null
    artifact: LinkedGoogleArtifactRecord
  }) {
    return this.enqueue(input.projectDirectory, (x) => x.recordLinkedGoogleArtifact(input))
  }
  delistLinkedGoogleArtifact(input: {
    projectDirectory: string
    sessionId: string
    id: string
    type?: LinkedGoogleArtifactType
  }) {
    return this.enqueue(input.projectDirectory, (x) =>
      x.setLinkedGoogleArtifactListed(input, false)
    )
  }
  relistLinkedGoogleArtifact(input: {
    projectDirectory: string
    sessionId: string
    id: string
    type?: LinkedGoogleArtifactType
  }) {
    return this.enqueue(input.projectDirectory, (x) => x.setLinkedGoogleArtifactListed(input, true))
  }
  snapshotGoogleDocDocument(input: {
    projectDirectory: string
    sessionId: string
    messageId?: string | null
    document: GoogleDocDocumentArtifact
  }): Promise<LinkedGoogleArtifact> {
    return this.enqueue(input.projectDirectory, async (store) => {
      safeLinkedUrl(optional(input.document.link), 'document.link')
      const persisted = await store.persistGoogleDocDocumentArtifact(input.document)
      try {
        await this.hooks.beforeRecordLinkedGoogleArtifact?.()
        const artifact = {
          type: 'google.doc.document' as const,
          id: input.document.id,
          title: input.document.title,
          url: input.document.link,
          artifactPath: persisted.artifactPath
        }
        const old = (await store.listSessionLinkedGoogleArtifacts(input.sessionId)).find(
          (value) => key(value) === key(artifact)
        )
        if (!optional(input.messageId) && old && sameSemanticLink(old, artifact)) return old
        return await store.recordLinkedGoogleArtifact({
          sessionId: input.sessionId,
          messageId: input.messageId,
          artifact
        })
      } catch (error) {
        if (persisted.created) {
          try {
            await store.deleteGoogleDocDocumentArtifact(persisted.artifactPath)
          } catch (cleanupError) {
            console.warn('Failed to clean up Google Docs artifact snapshot after link failure.', {
              cleanupError: sanitizeCleanupError(cleanupError)
            })
          }
        }
        throw error
      }
    })
  }
  snapshotGoogleSheetSpreadsheet(input: {
    projectDirectory: string
    sessionId: string
    messageId?: string | null
    spreadsheet: GoogleSheetSpreadsheetArtifact
  }): Promise<LinkedGoogleArtifact> {
    return this.enqueue(input.projectDirectory, async (store) => {
      safeLinkedUrl(optional(input.spreadsheet.link), 'spreadsheet.link')
      const persisted = await store.persistGoogleSheetSpreadsheetArtifact(input.spreadsheet)
      try {
        await this.hooks.beforeRecordLinkedGoogleArtifact?.()
        const artifact = {
          type: 'google.sheet.spreadsheet' as const,
          id: input.spreadsheet.id,
          title: input.spreadsheet.title,
          url: input.spreadsheet.link,
          artifactPath: persisted.artifactPath
        }
        const old = (await store.listSessionLinkedGoogleArtifacts(input.sessionId)).find(
          (value) => key(value) === key(artifact)
        )
        if (!optional(input.messageId) && old && sameSemanticLink(old, artifact)) return old
        return await store.recordLinkedGoogleArtifact({
          sessionId: input.sessionId,
          messageId: input.messageId,
          artifact
        })
      } catch (error) {
        if (persisted.created) {
          try {
            await store.deleteGoogleSheetSpreadsheetArtifact(persisted.artifactPath)
          } catch (cleanupError) {
            console.warn('Failed to clean up Google Sheets artifact snapshot after link failure.', {
              cleanupError: sanitizeCleanupError(cleanupError)
            })
          }
        }
        throw error
      }
    })
  }
  persistGoogleDocDocumentArtifact(input: {
    projectDirectory: string
    document: GoogleDocDocumentArtifact
  }): Promise<PersistGoogleDocDocumentArtifactResult> {
    return this.enqueue(input.projectDirectory, (x) =>
      x.persistGoogleDocDocumentArtifact(input.document)
    )
  }
  persistGoogleSheetSpreadsheetArtifact(input: {
    projectDirectory: string
    spreadsheet: GoogleSheetSpreadsheetArtifact
  }): Promise<PersistGoogleSheetSpreadsheetArtifactResult> {
    return this.enqueue(input.projectDirectory, (x) =>
      x.persistGoogleSheetSpreadsheetArtifact(input.spreadsheet)
    )
  }
  deleteGoogleDocDocumentArtifact(input: {
    projectDirectory: string
    artifactPath: string
  }): Promise<DeleteGoogleDocDocumentArtifactResult> {
    return this.enqueue(input.projectDirectory, (x) =>
      x.deleteGoogleDocDocumentArtifact(input.artifactPath)
    )
  }
  deleteGoogleSheetSpreadsheetArtifact(input: {
    projectDirectory: string
    artifactPath: string
  }): Promise<DeleteGoogleSheetSpreadsheetArtifactResult> {
    return this.enqueue(input.projectDirectory, (x) =>
      x.deleteGoogleSheetSpreadsheetArtifact(input.artifactPath)
    )
  }
}

export function createDefaultProjectArtifactsConfig(): ProjectArtifactsConfig {
  return { version: 1, sessions: {} }
}
export function normalizeProjectArtifactsConfig(value: unknown): ProjectArtifactsConfig {
  const record = object(value) ? value : {}
  const sessions = object(record.sessions) ? record.sessions : {}
  const out: Record<string, LinkedGoogleArtifact[]> = {}
  for (const [session, raw] of Object.entries(sessions)) {
    const id = optional(session)
    if (!id || !Array.isArray(raw)) continue
    const dedupe = new Map<string, LinkedGoogleArtifact>()
    for (const candidate of raw) {
      const artifact = normalizeStored(candidate)
      if (!artifact) continue
      const existing = dedupe.get(key(artifact))
      dedupe.set(key(artifact), existing ? mergeStored(existing, artifact) : artifact)
    }
    if (dedupe.size) out[id] = [...dedupe.values()]
  }
  return { version: 1, sessions: out }
}
export function normalizeProjectDirectory(projectDirectory: string) {
  const path = required(projectDirectory, 'projectDirectory')
  if (!isAbsolute(path)) throw new Error('projectDirectory must be an absolute path.')
  let canonical: string
  try {
    canonical = realpathSync(path)
  } catch {
    throw new Error('projectDirectory must be an existing directory.')
  }
  if (!statSync(canonical).isDirectory())
    throw new Error('projectDirectory must be an existing directory.')
  return canonical
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function optional(value: unknown): string | null {
  return typeof value === 'string' && !value.includes('\0') && value.trim() ? value.trim() : null
}
function safeLinkedUrl(value: string | null, name: string): string | null {
  if (!value) return null
  if (secretLikeUrl(value)) throw new Error(`${name} must not contain a secret-like value.`)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be a valid URL.`)
  }
  if (url.username || url.password) throw new Error(`${name} must not contain credentials.`)
  return value
}
function required(value: unknown, name: string) {
  const result = optional(value)
  if (!result) throw new Error(`${name} must be a non-empty string.`)
  return result
}
function typeOf(value: unknown): LinkedGoogleArtifactType {
  if (value === undefined || value === null || value === '') return 'google.doc.document'
  if (value === 'google.doc.document' || value === 'google.sheet.spreadsheet') return value
  throw new Error(
    'Linked Google Workspace artifact type must be google.doc.document or google.sheet.spreadsheet.'
  )
}
function normalizeRecord(value: LinkedGoogleArtifactRecord) {
  if (!object(value)) throw new Error('Linked Google Workspace artifact record must be an object.')
  const type = typeOf(value.type)
  const artifactPath = value.artifactPath === undefined ? null : optional(value.artifactPath)
  if (artifactPath && !safeArtifactPath(artifactPath, type))
    throw new Error('Linked Google Workspace artifact path must be a safe project-local path.')
  return {
    type,
    artifactPath,
    id: required(value.id, 'artifact.id'),
    title: optional(value.title),
    url: safeLinkedUrl(optional(value.url), 'artifact.url')
  }
}
function toArtifact(
  value: ReturnType<typeof normalizeRecord>,
  now: number,
  messageId: string | null
): LinkedGoogleArtifact {
  return {
    ...value,
    listed: true,
    firstSeenAt: now,
    lastSeenAt: now,
    firstMessageId: messageId,
    lastMessageId: messageId
  }
}
function normalizeStored(value: unknown): LinkedGoogleArtifact | null {
  if (!object(value)) return null
  const id = optional(value.id)
  if (!id) return null
  const type = value.type === 'google.sheet.spreadsheet' ? value.type : 'google.doc.document'
  const first =
    typeof value.firstSeenAt === 'number' && Number.isFinite(value.firstSeenAt)
      ? Math.max(0, Math.trunc(value.firstSeenAt))
      : typeof value.lastSeenAt === 'number' && Number.isFinite(value.lastSeenAt)
        ? Math.max(0, Math.trunc(value.lastSeenAt))
        : 0
  const last =
    typeof value.lastSeenAt === 'number' && Number.isFinite(value.lastSeenAt)
      ? Math.max(0, Math.trunc(value.lastSeenAt))
      : first
  const path = optional(value.artifactPath)
  return {
    type,
    artifactPath: path && safeArtifactPath(path, type) ? path : null,
    id,
    title: optional(value.title),
    url: safeStoredUrl(optional(value.url)),
    listed: typeof value.listed === 'boolean' ? value.listed : true,
    firstSeenAt: first,
    lastSeenAt: last,
    firstMessageId: optional(value.firstMessageId),
    lastMessageId: optional(value.lastMessageId)
  }
}
function mergeStored(
  existing: LinkedGoogleArtifact,
  next: LinkedGoogleArtifact
): LinkedGoogleArtifact {
  return {
    ...next,
    artifactPath: next.artifactPath ?? existing.artifactPath,
    firstSeenAt: Math.min(existing.firstSeenAt, next.firstSeenAt),
    firstMessageId: existing.firstMessageId ?? next.firstMessageId,
    lastSeenAt: Math.max(existing.lastSeenAt, next.lastSeenAt),
    lastMessageId: next.lastMessageId ?? existing.lastMessageId,
    listed: existing.listed
  }
}
function safeStoredUrl(value: string | null): string | null {
  if (!value || secretLikeUrl(value)) return null
  try {
    const url = new URL(value)
    return url.username || url.password ? null : value
  } catch {
    return null
  }
}
function secretLikeUrl(value: string): boolean {
  try {
    const url = new URL(value)
    for (const [name] of url.searchParams) if (secretLikeName(name)) return true
    return secretLikeFragment(url.hash, value.slice(value.indexOf('#')))
  } catch {
    return /(?:[?#&](?:access[_-]?token|accesskeyid|authorizationheader|cookieheader|key|privatekey|secretaccesskey|sig|signature|x-api-key|token|client[_-]?secret|credential|password)=)/i.test(
      value
    )
  }
}
function secretLikeFragment(hash: string, rawHash: string): boolean {
  const raw = hash.replace(/^#/, '')
  const encoded = rawHash.replace(/^#/, '')
  const candidates = new Set([raw])
  const encodedCandidates = new Set([encoded])
  let decoded = raw
  for (let index = 0; index < 2; index += 1) {
    try {
      decoded = decodeURIComponent(decoded)
    } catch {
      break
    }
    candidates.add(decoded)
  }
  let encodedDecoded = encoded
  for (let index = 0; index < 2; index += 1) {
    try {
      encodedDecoded = decodeURIComponent(encodedDecoded)
    } catch {
      break
    }
    encodedCandidates.add(encodedDecoded)
  }
  for (const fragment of candidates) {
    const queryStart = fragment.indexOf('?')
    const query = queryStart >= 0 ? fragment.slice(queryStart + 1) : fragment
    for (const [name] of new URLSearchParams(query)) if (secretLikeName(name)) return true
    for (const pair of query.split('&')) {
      if (secretLikeName(pair.split('=', 1)[0] ?? '')) return true
    }
    if (queryStart >= 0) {
      for (const pair of query.split('&')) {
        const name = pair.split('=', 1)[0] ?? ''
        if (secretLikeName(name)) return true
      }
    }
  }
  for (const fragment of encodedCandidates) {
    const queryStart = fragment.indexOf('?')
    if (queryStart < 0) continue
    for (const pair of fragment.slice(queryStart + 1).split('&')) {
      if (secretLikeName(pair.split('=', 1)[0] ?? '')) return true
    }
  }
  return false
}
function secretLikeName(name: string): boolean {
  let decoded = name
  try {
    decoded = decodeURIComponent(name.replace(/\+/g, ' '))
  } catch {}
  const normalized = decoded.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return /authorization|cookie|apikey|accesskey|privatekey|secret|token|credential|password|signature|sig|refresh|key/.test(
    normalized
  )
}
function sanitizeCleanupError(error: unknown): string {
  void error
  return 'cleanup failed'
}
function sameSemanticLink(
  old: LinkedGoogleArtifact,
  next: Pick<LinkedGoogleArtifactRecord, 'type' | 'id' | 'title' | 'url' | 'artifactPath'>
) {
  return (
    old.type === next.type &&
    old.id === next.id &&
    old.title === next.title &&
    old.url === next.url &&
    old.artifactPath === next.artifactPath
  )
}
function key(value: Pick<LinkedGoogleArtifact, 'id' | 'type'>) {
  return `${value.type}\0${value.id}`
}
function encoded(id: string, config: Pick<WorkspaceConfig<object>, 'unsafeEncodedIdMessage'>) {
  const result = Buffer.from(id, 'utf8').toString('base64url')
  if (!/^[A-Za-z0-9_-]+$/.test(result)) throw new Error(config.unsafeEncodedIdMessage)
  return result
}
function safeArtifactPath(value: string, type: LinkedGoogleArtifactType) {
  return safePath(value, type === 'google.sheet.spreadsheet' ? sheetConfig : docConfig)
}
function safePath(value: string, config: Pick<WorkspaceConfig<object>, 'artifactDirectoryName'>) {
  if (isAbsolute(value) || value.includes('\\')) return false
  const parts = value.split('/')
  return (
    parts.length === 4 &&
    parts[0] === OPENKHODAM_PROJECT_DIRECTORY_NAME &&
    parts[1] === PROJECT_ARTIFACTS_DIRECTORY_NAME &&
    parts[2] === config.artifactDirectoryName &&
    /^encoded-[A-Za-z0-9_-]+\.json$/.test(parts[3])
  )
}
function lstatIfExists(path: string): FileStat | null {
  try {
    return lstatSync(path)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return null
    throw error
  }
}
function ensureDir(path: string, name: string) {
  const stat = lstatIfExists(path)
  if (stat) return validateDirectory(stat, name)
  try {
    mkdirSync(path)
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'EEXIST') throw error
  }
  const next = lstatIfExists(path)
  if (!next) throw new Error(`${name} could not be created.`)
  validateDirectory(next, name)
}
function validateFile(path: string, name: string, directory: boolean) {
  const stat = lstatIfExists(path)
  if (!stat) return
  if (stat.isSymbolicLink()) throw new Error(`${name} must not be a symlink.`)
  if (directory ? !stat.isDirectory() : !stat.isFile())
    throw new Error(`${name} must be a ${directory ? 'directory' : 'regular file'}.`)
}
function validateDirectory(stat: FileStat, name: string) {
  if (stat.isSymbolicLink()) throw new Error(`${name} must not be a symlink.`)
  if (!stat.isDirectory()) throw new Error(`${name} must be a directory.`)
}
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
