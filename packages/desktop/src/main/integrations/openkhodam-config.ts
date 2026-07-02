import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import type { GoogleWorkspaceIntegrationStatus } from '@openkhodam/ui/types'
import { Effect } from 'effect'

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

export const OPENKHODAM_CONFIG_FILE_NAME = 'openkhodam-config.json'
const CONFIG_MUTATION_LOCK_TIMEOUT_MS = 10_000
const CONFIG_MUTATION_LOCK_RETRY_MS = 25

type OpenKhodamConfigFileStoreFailure =
  | OpenKhodamConfigReadError
  | OpenKhodamConfigParseError
  | OpenKhodamConfigWriteError
  | OpenKhodamConfigUpdateError
  | OpenKhodamConfigLockError

type OpenKhodamConfigProgram<A> = Effect.Effect<A, OpenKhodamConfigFileStoreFailure>

type ConfigUpdateResult<A> = {
  config: OpenKhodamConfig
  value: A
}

const mutationQueuesByConfigPath = new Map<string, Promise<void>>()

export class OpenKhodamConfigFileStore {
  readonly filePath: string
  private readonly mutationQueueKey: string

  constructor(filePath: string) {
    this.filePath = filePath
    this.mutationQueueKey = resolve(filePath)
  }

  async read(): Promise<OpenKhodamConfig> {
    return Effect.runPromise(this.readConfigEffect())
  }

  async write(config: OpenKhodamConfig): Promise<void> {
    return this.runSerializedMutation(this.writeConfigEffect(config))
  }

  async update(updater: (config: OpenKhodamConfig) => OpenKhodamConfig): Promise<OpenKhodamConfig> {
    return this.runSerializedMutation(
      this.updateConfigEffect((config) => {
        const updatedConfig = normalizeConfig(updater(config))
        return { config: updatedConfig, value: updatedConfig }
      })
    )
  }

  async getGoogleWorkspaceStatus(configured: boolean): Promise<GoogleWorkspaceIntegrationStatus> {
    return toGoogleWorkspaceStatus(await this.read(), configured)
  }

  async setGoogleWorkspaceConnection(
    account: GoogleWorkspaceAccountConfig,
    scopes: string[],
    token: GoogleWorkspaceTokenConfig
  ): Promise<GoogleWorkspaceIntegrationStatus> {
    return this.runSerializedMutation(
      this.updateConfigEffect((config) => {
        config.integrations.googleWorkspace = {
          account,
          scopes: [...new Set(scopes)].sort(),
          token,
          updatedAt: Date.now()
        }

        return { config, value: toGoogleWorkspaceStatus(config, true) }
      })
    )
  }

  async disconnectGoogleWorkspace(configured: boolean): Promise<GoogleWorkspaceIntegrationStatus> {
    return this.runSerializedMutation(
      this.updateConfigEffect((config) => {
        config.integrations.googleWorkspace = {
          account: null,
          scopes: [],
          token: null,
          updatedAt: Date.now()
        }

        return { config, value: toGoogleWorkspaceStatus(config, configured) }
      })
    )
  }

  private readConfigEffect(): OpenKhodamConfigProgram<OpenKhodamConfig> {
    const filePath = this.filePath

    return Effect.gen(function* () {
      const raw = yield* readConfigFileEffect(filePath)
      return yield* parseConfigEffect(filePath, raw)
    }).pipe(
      Effect.catchIf(
        (error) =>
          error._tag === 'OpenKhodamConfigReadError' &&
          isNodeError(error.cause) &&
          error.cause.code === 'ENOENT',
        () => Effect.succeed(createDefaultConfig())
      )
    )
  }

  private writeConfigEffect(config: OpenKhodamConfig): OpenKhodamConfigProgram<void> {
    const filePath = this.filePath
    const temporaryPath = this.createTemporaryPath()
    let temporaryFileCreated = false
    const cleanupTemporaryFile = removeTemporaryFileEffect(filePath, temporaryPath).pipe(
      Effect.catchAll(() => Effect.succeed(undefined))
    )

    return Effect.gen(function* () {
      const contents = yield* serializeConfigEffect(filePath, config)

      yield* ensureConfigDirectoryEffect(filePath)
      yield* writeTemporaryConfigEffect(filePath, temporaryPath, contents, () => {
        temporaryFileCreated = true
      })
      yield* renameConfigEffect(filePath, temporaryPath)
    }).pipe(
      Effect.tapError(() =>
        temporaryFileCreated ? cleanupTemporaryFile : Effect.succeed(undefined)
      )
    )
  }

  private updateConfigEffect<A>(
    updater: (config: OpenKhodamConfig) => ConfigUpdateResult<A>
  ): OpenKhodamConfigProgram<A> {
    const filePath = this.filePath
    const self = this

    return Effect.gen(function* () {
      const config = yield* self.readConfigEffect()
      const result = yield* applyConfigUpdateEffect(filePath, config, updater)

      yield* self.writeConfigEffect(result.config)

      return result.value
    })
  }

  private runSerializedMutation<A>(program: OpenKhodamConfigProgram<A>): Promise<A> {
    const mutationQueueKey = this.mutationQueueKey
    const previousMutation = mutationQueuesByConfigPath.get(mutationQueueKey) ?? Promise.resolve()
    const result = previousMutation.then(() =>
      Effect.runPromise(this.withMutationLockEffect(program))
    )
    const nextMutation = result.then(
      () => undefined,
      () => undefined
    )

    mutationQueuesByConfigPath.set(mutationQueueKey, nextMutation)
    void nextMutation.then(() => {
      if (mutationQueuesByConfigPath.get(mutationQueueKey) === nextMutation) {
        mutationQueuesByConfigPath.delete(mutationQueueKey)
      }
    })

    return result
  }

  private withMutationLockEffect<A>(
    program: OpenKhodamConfigProgram<A>
  ): OpenKhodamConfigProgram<A> {
    const filePath = this.filePath
    const lockPath = getConfigMutationLockPath(this.mutationQueueKey)

    return Effect.acquireUseRelease(
      acquireConfigMutationLockEffect(filePath, lockPath),
      () => program,
      () =>
        releaseConfigMutationLockEffect(filePath, lockPath).pipe(
          Effect.catchAll(() => Effect.succeed(undefined))
        )
    )
  }

  private createTemporaryPath(): string {
    return `${this.filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
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

function readConfigFileEffect(filePath: string): Effect.Effect<string, OpenKhodamConfigReadError> {
  return Effect.tryPromise({
    try: () => readFile(filePath, 'utf8'),
    catch: (cause) => new OpenKhodamConfigReadError(filePath, cause)
  })
}

function parseConfigEffect(
  filePath: string,
  raw: string
): Effect.Effect<OpenKhodamConfig, OpenKhodamConfigParseError> {
  return Effect.try({
    try: () => normalizeConfig(JSON.parse(raw) as Partial<OpenKhodamConfig>),
    catch: (cause) => new OpenKhodamConfigParseError(filePath, cause)
  })
}

function serializeConfigEffect(
  filePath: string,
  config: OpenKhodamConfig
): Effect.Effect<string, OpenKhodamConfigWriteError> {
  return Effect.try({
    try: () => `${JSON.stringify(normalizeConfig(config), null, 2)}\n`,
    catch: (cause) => new OpenKhodamConfigWriteError(filePath, cause)
  })
}

function ensureConfigDirectoryEffect(
  filePath: string
): Effect.Effect<void, OpenKhodamConfigWriteError> {
  return Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(filePath), { recursive: true })
    },
    catch: (cause) => new OpenKhodamConfigWriteError(filePath, cause)
  })
}

function writeTemporaryConfigEffect(
  filePath: string,
  temporaryPath: string,
  contents: string,
  markCreated: () => void
): Effect.Effect<void, OpenKhodamConfigWriteError> {
  return Effect.tryPromise({
    try: async () => {
      const handle = await open(temporaryPath, 'wx', 0o600)
      markCreated()

      try {
        await handle.writeFile(contents, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
    },
    catch: (cause) => new OpenKhodamConfigWriteError(filePath, cause)
  })
}

function renameConfigEffect(
  filePath: string,
  temporaryPath: string
): Effect.Effect<void, OpenKhodamConfigWriteError> {
  return Effect.tryPromise({
    try: async () => {
      await rename(temporaryPath, filePath)
    },
    catch: (cause) => new OpenKhodamConfigWriteError(filePath, cause)
  })
}

function removeTemporaryFileEffect(
  filePath: string,
  temporaryPath: string
): Effect.Effect<void, OpenKhodamConfigWriteError> {
  return Effect.tryPromise({
    try: async () => {
      await rm(temporaryPath, { force: true })
    },
    catch: (cause) => new OpenKhodamConfigWriteError(filePath, cause)
  })
}

function applyConfigUpdateEffect<A>(
  filePath: string,
  config: OpenKhodamConfig,
  updater: (config: OpenKhodamConfig) => ConfigUpdateResult<A>
): Effect.Effect<ConfigUpdateResult<A>, OpenKhodamConfigUpdateError> {
  return Effect.try({
    try: () => updater(config),
    catch: (cause) => new OpenKhodamConfigUpdateError(filePath, cause)
  })
}

function getConfigMutationLockPath(filePath: string): string {
  return `${filePath}.lock`
}

function acquireConfigMutationLockEffect(
  filePath: string,
  lockPath: string
): Effect.Effect<void, OpenKhodamConfigLockError> {
  return Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(lockPath), { recursive: true })

      const deadline = Date.now() + CONFIG_MUTATION_LOCK_TIMEOUT_MS
      let lastLockError: unknown = null

      while (Date.now() <= deadline) {
        try {
          await mkdir(lockPath, { mode: 0o700 })
          return
        } catch (error) {
          if (!isNodeError(error) || error.code !== 'EEXIST') {
            throw error
          }

          lastLockError = error
          await sleep(CONFIG_MUTATION_LOCK_RETRY_MS)
        }
      }

      throw new Error(
        `Timed out waiting for OpenKhodam config lock at ${lockPath}: ${formatErrorCause(lastLockError)}`
      )
    },
    catch: (cause) => new OpenKhodamConfigLockError(filePath, cause)
  })
}

function releaseConfigMutationLockEffect(
  filePath: string,
  lockPath: string
): Effect.Effect<void, OpenKhodamConfigLockError> {
  return Effect.tryPromise({
    try: async () => {
      await rm(lockPath, { recursive: true, force: true })
    },
    catch: (cause) => new OpenKhodamConfigLockError(filePath, cause)
  })
}

async function sleep(durationMs: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, durationMs))
}

abstract class OpenKhodamConfigFileStoreError extends Error {
  readonly filePath: string

  protected constructor(name: string, message: string, filePath: string, cause: unknown) {
    super(message, { cause })
    this.name = name
    this.filePath = filePath
  }
}

class OpenKhodamConfigReadError extends OpenKhodamConfigFileStoreError {
  readonly _tag = 'OpenKhodamConfigReadError'

  constructor(filePath: string, cause: unknown) {
    super(
      'OpenKhodamConfigReadError',
      `Failed to read OpenKhodam config at ${filePath}: ${formatErrorCause(cause)}`,
      filePath,
      cause
    )
  }
}

class OpenKhodamConfigParseError extends OpenKhodamConfigFileStoreError {
  readonly _tag = 'OpenKhodamConfigParseError'

  constructor(filePath: string, cause: unknown) {
    super(
      'OpenKhodamConfigParseError',
      `Failed to parse OpenKhodam config at ${filePath}: ${formatErrorCause(cause)}`,
      filePath,
      cause
    )
  }
}

class OpenKhodamConfigWriteError extends OpenKhodamConfigFileStoreError {
  readonly _tag = 'OpenKhodamConfigWriteError'

  constructor(filePath: string, cause: unknown) {
    super(
      'OpenKhodamConfigWriteError',
      `Failed to write OpenKhodam config at ${filePath}: ${formatErrorCause(cause)}`,
      filePath,
      cause
    )
  }
}

class OpenKhodamConfigUpdateError extends OpenKhodamConfigFileStoreError {
  readonly _tag = 'OpenKhodamConfigUpdateError'

  constructor(filePath: string, cause: unknown) {
    super(
      'OpenKhodamConfigUpdateError',
      `Failed to update OpenKhodam config at ${filePath}: ${formatErrorCause(cause)}`,
      filePath,
      cause
    )
  }
}

class OpenKhodamConfigLockError extends OpenKhodamConfigFileStoreError {
  readonly _tag = 'OpenKhodamConfigLockError'

  constructor(filePath: string, cause: unknown) {
    super(
      'OpenKhodamConfigLockError',
      `Failed to lock OpenKhodam config at ${filePath}: ${formatErrorCause(cause)}`,
      filePath,
      cause
    )
  }
}

function formatErrorCause(cause: unknown): string {
  if (cause instanceof Error && cause.message) {
    return cause.message
  }

  if (typeof cause === 'string') {
    return cause
  }

  return String(cause)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
