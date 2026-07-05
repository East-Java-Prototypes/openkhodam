import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, normalize, parse } from 'node:path'

import type {
  GetOpenCodeModelSelectionInput,
  GoogleWorkspaceIntegrationStatus,
  OpenCodeModelSelection,
  OpenProjectFolderInput,
  OpenedProjectFolder,
  RemoveProjectFolderInput,
  SetOpenCodeModelSelectionInput
} from '@openkhodam/ui/types'

import { JsonConfigFile } from '../config/json-config-file'

export type GoogleWorkspaceAccountConfig = {
  email: string | null
  name: string | null
}

export type GoogleWorkspaceTokenConfig = {
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null
  tokenType: string | null
  idToken: string | null
}

export type OpenKhodamConfig = {
  version: 1
  projects: {
    openedFolders: OpenedProjectFolder[]
  }
  preferences: {
    openCode: {
      modelSelectionsByDirectory: Record<string, OpenCodeModelSelection>
    }
  }
  integrations: {
    googleWorkspace: {
      account: GoogleWorkspaceAccountConfig | null
      scopes: string[]
      token: GoogleWorkspaceTokenConfig | null
      updatedAt: number | null
    }
  }
}

export const OPENKHODAM_CONFIG_FILE_NAME = 'openkhodam-config.json'

export class OpenKhodamConfigFileStore {
  readonly filePath: string
  private readonly configFile: JsonConfigFile<OpenKhodamConfig>

  constructor(filePath: string) {
    this.filePath = filePath
    this.configFile = new JsonConfigFile(filePath, {
      defaultValue: createDefaultConfig,
      normalize: normalizeConfig
    })
  }

  async read(): Promise<OpenKhodamConfig> {
    return this.configFile.read()
  }

  async write(config: OpenKhodamConfig): Promise<void> {
    await this.configFile.write(config)
  }

  async getGoogleWorkspaceStatus(configured: boolean): Promise<GoogleWorkspaceIntegrationStatus> {
    return toGoogleWorkspaceStatus(await this.read(), configured)
  }

  async listOpenedProjectFolders(): Promise<OpenedProjectFolder[]> {
    return (await this.read()).projects.openedFolders
  }

  async recordOpenedProjectFolder(input: OpenProjectFolderInput): Promise<OpenedProjectFolder> {
    const directory = normalizeOpenedProjectDirectory(input.directory)
    if (!directory) throw new Error('Project directory is required.')

    const openedFolder = { directory, lastOpenedAt: Date.now() }
    const config = await this.read()
    config.projects.openedFolders = normalizeOpenedProjectFolders([
      ...config.projects.openedFolders.filter(
        (folder) =>
          openedProjectDirectoryKey(folder.directory) !== openedProjectDirectoryKey(directory)
      ),
      openedFolder
    ])
    await this.write(config)
    return openedFolder
  }

  async removeOpenedProjectFolder(
    input: RemoveProjectFolderInput
  ): Promise<OpenedProjectFolder | null> {
    const directory = normalizeOpenedProjectDirectory(input.directory)
    if (!directory) throw new Error('Project directory is required.')

    const config = await this.read()
    const directoryKey = openedProjectDirectoryKey(directory)
    const removedFolder =
      config.projects.openedFolders.find(
        (folder) => openedProjectDirectoryKey(folder.directory) === directoryKey
      ) ?? null

    if (!removedFolder) return null

    config.projects.openedFolders = config.projects.openedFolders.filter(
      (folder) => openedProjectDirectoryKey(folder.directory) !== directoryKey
    )
    await this.write(config)
    return removedFolder
  }

  async getOpenCodeModelSelection(
    input: GetOpenCodeModelSelectionInput
  ): Promise<OpenCodeModelSelection | null> {
    const projectDirectory = normalizeModelSelectionProjectDirectory(input)
    const config = await this.read()
    return config.preferences.openCode.modelSelectionsByDirectory[projectDirectory] ?? null
  }

  async setOpenCodeModelSelection(
    input: SetOpenCodeModelSelectionInput
  ): Promise<OpenCodeModelSelection | null> {
    const projectDirectory = normalizeModelSelectionProjectDirectory(input)
    const model = normalizeInputOpenCodeModelSelection(input)
    const config = await this.read()
    const modelSelectionsByDirectory = {
      ...config.preferences.openCode.modelSelectionsByDirectory
    }

    if (model) {
      modelSelectionsByDirectory[projectDirectory] = model
    } else {
      delete modelSelectionsByDirectory[projectDirectory]
    }

    config.preferences.openCode.modelSelectionsByDirectory = modelSelectionsByDirectory
    await this.write(config)
    return model
  }

  async setGoogleWorkspaceConnection(
    account: GoogleWorkspaceAccountConfig,
    scopes: string[],
    token: GoogleWorkspaceTokenConfig
  ): Promise<GoogleWorkspaceIntegrationStatus> {
    const config = await this.read()
    config.integrations.googleWorkspace = {
      account,
      scopes: [...new Set(scopes)].sort(),
      token,
      updatedAt: Date.now()
    }
    await this.write(config)
    return toGoogleWorkspaceStatus(config, true)
  }

  async disconnectGoogleWorkspace(configured: boolean): Promise<GoogleWorkspaceIntegrationStatus> {
    const config = await this.read()
    config.integrations.googleWorkspace = {
      account: null,
      scopes: [],
      token: null,
      updatedAt: Date.now()
    }
    await this.write(config)
    return toGoogleWorkspaceStatus(config, configured)
  }
}

export class OpenKhodamConfigStore extends OpenKhodamConfigFileStore {
  constructor(userDataPath: string) {
    super(join(userDataPath, OPENKHODAM_CONFIG_FILE_NAME))
  }
}

export function createDefaultConfig(): OpenKhodamConfig {
  return {
    version: 1,
    projects: {
      openedFolders: []
    },
    preferences: {
      openCode: {
        modelSelectionsByDirectory: {}
      }
    },
    integrations: {
      googleWorkspace: {
        account: null,
        scopes: [],
        token: null,
        updatedAt: null
      }
    }
  }
}

export function toGoogleWorkspaceStatus(
  config: OpenKhodamConfig,
  configured: boolean
): GoogleWorkspaceIntegrationStatus {
  const google = normalizeConfig(config).integrations.googleWorkspace
  const updatedAt = google.updatedAt ?? Date.now()

  if (!configured) {
    return {
      state: 'not-configured',
      account: null,
      scopes: [],
      message: 'Google OAuth client ID or client secret is not configured.',
      updatedAt
    }
  }

  if (!google.account || !google.token) {
    return {
      state: 'disconnected',
      account: null,
      scopes: [],
      message: 'Google Workspace is disconnected.',
      updatedAt
    }
  }

  return {
    state: 'connected',
    account: {
      email: google.account.email,
      name: google.account.name
    },
    scopes: google.scopes,
    message: google.account.email
      ? `Connected as ${google.account.email}.`
      : 'Google Workspace is connected.',
    updatedAt
  }
}

function normalizeConfig(value: unknown): OpenKhodamConfig {
  const config = isRecord(value) ? value : {}
  const projects = isRecord(config.projects) ? config.projects : {}
  const integrations = isRecord(config.integrations) ? config.integrations : {}
  const google = isRecord(integrations.googleWorkspace) ? integrations.googleWorkspace : null
  return {
    version: 1,
    projects: {
      openedFolders: normalizeOpenedProjectFolders(projects.openedFolders)
    },
    preferences: normalizePreferencesConfig(config.preferences),
    integrations: {
      googleWorkspace: {
        account: normalizeGoogleWorkspaceAccount(google?.account),
        scopes: Array.isArray(google?.scopes)
          ? google.scopes.filter((scope): scope is string => typeof scope === 'string')
          : [],
        token: normalizeGoogleWorkspaceToken(google?.token),
        updatedAt: typeof google?.updatedAt === 'number' ? google.updatedAt : null
      }
    }
  }
}

function normalizeOpenedProjectFolders(value: unknown): OpenedProjectFolder[] {
  if (!Array.isArray(value)) return []

  const folders = new Map<string, OpenedProjectFolder>()
  for (const item of value) {
    if (!isRecord(item)) continue

    const directory = normalizeOpenedProjectDirectory(item.directory)
    if (!directory) continue

    const lastOpenedAt = normalizeLastOpenedAt(item.lastOpenedAt)
    const key = openedProjectDirectoryKey(directory)
    const existing = folders.get(key)
    if (existing && existing.lastOpenedAt > lastOpenedAt) continue

    folders.set(key, { directory, lastOpenedAt })
  }

  return [...folders.values()].sort(
    (left, right) =>
      right.lastOpenedAt - left.lastOpenedAt || left.directory.localeCompare(right.directory)
  )
}

function normalizeOpenedProjectDirectory(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const directory = value.trim()
  if (!directory) return null

  const normalized = normalize(directory)
  const root = parse(normalized).root
  if (normalized === root) return normalized

  return normalized.replace(/[\\/]+$/, '') || normalized
}

function normalizeLastOpenedAt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function openedProjectDirectoryKey(directory: string): string {
  return process.platform === 'win32' ? directory.toLocaleLowerCase() : directory
}

function normalizePreferencesConfig(value: unknown): OpenKhodamConfig['preferences'] {
  const preferences = isRecord(value) ? value : {}
  const openCode = isRecord(preferences.openCode) ? preferences.openCode : {}
  return {
    openCode: {
      modelSelectionsByDirectory: normalizeModelSelectionsByDirectory(
        openCode.modelSelectionsByDirectory
      )
    }
  }
}

function normalizeModelSelectionsByDirectory(
  value: unknown
): Record<string, OpenCodeModelSelection> {
  const selections = isRecord(value) ? value : {}
  const normalizedSelections: Record<string, OpenCodeModelSelection> = {}

  for (const [rawDirectory, rawSelection] of Object.entries(selections)) {
    const projectDirectory = normalizeStoredProjectDirectoryKey(rawDirectory)
    if (!projectDirectory) continue

    const selection = normalizeStoredOpenCodeModelSelection(rawSelection)
    if (!selection) continue

    normalizedSelections[projectDirectory] = selection
  }

  return normalizedSelections
}

function normalizeGoogleWorkspaceAccount(value: unknown): GoogleWorkspaceAccountConfig | null {
  if (!isRecord(value)) return null
  return {
    email: typeof value.email === 'string' ? value.email : null,
    name: typeof value.name === 'string' ? value.name : null
  }
}

function normalizeGoogleWorkspaceToken(value: unknown): GoogleWorkspaceTokenConfig | null {
  if (!isRecord(value)) return null
  if (typeof value.accessToken !== 'string') return null

  return {
    accessToken: value.accessToken,
    refreshToken: typeof value.refreshToken === 'string' ? value.refreshToken : null,
    expiresAt: typeof value.expiresAt === 'number' ? value.expiresAt : null,
    tokenType: typeof value.tokenType === 'string' ? value.tokenType : null,
    idToken: typeof value.idToken === 'string' ? value.idToken : null
  }
}

function normalizeModelSelectionProjectDirectory(input: unknown): string {
  const record = normalizeInputRecord(input, 'OpenCode model selection input')
  return normalizeExistingProjectDirectory(record.projectDirectory)
}

function normalizeInputOpenCodeModelSelection(input: unknown): OpenCodeModelSelection | null {
  const record = normalizeInputRecord(input, 'OpenCode model selection input')
  if (record.model === null) return null

  const model = normalizeStoredOpenCodeModelSelection(record.model)
  if (!model) throw new Error('model must include non-empty providerID and modelID strings.')
  return model
}

function normalizeExistingProjectDirectory(value: unknown): string {
  const projectDirectory = normalizeRequiredString(value, 'projectDirectory')
  if (!isAbsolute(projectDirectory)) {
    throw new Error('projectDirectory must be an absolute path.')
  }

  let canonicalPath: string
  try {
    canonicalPath = realpathSync(projectDirectory)
  } catch {
    throw new Error('projectDirectory must be an existing directory.')
  }

  let isDirectory = false
  try {
    isDirectory = statSync(canonicalPath).isDirectory()
  } catch {
    throw new Error('projectDirectory must be an existing directory.')
  }

  if (!isDirectory) throw new Error('projectDirectory must be an existing directory.')
  return canonicalPath
}

function normalizeStoredProjectDirectoryKey(value: unknown): string | null {
  const projectDirectory = normalizeOptionalString(value)
  if (!projectDirectory) return null
  if (!isAbsolute(projectDirectory)) return null

  const normalized = normalize(projectDirectory)
  if (!normalized || normalized.includes('\0') || !isAbsolute(normalized)) return null
  return normalized
}

function normalizeStoredOpenCodeModelSelection(value: unknown): OpenCodeModelSelection | null {
  if (!isRecord(value)) return null

  const providerID = normalizeOptionalString(value.providerID)
  const modelID = normalizeOptionalString(value.modelID)
  if (!providerID || !modelID) return null

  return { providerID, modelID }
}

function normalizeInputRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${fieldName} must be an object.`)
  return value
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
