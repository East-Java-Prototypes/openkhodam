import { join, normalize, parse } from 'node:path'

import type {
  GoogleWorkspaceIntegrationStatus,
  OpenProjectFolderInput,
  OpenedProjectFolder,
  RemoveProjectFolderInput
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
  const config = (value ?? {}) as Partial<OpenKhodamConfig>
  const google = config.integrations?.googleWorkspace
  return {
    version: 1,
    projects: {
      openedFolders: normalizeOpenedProjectFolders(config.projects?.openedFolders)
    },
    integrations: {
      googleWorkspace: {
        account: google?.account
          ? {
              email: typeof google.account.email === 'string' ? google.account.email : null,
              name: typeof google.account.name === 'string' ? google.account.name : null
            }
          : null,
        scopes: Array.isArray(google?.scopes)
          ? google.scopes.filter((scope): scope is string => typeof scope === 'string')
          : [],
        token: google?.token
          ? {
              accessToken: google.token.accessToken,
              refreshToken: google.token.refreshToken ?? null,
              expiresAt: google.token.expiresAt ?? null,
              tokenType: google.token.tokenType ?? null,
              idToken: google.token.idToken ?? null
            }
          : null,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
