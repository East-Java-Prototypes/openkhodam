import { lstatSync, mkdirSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

import type {
  LinkedSource,
  LinkedSourceAttributeValue,
  LinkedSourceAttributes,
  LinkedSourceRecord,
  ProjectSessionSourcesListInput,
  ProjectSourcesConfig,
  ProjectSourcesListInput,
  RecordLinkedSourceInput,
  UpdateLinkedSourceListingInput
} from '@openkhodam/ui/types'

import { JsonConfigFile } from '../config/json-config-file'

export const OPENKHODAM_PROJECT_DIRECTORY_NAME = '.openkhodam'
export const PROJECT_SOURCES_FILE_NAME = 'sources.json'

export type ProjectSourcesFileStoreOptions = {
  readonly now?: () => number
}

export type ProjectSourcesIntegration = {
  listProjectSources: (input: ProjectSourcesListInput) => Promise<ProjectSourcesConfig>
  listSessionSources: (input: ProjectSessionSourcesListInput) => Promise<LinkedSource[]>
  recordLinkedSource: (input: RecordLinkedSourceInput) => Promise<LinkedSource>
  delistLinkedSource: (input: UpdateLinkedSourceListingInput) => Promise<LinkedSource | null>
  relistLinkedSource: (input: UpdateLinkedSourceListingInput) => Promise<LinkedSource | null>
}

type ProjectSourcesStoreRecordInput = Omit<RecordLinkedSourceInput, 'projectDirectory'>
type ProjectSourcesStoreListingInput = Omit<UpdateLinkedSourceListingInput, 'projectDirectory'>

type NormalizedLinkedSourceRecord = {
  key: string
  provider: string
  kind: string
  id: string
  title: string | null
  url: string | null
  mimeType: string | null
  attributes: LinkedSourceAttributes
}

export class ProjectSourcesFileStore {
  readonly filePath: string
  readonly projectDirectory: string
  private readonly configFile: JsonConfigFile<ProjectSourcesConfig>
  private readonly now: () => number

  constructor(projectDirectory: string, options: ProjectSourcesFileStoreOptions = {}) {
    this.projectDirectory = normalizeProjectDirectory(projectDirectory)
    this.filePath = join(
      this.projectDirectory,
      OPENKHODAM_PROJECT_DIRECTORY_NAME,
      PROJECT_SOURCES_FILE_NAME
    )
    this.configFile = new JsonConfigFile(this.filePath, {
      defaultValue: createDefaultProjectSourcesConfig,
      normalize: normalizeProjectSourcesConfig
    })
    this.now = options.now ?? Date.now
  }

  async read(): Promise<ProjectSourcesConfig> {
    this.validateSourcesPathForRead()
    return this.configFile.read()
  }

  async write(config: ProjectSourcesConfig): Promise<void> {
    this.prepareSourcesPathForWrite()
    await this.configFile.write(config)
  }

  async listProjectSources(): Promise<ProjectSourcesConfig> {
    return this.read()
  }

  async listSessionSources(sessionId: string): Promise<LinkedSource[]> {
    const normalizedSessionId = normalizeRequiredString(sessionId, 'sessionId')
    const config = await this.read()
    return config.sessions[normalizedSessionId] ?? []
  }

  async recordLinkedSource(input: ProjectSourcesStoreRecordInput): Promise<LinkedSource> {
    const sessionId = normalizeRequiredString(input.sessionId, 'sessionId')
    const messageId = normalizeOptionalString(input.messageId)
    const source = normalizeLinkedSourceRecordInput(input.source)
    const seenAt = this.now()
    const config = await this.read()
    const sessionSources = [...(config.sessions[sessionId] ?? [])]
    const existingIndex = sessionSources.findIndex((candidate) => candidate.key === source.key)
    const nextSource = toLinkedSource(source, seenAt, messageId)

    if (existingIndex >= 0) {
      const existing = sessionSources[existingIndex]
      const updatedSource = {
        ...nextSource,
        firstSeenAt: existing.firstSeenAt,
        firstMessageId: existing.firstMessageId ?? nextSource.firstMessageId,
        listed: existing.listed
      }
      sessionSources[existingIndex] = updatedSource
      config.sessions[sessionId] = sessionSources
      await this.write(config)
      return updatedSource
    }

    sessionSources.push(nextSource)
    config.sessions[sessionId] = sessionSources
    await this.write(config)
    return nextSource
  }

  async delistLinkedSource(input: ProjectSourcesStoreListingInput): Promise<LinkedSource | null> {
    return this.setLinkedSourceListed(input, false)
  }

  async relistLinkedSource(input: ProjectSourcesStoreListingInput): Promise<LinkedSource | null> {
    return this.setLinkedSourceListed(input, true)
  }

  private async setLinkedSourceListed(
    input: ProjectSourcesStoreListingInput,
    listed: boolean
  ): Promise<LinkedSource | null> {
    const sessionId = normalizeRequiredString(input.sessionId, 'sessionId')
    const key = normalizeRequiredString(input.key, 'key')
    const config = await this.read()
    const sessionSources = config.sessions[sessionId]
    if (!sessionSources) return null

    const sourceIndex = sessionSources.findIndex((source) => source.key === key)
    if (sourceIndex < 0) return null

    const nextSources = [...sessionSources]
    const updatedSource = { ...nextSources[sourceIndex], listed }
    nextSources[sourceIndex] = updatedSource
    config.sessions[sessionId] = nextSources
    await this.write(config)
    return updatedSource
  }

  private validateProjectDirectory(): void {
    if (normalizeProjectDirectory(this.projectDirectory) !== this.projectDirectory) {
      throw new Error('projectDirectory canonical path changed.')
    }
  }

  private validateSourcesPathForRead(): void {
    this.validateProjectDirectory()
    validateProjectSourcesPath(this.projectDirectory, this.filePath)
  }

  private prepareSourcesPathForWrite(): void {
    this.validateProjectDirectory()
    ensureProjectSourcesDirectory(this.projectDirectory)
    validateProjectSourcesPath(this.projectDirectory, this.filePath)
  }
}

export function createProjectSourcesIntegration(): ProjectSourcesIntegration {
  return {
    async listProjectSources(input) {
      return createProjectSourcesStore(input).listProjectSources()
    },
    async listSessionSources(input) {
      return createProjectSourcesStore(input).listSessionSources(input.sessionId)
    },
    async recordLinkedSource(input) {
      return createProjectSourcesStore(input).recordLinkedSource({
        messageId: input.messageId,
        sessionId: input.sessionId,
        source: input.source
      })
    },
    async delistLinkedSource(input) {
      return createProjectSourcesStore(input).delistLinkedSource({
        key: input.key,
        sessionId: input.sessionId
      })
    },
    async relistLinkedSource(input) {
      return createProjectSourcesStore(input).relistLinkedSource({
        key: input.key,
        sessionId: input.sessionId
      })
    }
  }
}

export function createDefaultProjectSourcesConfig(): ProjectSourcesConfig {
  return {
    version: 1,
    sessions: {}
  }
}

export function normalizeProjectSourcesConfig(value: unknown): ProjectSourcesConfig {
  const config = isRecord(value) ? value : {}
  const sessions = isRecord(config.sessions) ? config.sessions : {}
  const normalizedSessions: ProjectSourcesConfig['sessions'] = {}

  for (const [rawSessionId, rawSessionSources] of Object.entries(sessions)) {
    const sessionId = normalizeStoredString(rawSessionId)
    if (!sessionId) continue

    const linkedSources = normalizeSessionLinkedSources(rawSessionSources)
    if (linkedSources.length > 0) normalizedSessions[sessionId] = linkedSources
  }

  return {
    version: 1,
    sessions: normalizedSessions
  }
}

export function createLinkedSourceKey(provider: string, kind: string, id: string): string {
  return `${provider}:${kind}:${id}`
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

function ensureProjectSourcesDirectory(projectDirectory: string): void {
  const directoryPath = getProjectSourcesDirectoryPath(projectDirectory)
  if (lstatIfExists(directoryPath)) return

  try {
    mkdirSync(directoryPath)
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'EEXIST') throw error
  }
}

function validateProjectSourcesPath(projectDirectory: string, filePath: string): void {
  const directoryPath = getProjectSourcesDirectoryPath(projectDirectory)
  const directoryStat = lstatIfExists(directoryPath)
  if (!directoryStat) return
  if (directoryStat.isSymbolicLink()) {
    throw new Error('Project sources directory .openkhodam must not be a symlink.')
  }
  if (!directoryStat.isDirectory()) {
    throw new Error('Project sources directory .openkhodam must be a directory.')
  }

  const fileStat = lstatIfExists(filePath)
  if (!fileStat) return
  if (fileStat.isSymbolicLink()) {
    throw new Error('Project sources file sources.json must not be a symlink.')
  }
  if (!fileStat.isFile()) {
    throw new Error('Project sources file sources.json must be a regular file.')
  }
}

function getProjectSourcesDirectoryPath(projectDirectory: string): string {
  return join(projectDirectory, OPENKHODAM_PROJECT_DIRECTORY_NAME)
}

function lstatIfExists(path: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(path)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return null
    throw error
  }
}

function createProjectSourcesStore(input: ProjectSourcesListInput): ProjectSourcesFileStore {
  return new ProjectSourcesFileStore(input.projectDirectory)
}

function normalizeSessionLinkedSources(value: unknown): LinkedSource[] {
  const rawSources = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.linkedSources)
      ? value.linkedSources
      : []
  const sourcesByKey = new Map<string, LinkedSource>()

  for (const rawSource of rawSources) {
    const source = normalizeStoredLinkedSource(rawSource)
    if (!source) continue

    const existing = sourcesByKey.get(source.key)
    sourcesByKey.set(source.key, existing ? mergeLinkedSources(existing, source) : source)
  }

  return [...sourcesByKey.values()]
}

function normalizeStoredLinkedSource(value: unknown): LinkedSource | null {
  if (!isRecord(value)) return null

  const provider = normalizeStoredString(value.provider)
  const kind = normalizeStoredString(value.kind)
  const id = normalizeStoredString(value.id)
  if (!provider || !kind || !id) return null

  const firstSeenAt =
    normalizeStoredTimestamp(value.firstSeenAt) ?? normalizeStoredTimestamp(value.lastSeenAt) ?? 0
  const lastSeenAt = normalizeStoredTimestamp(value.lastSeenAt) ?? firstSeenAt

  return {
    key: normalizeStoredString(value.key) ?? createLinkedSourceKey(provider, kind, id),
    provider,
    kind,
    id,
    title: normalizeStoredString(value.title),
    url: normalizeStoredUrl(value.url),
    mimeType: normalizeStoredString(value.mimeType),
    attributes: normalizeStoredAttributes(value.attributes),
    listed: typeof value.listed === 'boolean' ? value.listed : true,
    firstSeenAt,
    lastSeenAt,
    firstMessageId: normalizeStoredString(value.firstMessageId),
    lastMessageId: normalizeStoredString(value.lastMessageId)
  }
}

function mergeLinkedSources(existing: LinkedSource, incoming: LinkedSource): LinkedSource {
  const firstSource = incoming.firstSeenAt < existing.firstSeenAt ? incoming : existing
  const lastSource = incoming.lastSeenAt >= existing.lastSeenAt ? incoming : existing

  return {
    ...lastSource,
    firstSeenAt: firstSource.firstSeenAt,
    firstMessageId:
      firstSource.firstMessageId ?? existing.firstMessageId ?? incoming.firstMessageId,
    lastSeenAt: lastSource.lastSeenAt,
    lastMessageId: lastSource.lastMessageId ?? existing.lastMessageId ?? incoming.lastMessageId,
    listed: existing.listed && incoming.listed,
    attributes: {
      ...existing.attributes,
      ...incoming.attributes
    }
  }
}

function normalizeLinkedSourceRecordInput(value: LinkedSourceRecord): NormalizedLinkedSourceRecord {
  if (!isRecord(value)) throw new Error('Linked source record must be an object.')

  assertNoSecretLikeFields(value)

  const provider = normalizeRequiredString(value.provider, 'source.provider')
  const kind = normalizeRequiredString(value.kind, 'source.kind')
  const id = normalizeRequiredString(value.id, 'source.id')

  return {
    key: normalizeOptionalString(value.key) ?? createLinkedSourceKey(provider, kind, id),
    provider,
    kind,
    id,
    title: normalizeOptionalString(value.title),
    url: normalizeInputUrl(value.url),
    mimeType: normalizeOptionalString(value.mimeType),
    attributes: normalizeInputAttributes(value.attributes)
  }
}

function toLinkedSource(
  source: NormalizedLinkedSourceRecord,
  seenAt: number,
  messageId: string | null
): LinkedSource {
  return {
    ...source,
    listed: true,
    firstSeenAt: seenAt,
    lastSeenAt: seenAt,
    firstMessageId: messageId,
    lastMessageId: messageId
  }
}

function normalizeInputAttributes(value: LinkedSourceRecord['attributes']): LinkedSourceAttributes {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new Error('Linked source attributes must be an object.')

  const attributes: LinkedSourceAttributes = {}
  for (const [key, attributeValue] of Object.entries(value)) {
    const normalizedKey = normalizeRequiredString(key, 'source.attributes key')
    if (isSecretLikeFieldName(normalizedKey)) {
      throw new Error(`Linked source payload includes secret-like field "attributes.${key}".`)
    }

    if (!isLinkedSourceAttributeValue(attributeValue)) {
      throw new Error(`Linked source attribute "${key}" must be a primitive JSON value.`)
    }

    attributes[normalizedKey] = attributeValue
  }

  return attributes
}

function normalizeStoredAttributes(value: unknown): LinkedSourceAttributes {
  if (!isRecord(value)) return {}

  const attributes: LinkedSourceAttributes = {}
  for (const [key, attributeValue] of Object.entries(value)) {
    const normalizedKey = normalizeStoredString(key)
    if (!normalizedKey || isSecretLikeFieldName(normalizedKey)) continue
    if (!isLinkedSourceAttributeValue(attributeValue)) continue
    attributes[normalizedKey] = attributeValue
  }

  return attributes
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

function normalizeInputUrl(value: unknown): string | null {
  const normalized = normalizeOptionalString(value)
  if (!normalized) return null
  if (hasSecretLikeUrlPart(normalized)) {
    throw new Error('Linked source URL includes a secret-like value.')
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

function assertNoSecretLikeFields(value: unknown, path = 'source'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretLikeFields(item, `${path}[${index}]`))
    return
  }

  if (!isRecord(value)) return

  for (const [key, nestedValue] of Object.entries(value)) {
    if (!isAllowedSourceSchemaField(path, key) && isSecretLikeFieldName(key)) {
      throw new Error(`Linked source payload includes secret-like field "${path}.${key}".`)
    }

    assertNoSecretLikeFields(nestedValue, `${path}.${key}`)
  }
}

function isAllowedSourceSchemaField(path: string, key: string): boolean {
  return path === 'source' && key === 'key'
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

function isLinkedSourceAttributeValue(value: unknown): value is LinkedSourceAttributeValue {
  if (typeof value === 'number') return Number.isFinite(value)
  return value === null || ['boolean', 'string'].includes(typeof value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
