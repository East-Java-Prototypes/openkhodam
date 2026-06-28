import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import type {
  WorkspaceResource,
  WorkspaceResourceAlias,
  WorkspaceResourceAttachGoogleDocInput,
  WorkspaceResourcesConfig,
  WorkspaceSessionActiveResourceInput,
  WorkspaceSessionResourceBinding
} from '@openkhodam/ui/types'

export const OPENKHODAM_PROJECT_DIRECTORY_NAME = '.openkhodam'
export const WORKSPACE_RESOURCES_FILE_NAME = 'resources.json'

type ParsedGoogleDocUrl = Pick<WorkspaceResource, 'provider' | 'kind' | 'id' | 'url'>

export class WorkspaceResourcesFileStore {
  readonly filePath: string
  readonly projectDirectory: string

  constructor(projectDirectory: string) {
    this.projectDirectory = normalizeProjectDirectory(projectDirectory)
    this.filePath = join(
      this.projectDirectory,
      OPENKHODAM_PROJECT_DIRECTORY_NAME,
      WORKSPACE_RESOURCES_FILE_NAME
    )
  }

  async read(): Promise<WorkspaceResourcesConfig> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return normalizeWorkspaceResourcesConfig(JSON.parse(raw) as Partial<WorkspaceResourcesConfig>)
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return createDefaultWorkspaceResourcesConfig()
      }

      throw error
    }
  }

  async write(config: WorkspaceResourcesConfig): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`
    const handle = await open(temporaryPath, 'w', 0o600)

    try {
      await handle.writeFile(
        `${JSON.stringify(normalizeWorkspaceResourcesConfig(config), null, 2)}\n`,
        'utf8'
      )
      await handle.sync()
    } finally {
      await handle.close()
    }

    try {
      await rename(temporaryPath, this.filePath)
    } catch (error) {
      await rm(temporaryPath, { force: true })
      throw error
    }
  }

  async attachGoogleDoc(
    input: Omit<WorkspaceResourceAttachGoogleDocInput, 'projectDirectory'>
  ): Promise<WorkspaceResourcesConfig> {
    const alias = normalizeAlias(input.alias)
    const parsed = parseGoogleDocsUrl(input.url)
    const title = input.title?.trim() || alias
    const config = await this.read()
    const resource: WorkspaceResource = {
      alias,
      provider: parsed.provider,
      kind: parsed.kind,
      id: parsed.id,
      title,
      url: parsed.url
    }
    const existingIndex = config.resources.findIndex((item) => item.alias === alias)
    const resources = [...config.resources]

    if (existingIndex === -1) {
      resources.push(resource)
    } else {
      resources[existingIndex] = resource
    }

    const nextConfig = normalizeWorkspaceResourcesConfig({
      ...config,
      resources,
      defaultResource: config.defaultResource ?? alias
    })
    await this.write(nextConfig)
    return nextConfig
  }

  async setSessionActiveResource(
    sessionId: string,
    activeResource: WorkspaceResourceAlias | null
  ): Promise<WorkspaceResourcesConfig> {
    const normalizedSessionId = normalizeSessionId(sessionId)
    const config = await this.read()
    const aliases = new Set(config.resources.map((resource) => resource.alias))
    const normalizedActiveResource = activeResource === null ? null : normalizeAlias(activeResource)

    if (normalizedActiveResource !== null && !aliases.has(normalizedActiveResource)) {
      throw new Error(`Google Doc resource "${normalizedActiveResource}" is not attached to this project.`)
    }

    const current = config.sessions[normalizedSessionId]
    const resources = normalizedActiveResource
      ? uniqueAliases([normalizedActiveResource, ...(current?.resources ?? [])], aliases)
      : uniqueAliases(current?.resources ?? [], aliases)
    const sessions: WorkspaceResourcesConfig['sessions'] = {
      ...config.sessions,
      [normalizedSessionId]: {
        activeResource: normalizedActiveResource,
        resources,
        updatedAt: Date.now()
      }
    }
    const nextConfig = normalizeWorkspaceResourcesConfig({ ...config, sessions })
    await this.write(nextConfig)
    return nextConfig
  }
}

export function createWorkspaceResourcesIntegration() {
  return {
    getResources: async (projectDirectory: string): Promise<WorkspaceResourcesConfig> => {
      return new WorkspaceResourcesFileStore(projectDirectory).read()
    },
    attachGoogleDoc: async (
      input: WorkspaceResourceAttachGoogleDocInput
    ): Promise<WorkspaceResourcesConfig> => {
      return new WorkspaceResourcesFileStore(input.projectDirectory).attachGoogleDoc({
        alias: input.alias,
        title: input.title,
        url: input.url
      })
    },
    setSessionActiveResource: async (
      input: WorkspaceSessionActiveResourceInput
    ): Promise<WorkspaceResourcesConfig> => {
      return new WorkspaceResourcesFileStore(input.projectDirectory).setSessionActiveResource(
        input.sessionId,
        input.activeResource
      )
    }
  }
}

export function createDefaultWorkspaceResourcesConfig(): WorkspaceResourcesConfig {
  return {
    version: 1,
    resources: [],
    defaultResource: null,
    sessions: {}
  }
}

export function parseGoogleDocsUrl(rawUrl: string): ParsedGoogleDocUrl {
  const trimmed = rawUrl.trim()
  if (!trimmed) throw new Error('Google Docs URL is required.')

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('Enter a valid Google Docs URL.')
  }

  if (url.protocol !== 'https:') {
    throw new Error('Only HTTPS Google Docs URLs are supported.')
  }

  if (url.hostname !== 'docs.google.com') {
    throw new Error('Only docs.google.com Google Docs URLs are supported.')
  }

  const segments = url.pathname.split('/').filter(Boolean)
  const product = segments[0]

  if (product === 'spreadsheets') {
    throw new Error('Google Sheets URLs are not supported yet. Attach a Google Docs document URL.')
  }

  if (product === 'presentation') {
    throw new Error('Google Slides URLs are not supported yet. Attach a Google Docs document URL.')
  }

  if (product !== 'document') {
    throw new Error('Only Google Docs document URLs are supported.')
  }

  const markerIndex = segments.indexOf('d')
  const id = markerIndex === -1 ? null : segments[markerIndex + 1]

  if (!id || id.length < 8 || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(
      'Enter a Google Docs document URL like https://docs.google.com/document/d/<document-id>/edit.'
    )
  }

  return {
    provider: 'google',
    kind: 'doc',
    id,
    url: `https://docs.google.com/document/d/${id}/edit`
  }
}

export function normalizeWorkspaceResourcesConfig(
  config: Partial<WorkspaceResourcesConfig>
): WorkspaceResourcesConfig {
  const resources = normalizeResourceList(config.resources)
  const aliases = new Set(resources.map((resource) => resource.alias))
  const requestedDefault = typeof config.defaultResource === 'string' ? config.defaultResource : null
  const defaultResource = requestedDefault && aliases.has(requestedDefault)
    ? requestedDefault
    : resources[0]?.alias ?? null

  return {
    version: 1,
    resources,
    defaultResource,
    sessions: normalizeSessions(config.sessions, aliases)
  }
}

function normalizeResourceList(resources: unknown): WorkspaceResource[] {
  if (!Array.isArray(resources)) return []

  const normalized: WorkspaceResource[] = []
  const seenAliases = new Set<string>()

  for (const resource of resources) {
    const normalizedResource = normalizeWorkspaceResource(resource)
    if (!normalizedResource || seenAliases.has(normalizedResource.alias)) continue
    seenAliases.add(normalizedResource.alias)
    normalized.push(normalizedResource)
  }

  return normalized
}

function normalizeWorkspaceResource(value: unknown): WorkspaceResource | null {
  if (!isRecord(value)) return null
  if (value.provider !== 'google' || value.kind !== 'doc') return null
  if (typeof value.alias !== 'string') return null
  if (typeof value.url !== 'string') return null

  let alias: string
  let parsed: ParsedGoogleDocUrl
  try {
    alias = normalizeAlias(value.alias)
    parsed = parseGoogleDocsUrl(value.url)
  } catch {
    return null
  }

  return {
    alias,
    provider: 'google',
    kind: 'doc',
    id: parsed.id,
    title: typeof value.title === 'string' && value.title.trim() ? value.title.trim() : alias,
    url: parsed.url
  }
}

function normalizeSessions(
  sessions: unknown,
  aliases: Set<string>
): WorkspaceResourcesConfig['sessions'] {
  if (!isRecord(sessions)) return {}

  const normalized: WorkspaceResourcesConfig['sessions'] = {}
  for (const [sessionId, binding] of Object.entries(sessions)) {
    const normalizedSessionId = normalizeOptionalSessionId(sessionId)
    const normalizedBinding = normalizeSessionBinding(binding, aliases)

    if (!normalizedSessionId || !normalizedBinding) continue
    normalized[normalizedSessionId] = normalizedBinding
  }
  return normalized
}

function normalizeSessionBinding(
  binding: unknown,
  aliases: Set<string>
): WorkspaceSessionResourceBinding | null {
  if (!isRecord(binding)) return null

  const activeResource =
    typeof binding.activeResource === 'string' && aliases.has(binding.activeResource)
      ? binding.activeResource
      : null
  const resources = uniqueAliases(Array.isArray(binding.resources) ? binding.resources : [], aliases)
  if (activeResource && !resources.includes(activeResource)) resources.unshift(activeResource)
  if (!activeResource && resources.length === 0) return null

  return {
    activeResource,
    resources,
    updatedAt: typeof binding.updatedAt === 'number' ? binding.updatedAt : 0
  }
}

function uniqueAliases(values: unknown[], aliases: Set<string>): WorkspaceResourceAlias[] {
  const unique: WorkspaceResourceAlias[] = []

  for (const value of values) {
    if (typeof value !== 'string' || !aliases.has(value) || unique.includes(value)) continue
    unique.push(value)
  }

  return unique
}

function normalizeProjectDirectory(projectDirectory: string): string {
  if (typeof projectDirectory !== 'string' || !projectDirectory.trim()) {
    throw new Error('Project directory is required before editing workspace resources.')
  }

  if (projectDirectory.includes('\0')) {
    throw new Error('Project directory is invalid.')
  }

  const resolved = resolve(projectDirectory)
  if (!isAbsolute(resolved)) {
    throw new Error('Project directory must be an absolute path.')
  }

  return resolved
}

function normalizeAlias(value: string): WorkspaceResourceAlias {
  const alias = value.trim()
  if (!alias) throw new Error('Google Docs alias is required.')
  if (alias.length > 80) throw new Error('Google Docs alias must be 80 characters or fewer.')
  if (/\p{C}/u.test(alias)) throw new Error('Google Docs alias cannot contain control characters.')
  return alias
}

function normalizeSessionId(value: string): string {
  const sessionId = normalizeOptionalSessionId(value)
  if (!sessionId) throw new Error('Session ID is required before selecting an active Google Doc.')
  return sessionId
}

function normalizeOptionalSessionId(value: string): string | null {
  const sessionId = value.trim()
  if (!sessionId || sessionId.length > 200 || /\p{C}/u.test(sessionId)) return null
  return sessionId
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
