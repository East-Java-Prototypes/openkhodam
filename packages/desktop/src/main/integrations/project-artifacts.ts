import { Buffer } from 'node:buffer'
import { lstatSync, mkdirSync, realpathSync, statSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { isAbsolute, join, posix } from 'node:path'

import type {
  GoogleDocDocumentArtifact,
  GoogleSheetSpreadsheetArtifact,
  LinkedGoogleDoc,
  LinkedGoogleDocRecord,
  PersistedGoogleDocDocumentArtifact,
  PersistedGoogleSheetSpreadsheetArtifact,
  ProjectArtifactsConfig,
  ProjectArtifactsListInput,
  ProjectSessionLinkedDocsListInput,
  RecordLinkedGoogleDocInput,
  UpdateLinkedGoogleDocListingInput
} from '@openkhodam/ui/types'

import { JsonConfigFile, writeJsonConfigFile } from '../config/json-config-file'

export const OPENKHODAM_PROJECT_DIRECTORY_NAME = '.openkhodam'
export const PROJECT_ARTIFACTS_CONFIG_VERSION = 1
export const GOOGLE_DOC_DOCUMENT_ARTIFACT_SCHEMA_VERSION = 1
export const GOOGLE_SHEET_SPREADSHEET_ARTIFACT_SCHEMA_VERSION = 1
export const PROJECT_ARTIFACTS_FILE_NAME = 'artifacts.json'
export const PROJECT_ARTIFACTS_DIRECTORY_NAME = 'artifacts'
export const GOOGLE_DOCS_ARTIFACTS_DIRECTORY_NAME = 'google-docs'
export const GOOGLE_SHEETS_ARTIFACTS_DIRECTORY_NAME = 'google-sheets'

export type ProjectArtifactsFileStoreOptions = {
  readonly now?: () => number
}

export type ProjectArtifactsIntegration = {
  listProjectArtifacts: (input: ProjectArtifactsListInput) => Promise<ProjectArtifactsConfig>
  listSessionLinkedDocs: (input: ProjectSessionLinkedDocsListInput) => Promise<LinkedGoogleDoc[]>
  recordLinkedGoogleDoc: (input: RecordLinkedGoogleDocInput) => Promise<LinkedGoogleDoc>
  delistLinkedGoogleDoc: (
    input: UpdateLinkedGoogleDocListingInput
  ) => Promise<LinkedGoogleDoc | null>
  relistLinkedGoogleDoc: (
    input: UpdateLinkedGoogleDocListingInput
  ) => Promise<LinkedGoogleDoc | null>
}

type ProjectArtifactsStoreRecordInput = Omit<RecordLinkedGoogleDocInput, 'projectDirectory'>
type ProjectArtifactsStoreListingInput = Omit<UpdateLinkedGoogleDocListingInput, 'projectDirectory'>

type NormalizedLinkedGoogleDocRecord = {
  artifactPath: string | null
  id: string
  title: string | null
  url: string | null
}

type FileStat = NonNullable<ReturnType<typeof lstatSync>>

export type PersistGoogleDocDocumentArtifactInput = {
  document: GoogleDocDocumentArtifact
  projectDirectory: string
}

export type PersistGoogleDocDocumentArtifactResult = {
  artifactPath: string
  created: boolean
}

export type PersistGoogleSheetSpreadsheetArtifactInput = {
  projectDirectory: string
  spreadsheet: GoogleSheetSpreadsheetArtifact
}

export type PersistGoogleSheetSpreadsheetArtifactResult = {
  artifactPath: string
  created: boolean
}

export type DeleteGoogleDocDocumentArtifactInput = {
  artifactPath: string
  projectDirectory: string
}

export type DeleteGoogleDocDocumentArtifactResult = {
  deleted: boolean
}

export class ProjectArtifactsFileStore {
  readonly filePath: string
  readonly projectDirectory: string
  private readonly configFile: JsonConfigFile<ProjectArtifactsConfig>
  private readonly now: () => number

  constructor(projectDirectory: string, options: ProjectArtifactsFileStoreOptions = {}) {
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
    this.now = options.now ?? Date.now
  }

  async read(): Promise<ProjectArtifactsConfig> {
    this.validateArtifactsPathForRead()
    return this.configFile.read()
  }

  async write(config: ProjectArtifactsConfig): Promise<void> {
    this.prepareArtifactsPathForWrite()
    await this.configFile.write(config)
  }

  async listProjectArtifacts(): Promise<ProjectArtifactsConfig> {
    return this.read()
  }

  async listSessionLinkedDocs(sessionId: string): Promise<LinkedGoogleDoc[]> {
    const normalizedSessionId = normalizeRequiredString(sessionId, 'sessionId')
    const config = await this.read()
    return config.sessions[normalizedSessionId] ?? []
  }

  async recordLinkedGoogleDoc(input: ProjectArtifactsStoreRecordInput): Promise<LinkedGoogleDoc> {
    const sessionId = normalizeRequiredString(input.sessionId, 'sessionId')
    const messageId = normalizeOptionalString(input.messageId)
    const doc = normalizeLinkedGoogleDocRecordInput(input.doc)
    const seenAt = this.now()
    const config = await this.read()
    const sessionDocs = [...(config.sessions[sessionId] ?? [])]
    const existingIndex = sessionDocs.findIndex((candidate) => candidate.id === doc.id)
    const nextDoc = toLinkedGoogleDoc(doc, seenAt, messageId)

    if (existingIndex >= 0) {
      const existing = sessionDocs[existingIndex]
      const updatedDoc = {
        ...nextDoc,
        artifactPath: nextDoc.artifactPath ?? existing.artifactPath,
        firstSeenAt: existing.firstSeenAt,
        firstMessageId: existing.firstMessageId ?? nextDoc.firstMessageId,
        listed: existing.listed
      }
      sessionDocs[existingIndex] = updatedDoc
      config.sessions[sessionId] = sessionDocs
      await this.write(config)
      return updatedDoc
    }

    sessionDocs.push(nextDoc)
    config.sessions[sessionId] = sessionDocs
    await this.write(config)
    return nextDoc
  }

  async delistLinkedGoogleDoc(
    input: ProjectArtifactsStoreListingInput
  ): Promise<LinkedGoogleDoc | null> {
    return this.setLinkedGoogleDocListed(input, false)
  }

  async relistLinkedGoogleDoc(
    input: ProjectArtifactsStoreListingInput
  ): Promise<LinkedGoogleDoc | null> {
    return this.setLinkedGoogleDocListed(input, true)
  }

  async persistGoogleDocDocumentArtifact(
    document: GoogleDocDocumentArtifact
  ): Promise<PersistGoogleDocDocumentArtifactResult> {
    const documentId = normalizeGoogleDocArtifactDocumentId(document.id)
    const fileName = encodeGoogleDocArtifactFileName(documentId)
    const artifactPath = getGoogleDocArtifactRelativePath(fileName)
    const filePath = getGoogleDocArtifactFilePath(this.projectDirectory, fileName)
    const artifact = createPersistedGoogleDocDocumentArtifact(document, this.now())

    await this.read()
    this.prepareGoogleDocArtifactPathForWrite(filePath)
    const existingFileStat = lstatIfExists(filePath)
    await writeJsonConfigFile(filePath, artifact)

    return { artifactPath, created: existingFileStat === null }
  }

  async persistGoogleSheetSpreadsheetArtifact(
    spreadsheet: GoogleSheetSpreadsheetArtifact
  ): Promise<PersistGoogleSheetSpreadsheetArtifactResult> {
    const spreadsheetId = normalizeGoogleSheetArtifactSpreadsheetId(spreadsheet.id)
    const fileName = encodeGoogleSheetArtifactFileName(spreadsheetId)
    const artifactPath = getGoogleSheetArtifactRelativePath(fileName)
    const filePath = getGoogleSheetArtifactFilePath(this.projectDirectory, fileName)
    const artifact = createPersistedGoogleSheetSpreadsheetArtifact(spreadsheet, this.now())

    await this.read()
    this.prepareGoogleSheetArtifactPathForWrite(filePath)
    const existingFileStat = lstatIfExists(filePath)
    await writeJsonConfigFile(filePath, artifact)

    return { artifactPath, created: existingFileStat === null }
  }

  async deleteGoogleDocDocumentArtifact(
    artifactPath: string
  ): Promise<DeleteGoogleDocDocumentArtifactResult> {
    const normalizedArtifactPath = normalizeRequiredGoogleDocArtifactPath(artifactPath)
    const filePath = getGoogleDocArtifactFilePathFromRelativePath(
      this.projectDirectory,
      normalizedArtifactPath
    )

    this.prepareGoogleDocArtifactPathForDelete(filePath)
    try {
      await unlink(filePath)
      return { deleted: true }
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return { deleted: false }
      throw error
    }
  }

  private async setLinkedGoogleDocListed(
    input: ProjectArtifactsStoreListingInput,
    listed: boolean
  ): Promise<LinkedGoogleDoc | null> {
    const sessionId = normalizeRequiredString(input.sessionId, 'sessionId')
    const id = normalizeRequiredString(input.id, 'id')
    const config = await this.read()
    const sessionDocs = config.sessions[sessionId]
    if (!sessionDocs) return null

    const docIndex = sessionDocs.findIndex((doc) => doc.id === id)
    if (docIndex < 0) return null

    const nextDocs = [...sessionDocs]
    const updatedDoc = { ...nextDocs[docIndex], listed }
    nextDocs[docIndex] = updatedDoc
    config.sessions[sessionId] = nextDocs
    await this.write(config)
    return updatedDoc
  }

  private validateProjectDirectory(): void {
    if (normalizeProjectDirectory(this.projectDirectory) !== this.projectDirectory) {
      throw new Error('projectDirectory canonical path changed.')
    }
  }

  private validateArtifactsPathForRead(): void {
    this.validateProjectDirectory()
    validateProjectArtifactsPath(this.projectDirectory, this.filePath)
  }

  private prepareArtifactsPathForWrite(): void {
    this.validateProjectDirectory()
    ensureProjectArtifactsDirectory(this.projectDirectory)
    validateProjectArtifactsPath(this.projectDirectory, this.filePath)
  }

  private prepareGoogleDocArtifactPathForWrite(filePath: string): void {
    this.validateProjectDirectory()
    ensureGoogleDocsArtifactsDirectory(this.projectDirectory)
    validateGoogleDocsArtifactPath(this.projectDirectory, filePath)
  }

  private prepareGoogleSheetArtifactPathForWrite(filePath: string): void {
    this.validateProjectDirectory()
    ensureGoogleSheetsArtifactsDirectory(this.projectDirectory)
    validateGoogleSheetsArtifactPath(this.projectDirectory, filePath)
  }

  private prepareGoogleDocArtifactPathForDelete(filePath: string): void {
    this.validateProjectDirectory()
    validateGoogleDocsArtifactPath(this.projectDirectory, filePath)
  }
}

export function createProjectArtifactsIntegration(): ProjectArtifactsIntegration {
  return {
    async listProjectArtifacts(input) {
      return createProjectArtifactsStore(input).listProjectArtifacts()
    },
    async listSessionLinkedDocs(input) {
      return createProjectArtifactsStore(input).listSessionLinkedDocs(input.sessionId)
    },
    async recordLinkedGoogleDoc(input) {
      return createProjectArtifactsStore(input).recordLinkedGoogleDoc({
        doc: input.doc,
        messageId: input.messageId,
        sessionId: input.sessionId
      })
    },
    async delistLinkedGoogleDoc(input) {
      return createProjectArtifactsStore(input).delistLinkedGoogleDoc({
        id: input.id,
        sessionId: input.sessionId
      })
    },
    async relistLinkedGoogleDoc(input) {
      return createProjectArtifactsStore(input).relistLinkedGoogleDoc({
        id: input.id,
        sessionId: input.sessionId
      })
    }
  }
}

export async function getOrCreateLinkedGoogleDoc(
  input: RecordLinkedGoogleDocInput
): Promise<LinkedGoogleDoc> {
  const store = createProjectArtifactsStore(input)
  const sessionId = normalizeRequiredString(input.sessionId, 'sessionId')
  const doc = normalizeLinkedGoogleDocRecordInput(input.doc)
  const existing = (await store.listSessionLinkedDocs(sessionId)).find(
    (candidate) => candidate.id === doc.id
  )

  if (existing) {
    if (doc.artifactPath && doc.artifactPath !== existing.artifactPath) {
      return store.recordLinkedGoogleDoc({
        doc,
        messageId: input.messageId,
        sessionId
      })
    }

    return existing
  }

  return store.recordLinkedGoogleDoc({
    doc,
    messageId: input.messageId,
    sessionId
  })
}

export async function persistGoogleDocDocumentArtifact(
  input: PersistGoogleDocDocumentArtifactInput
): Promise<PersistGoogleDocDocumentArtifactResult> {
  return createProjectArtifactsStore(input).persistGoogleDocDocumentArtifact(input.document)
}

export async function persistGoogleSheetSpreadsheetArtifact(
  input: PersistGoogleSheetSpreadsheetArtifactInput
): Promise<PersistGoogleSheetSpreadsheetArtifactResult> {
  return createProjectArtifactsStore(input).persistGoogleSheetSpreadsheetArtifact(input.spreadsheet)
}

export async function deleteGoogleDocDocumentArtifact(
  input: DeleteGoogleDocDocumentArtifactInput
): Promise<DeleteGoogleDocDocumentArtifactResult> {
  return createProjectArtifactsStore(input).deleteGoogleDocDocumentArtifact(input.artifactPath)
}

export function createDefaultProjectArtifactsConfig(): ProjectArtifactsConfig {
  return {
    version: PROJECT_ARTIFACTS_CONFIG_VERSION,
    sessions: {}
  }
}

export function normalizeProjectArtifactsConfig(value: unknown): ProjectArtifactsConfig {
  const config = isRecord(value) ? value : {}
  const sessions = isRecord(config.sessions) ? config.sessions : {}
  const normalizedSessions: ProjectArtifactsConfig['sessions'] = {}

  for (const [rawSessionId, rawSessionDocs] of Object.entries(sessions)) {
    const sessionId = normalizeStoredString(rawSessionId)
    if (!sessionId) continue

    const linkedDocs = normalizeSessionLinkedDocs(rawSessionDocs)
    if (linkedDocs.length > 0) normalizedSessions[sessionId] = linkedDocs
  }

  return {
    version: PROJECT_ARTIFACTS_CONFIG_VERSION,
    sessions: normalizedSessions
  }
}

export function normalizeProjectDirectory(projectDirectory: string): string {
  const normalized = normalizeRequiredString(projectDirectory, 'projectDirectory')
  if (!isAbsolute(normalized)) {
    throw new Error('projectDirectory must be an absolute path.')
  }

  let canonicalPath: string
  try {
    canonicalPath = realpathSync(normalized)
  } catch {
    throw new Error('projectDirectory must be an existing directory.')
  }

  let isDirectory = false
  try {
    isDirectory = statSync(canonicalPath).isDirectory()
  } catch {
    throw new Error('projectDirectory must be an existing directory.')
  }

  if (!isDirectory) {
    throw new Error('projectDirectory must be an existing directory.')
  }

  return canonicalPath
}

function ensureProjectArtifactsDirectory(projectDirectory: string): void {
  ensureRegularDirectory(
    getProjectArtifactsDirectoryPath(projectDirectory),
    'Project artifacts directory .openkhodam'
  )
}

function ensureGoogleDocsArtifactsDirectory(projectDirectory: string): void {
  ensureProjectArtifactsDirectory(projectDirectory)
  ensureRegularDirectory(
    getProjectArtifactDataDirectoryPath(projectDirectory),
    'Project artifacts directory .openkhodam/artifacts'
  )
  ensureRegularDirectory(
    getGoogleDocsArtifactsDirectoryPath(projectDirectory),
    'Project artifacts directory .openkhodam/artifacts/google-docs'
  )
}

function ensureGoogleSheetsArtifactsDirectory(projectDirectory: string): void {
  ensureProjectArtifactsDirectory(projectDirectory)
  ensureRegularDirectory(
    getProjectArtifactDataDirectoryPath(projectDirectory),
    'Project artifacts directory .openkhodam/artifacts'
  )
  ensureRegularDirectory(
    getGoogleSheetsArtifactsDirectoryPath(projectDirectory),
    'Project artifacts directory .openkhodam/artifacts/google-sheets'
  )
}

function validateProjectArtifactsPath(projectDirectory: string, filePath: string): void {
  const directoryPath = getProjectArtifactsDirectoryPath(projectDirectory)
  validateRegularDirectoryIfExists(directoryPath, 'Project artifacts directory .openkhodam')
  validateRegularFileIfExists(filePath, 'Project artifacts file artifacts.json')
}

function validateGoogleDocsArtifactPath(projectDirectory: string, filePath: string): void {
  validateRegularDirectoryIfExists(
    getProjectArtifactsDirectoryPath(projectDirectory),
    'Project artifacts directory .openkhodam'
  )
  validateRegularDirectoryIfExists(
    getProjectArtifactDataDirectoryPath(projectDirectory),
    'Project artifacts directory .openkhodam/artifacts'
  )
  validateRegularDirectoryIfExists(
    getGoogleDocsArtifactsDirectoryPath(projectDirectory),
    'Project artifacts directory .openkhodam/artifacts/google-docs'
  )
  validateRegularFileIfExists(filePath, 'Google Docs artifact file')
}

function validateGoogleSheetsArtifactPath(projectDirectory: string, filePath: string): void {
  validateRegularDirectoryIfExists(
    getProjectArtifactsDirectoryPath(projectDirectory),
    'Project artifacts directory .openkhodam'
  )
  validateRegularDirectoryIfExists(
    getProjectArtifactDataDirectoryPath(projectDirectory),
    'Project artifacts directory .openkhodam/artifacts'
  )
  validateRegularDirectoryIfExists(
    getGoogleSheetsArtifactsDirectoryPath(projectDirectory),
    'Project artifacts directory .openkhodam/artifacts/google-sheets'
  )
  validateRegularFileIfExists(filePath, 'Google Sheets artifact file')
}

function getProjectArtifactsDirectoryPath(projectDirectory: string): string {
  return join(projectDirectory, OPENKHODAM_PROJECT_DIRECTORY_NAME)
}

function getProjectArtifactDataDirectoryPath(projectDirectory: string): string {
  return join(projectDirectory, OPENKHODAM_PROJECT_DIRECTORY_NAME, PROJECT_ARTIFACTS_DIRECTORY_NAME)
}

function getGoogleDocsArtifactsDirectoryPath(projectDirectory: string): string {
  return join(
    projectDirectory,
    OPENKHODAM_PROJECT_DIRECTORY_NAME,
    PROJECT_ARTIFACTS_DIRECTORY_NAME,
    GOOGLE_DOCS_ARTIFACTS_DIRECTORY_NAME
  )
}

function getGoogleSheetsArtifactsDirectoryPath(projectDirectory: string): string {
  return join(
    projectDirectory,
    OPENKHODAM_PROJECT_DIRECTORY_NAME,
    PROJECT_ARTIFACTS_DIRECTORY_NAME,
    GOOGLE_SHEETS_ARTIFACTS_DIRECTORY_NAME
  )
}

function getGoogleDocArtifactRelativePath(fileName: string): string {
  return posix.join(
    OPENKHODAM_PROJECT_DIRECTORY_NAME,
    PROJECT_ARTIFACTS_DIRECTORY_NAME,
    GOOGLE_DOCS_ARTIFACTS_DIRECTORY_NAME,
    fileName
  )
}

function getGoogleSheetArtifactRelativePath(fileName: string): string {
  return posix.join(
    OPENKHODAM_PROJECT_DIRECTORY_NAME,
    PROJECT_ARTIFACTS_DIRECTORY_NAME,
    GOOGLE_SHEETS_ARTIFACTS_DIRECTORY_NAME,
    fileName
  )
}

function getGoogleDocArtifactFilePath(projectDirectory: string, fileName: string): string {
  return join(
    projectDirectory,
    OPENKHODAM_PROJECT_DIRECTORY_NAME,
    PROJECT_ARTIFACTS_DIRECTORY_NAME,
    GOOGLE_DOCS_ARTIFACTS_DIRECTORY_NAME,
    fileName
  )
}

function getGoogleSheetArtifactFilePath(projectDirectory: string, fileName: string): string {
  return join(
    projectDirectory,
    OPENKHODAM_PROJECT_DIRECTORY_NAME,
    PROJECT_ARTIFACTS_DIRECTORY_NAME,
    GOOGLE_SHEETS_ARTIFACTS_DIRECTORY_NAME,
    fileName
  )
}

function getGoogleDocArtifactFilePathFromRelativePath(
  projectDirectory: string,
  artifactPath: string
): string {
  const fileName = artifactPath.split('/')[3] ?? ''
  return getGoogleDocArtifactFilePath(projectDirectory, fileName)
}

function ensureRegularDirectory(directoryPath: string, displayName: string): void {
  const directoryStat = lstatIfExists(directoryPath)
  if (directoryStat) {
    validateDirectoryStat(directoryStat, displayName)
    return
  }

  try {
    mkdirSync(directoryPath)
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'EEXIST') throw error
  }

  validateRegularDirectoryIfExists(directoryPath, displayName)
}

function validateRegularDirectoryIfExists(directoryPath: string, displayName: string): void {
  const directoryStat = lstatIfExists(directoryPath)
  if (!directoryStat) return
  validateDirectoryStat(directoryStat, displayName)
}

function validateDirectoryStat(stat: FileStat, displayName: string): void {
  if (stat.isSymbolicLink()) {
    throw new Error(`${displayName} must not be a symlink.`)
  }
  if (!stat.isDirectory()) {
    throw new Error(`${displayName} must be a directory.`)
  }
}

function validateRegularFileIfExists(filePath: string, displayName: string): void {
  const fileStat = lstatIfExists(filePath)
  if (!fileStat) return
  if (fileStat.isSymbolicLink()) {
    throw new Error(`${displayName} must not be a symlink.`)
  }
  if (!fileStat.isFile()) {
    throw new Error(`${displayName} must be a regular file.`)
  }
}

function lstatIfExists(path: string): FileStat | null {
  try {
    return lstatSync(path)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return null
    throw error
  }
}

function createProjectArtifactsStore(input: ProjectArtifactsListInput): ProjectArtifactsFileStore {
  return new ProjectArtifactsFileStore(input.projectDirectory)
}

function normalizeSessionLinkedDocs(value: unknown): LinkedGoogleDoc[] {
  const docsById = new Map<string, LinkedGoogleDoc>()
  if (!Array.isArray(value)) return []

  for (const rawDoc of value) {
    const doc = normalizeStoredLinkedGoogleDoc(rawDoc)
    if (!doc) continue

    const existing = docsById.get(doc.id)
    docsById.set(doc.id, existing ? mergeLinkedGoogleDocs(existing, doc) : doc)
  }

  return [...docsById.values()]
}

function normalizeStoredLinkedGoogleDoc(value: unknown): LinkedGoogleDoc | null {
  if (!isRecord(value)) return null

  const id = normalizeStoredString(value.id)
  if (!id) return null

  const firstSeenAt =
    normalizeStoredTimestamp(value.firstSeenAt) ?? normalizeStoredTimestamp(value.lastSeenAt) ?? 0
  const lastSeenAt = normalizeStoredTimestamp(value.lastSeenAt) ?? firstSeenAt

  return {
    artifactPath: normalizeStoredArtifactPath(value.artifactPath),
    id,
    title: normalizeStoredString(value.title),
    url: normalizeStoredUrl(value.url),
    listed: typeof value.listed === 'boolean' ? value.listed : true,
    firstSeenAt,
    lastSeenAt,
    firstMessageId: normalizeStoredString(value.firstMessageId),
    lastMessageId: normalizeStoredString(value.lastMessageId)
  }
}

function mergeLinkedGoogleDocs(
  existing: LinkedGoogleDoc,
  incoming: LinkedGoogleDoc
): LinkedGoogleDoc {
  const firstDoc = incoming.firstSeenAt < existing.firstSeenAt ? incoming : existing
  const lastDoc = incoming.lastSeenAt >= existing.lastSeenAt ? incoming : existing

  return {
    ...lastDoc,
    firstSeenAt: firstDoc.firstSeenAt,
    firstMessageId: firstDoc.firstMessageId ?? existing.firstMessageId ?? incoming.firstMessageId,
    lastSeenAt: lastDoc.lastSeenAt,
    lastMessageId: lastDoc.lastMessageId ?? existing.lastMessageId ?? incoming.lastMessageId,
    listed: existing.listed && incoming.listed
  }
}

function normalizeLinkedGoogleDocRecordInput(
  value: LinkedGoogleDocRecord
): NormalizedLinkedGoogleDocRecord {
  if (!isRecord(value)) throw new Error('Linked Google Doc record must be an object.')

  return {
    artifactPath: normalizeInputArtifactPath(value.artifactPath),
    id: normalizeRequiredString(value.id, 'doc.id'),
    title: normalizeOptionalString(value.title),
    url: normalizeInputUrl(value.url)
  }
}

function toLinkedGoogleDoc(
  doc: NormalizedLinkedGoogleDocRecord,
  seenAt: number,
  messageId: string | null
): LinkedGoogleDoc {
  return {
    ...doc,
    listed: true,
    firstSeenAt: seenAt,
    lastSeenAt: seenAt,
    firstMessageId: messageId,
    lastMessageId: messageId
  }
}

function normalizeRequiredString(value: unknown, fieldName: string): string {
  const normalized = normalizeOptionalString(value)
  if (!normalized) throw new Error(`${fieldName} must be a non-empty string.`)
  return normalized
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (value.includes('\0')) return null

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeStoredString(value: unknown): string | null {
  return normalizeOptionalString(value)
}

function normalizeStoredTimestamp(value: unknown): number | null {
  if (typeof value !== 'number') return null
  if (!Number.isFinite(value)) return null
  return Math.max(0, Math.trunc(value))
}

function normalizeGoogleDocArtifactDocumentId(value: unknown): string {
  return normalizeRequiredString(value, 'document.id')
}

function normalizeGoogleSheetArtifactSpreadsheetId(value: unknown): string {
  return normalizeRequiredString(value, 'spreadsheet.id')
}

function createPersistedGoogleDocDocumentArtifact(
  document: GoogleDocDocumentArtifact,
  cachedAt: number
): PersistedGoogleDocDocumentArtifact {
  return {
    ...document,
    schemaVersion: GOOGLE_DOC_DOCUMENT_ARTIFACT_SCHEMA_VERSION,
    cachedAt
  }
}

function createPersistedGoogleSheetSpreadsheetArtifact(
  spreadsheet: GoogleSheetSpreadsheetArtifact,
  cachedAt: number
): PersistedGoogleSheetSpreadsheetArtifact {
  return {
    ...spreadsheet,
    schemaVersion: GOOGLE_SHEET_SPREADSHEET_ARTIFACT_SCHEMA_VERSION,
    cachedAt
  }
}

function encodeGoogleDocArtifactFileName(documentId: string): string {
  const encodedDocumentId = Buffer.from(documentId, 'utf8').toString('base64url')
  if (!isSafeEncodedGoogleDocArtifactId(encodedDocumentId)) {
    throw new Error('Google Docs document ID could not be encoded for an artifact file path.')
  }

  return `encoded-${encodedDocumentId}.json`
}

function encodeGoogleSheetArtifactFileName(spreadsheetId: string): string {
  const encodedSpreadsheetId = Buffer.from(spreadsheetId, 'utf8').toString('base64url')
  if (!isSafeEncodedGoogleSheetArtifactId(encodedSpreadsheetId)) {
    throw new Error('Google Sheets spreadsheet ID could not be encoded for an artifact file path.')
  }

  return `encoded-${encodedSpreadsheetId}.json`
}

function normalizeInputArtifactPath(value: unknown): string | null {
  const normalized = normalizeOptionalString(value)
  if (!normalized) return null
  if (!isSafeGoogleDocArtifactPath(normalized)) {
    throw new Error('Linked Google Doc artifact path must be a safe project-local path.')
  }

  return normalized
}

function normalizeRequiredGoogleDocArtifactPath(value: unknown): string {
  const normalized = normalizeRequiredString(value, 'artifactPath')
  if (!isSafeGoogleDocArtifactPath(normalized)) {
    throw new Error('Google Docs artifact path must be a safe project-local path.')
  }

  return normalized
}

function normalizeStoredArtifactPath(value: unknown): string | null {
  const normalized = normalizeStoredString(value)
  if (!normalized) return null
  return isSafeGoogleDocArtifactPath(normalized) ? normalized : null
}

function isSafeGoogleDocArtifactPath(value: string): boolean {
  if (isAbsolute(value) || value.includes('\\')) return false

  const parts = value.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) return false

  return (
    parts.length === 4 &&
    parts[0] === OPENKHODAM_PROJECT_DIRECTORY_NAME &&
    parts[1] === PROJECT_ARTIFACTS_DIRECTORY_NAME &&
    parts[2] === GOOGLE_DOCS_ARTIFACTS_DIRECTORY_NAME &&
    isSafeGoogleDocArtifactFileName(parts[3])
  )
}

function isSafeGoogleDocArtifactFileName(value: string): boolean {
  const prefix = 'encoded-'
  const suffix = '.json'
  if (!value.startsWith(prefix) || !value.endsWith(suffix)) return false

  return isSafeEncodedGoogleDocArtifactId(value.slice(prefix.length, -suffix.length))
}

function isSafeEncodedGoogleDocArtifactId(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value)
}

function isSafeEncodedGoogleSheetArtifactId(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value)
}

function normalizeInputUrl(value: unknown): string | null {
  const normalized = normalizeOptionalString(value)
  if (!normalized) return null
  if (hasSecretLikeUrlPart(normalized)) {
    throw new Error('Linked Google Doc URL includes a secret-like value.')
  }

  return normalized
}

function normalizeStoredUrl(value: unknown): string | null {
  const normalized = normalizeStoredString(value)
  if (!normalized) return null
  return hasSecretLikeUrlPart(normalized) ? null : normalized
}

function hasSecretLikeUrlPart(value: string): boolean {
  let url: URL | null = null
  try {
    url = new URL(value)
  } catch {
    url = null
  }

  if (url?.username || url?.password) return true
  return hasSecretLikeUrlSearchOrHash(value) || hasSecretLikeParsedUrlSearchOrHash(url)
}

function hasSecretLikeParsedUrlSearchOrHash(url: URL | null): boolean {
  if (!url) return false
  return hasSecretLikeParameterNames(url.search) || hasSecretLikeHashParameterNames(url.hash)
}

function hasSecretLikeUrlSearchOrHash(value: string): boolean {
  const hashIndex = value.indexOf('#')
  const beforeHash = hashIndex >= 0 ? value.slice(0, hashIndex) : value
  const hash = hashIndex >= 0 ? value.slice(hashIndex + 1) : ''

  return hasSecretLikeQueryParameterNames(beforeHash) || hasSecretLikeHashParameterNames(hash)
}

function hasSecretLikeQueryParameterNames(value: string): boolean {
  const queryIndex = value.indexOf('?')
  if (queryIndex < 0) return false
  return hasSecretLikeParameterNames(value.slice(queryIndex + 1))
}

function hasSecretLikeHashParameterNames(hash: string): boolean {
  const normalizedHash = hash.replace(/^#/, '')
  if (!normalizedHash) return false

  return (
    hasSecretLikeParameterNames(normalizedHash) || hasSecretLikeQueryParameterNames(normalizedHash)
  )
}

function hasSecretLikeParameterNames(value: string): boolean {
  const normalized = value.replace(/^\?/, '')
  if (!normalized) return false

  const params = new URLSearchParams(normalized)
  for (const key of params.keys()) {
    if (isSecretLikeFieldName(key)) return true
  }

  return false
}

function isSecretLikeFieldName(name: string): boolean {
  const normalized = name.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return (
    normalized === 'key' ||
    normalized === 'sig' ||
    normalized.includes('accesskey') ||
    normalized.includes('privatekey') ||
    normalized.includes('signature') ||
    normalized.includes('token') ||
    normalized.includes('secret') ||
    normalized.includes('credential') ||
    normalized.includes('password') ||
    normalized.includes('authorization') ||
    normalized.includes('cookie') ||
    normalized.includes('apikey')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
