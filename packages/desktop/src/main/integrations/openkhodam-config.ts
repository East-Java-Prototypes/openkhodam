import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { GoogleWorkspaceIntegrationStatus } from '@openkhodam/ui/types'

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
  integrations: {
    googleWorkspace: {
      account: GoogleWorkspaceAccountConfig | null
      scopes: string[]
      token: GoogleWorkspaceTokenConfig | null
      updatedAt: number | null
    }
  }
}

const CONFIG_FILE_NAME = 'openkhodam-config.json'

export class OpenKhodamConfigStore {
  readonly filePath: string

  constructor(userDataPath: string) {
    this.filePath = join(userDataPath, CONFIG_FILE_NAME)
  }

  async read(): Promise<OpenKhodamConfig> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return normalizeConfig(JSON.parse(raw) as Partial<OpenKhodamConfig>)
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return createDefaultConfig()
      }

      throw error
    }
  }

  async write(config: OpenKhodamConfig): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`
    const handle = await open(temporaryPath, 'w', 0o600)

    try {
      await handle.writeFile(`${JSON.stringify(normalizeConfig(config), null, 2)}\n`, 'utf8')
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

  async getGoogleWorkspaceStatus(configured: boolean): Promise<GoogleWorkspaceIntegrationStatus> {
    return toGoogleWorkspaceStatus(await this.read(), configured)
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

export function createDefaultConfig(): OpenKhodamConfig {
  return {
    version: 1,
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

function normalizeConfig(config: Partial<OpenKhodamConfig>): OpenKhodamConfig {
  const google = config.integrations?.googleWorkspace
  return {
    version: 1,
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
