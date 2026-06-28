import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

import { expect, test } from '@playwright/test'

const testsDirectory = dirname(fileURLToPath(import.meta.url))
const requireDesktopModule = createRequire(import.meta.url)
const desktopDirectory = join(testsDirectory, '..', '..', 'desktop')
const desktopOutDirectory = join(desktopDirectory, 'out')
const builtPluginPath = join(desktopOutDirectory, 'opencode-plugins', 'openkhodam-poc.mjs')
const builtGoogleWorkspacePluginPath = join(
  desktopOutDirectory,
  'opencode-plugins',
  'google-workspace.mjs'
)
const sourcePluginPath = join(
  desktopDirectory,
  'src',
  'main',
  'opencode-plugins',
  'openkhodam-poc.ts'
)
const sourceGoogleWorkspacePluginPath = join(
  desktopDirectory,
  'src',
  'main',
  'opencode-plugins',
  'google-workspace.ts'
)
const toolName = 'openkhodam_plugin_ping'
const googleDriveToolName = 'google_drive_search_files'
const googleDriveMetadataReadonlyScope = 'https://www.googleapis.com/auth/drive.metadata.readonly'

type OpenKhodamPocPlugin = {
  'experimental.chat.system.transform': (
    input: { model: { providerID: string; modelID: string }; sessionID?: string },
    output: { system: string[] }
  ) => Promise<void>
  tool: {
    openkhodam_plugin_ping: {
      description: string
      execute: (
        args: { payload?: { message?: string } },
        context: { directory: string; sessionID: string; worktree: string }
      ) => Promise<string>
    }
  }
}

type GoogleWorkspacePlugin = {
  tool: {
    google_drive_search_files: {
      description: string
      execute: (
        args: { limit?: number; query?: string },
        context: { abort?: AbortSignal }
      ) => Promise<string>
    }
  }
}

type OpenKhodamConfigFixture = {
  version: 1
  integrations: {
    googleWorkspace: {
      account: { email: string | null; name: string | null } | null
      scopes: string[]
      token: {
        accessToken: string
        expiresAt: number | null
        idToken: string | null
        refreshToken: string | null
        tokenType: string | null
      } | null
      updatedAt: number | null
    }
  }
}

type JsonConfigFileModule = typeof import('../../desktop/src/main/config/json-config-file')
type OpenKhodamConfigModule = typeof import('../../desktop/src/main/integrations/openkhodam-config')
type RuntimeConfigModule = typeof import('../../desktop/src/main/opencode-runtime-config')

test('reads defaults and writes normalized JSON config files atomically', async () => {
  const { JsonConfigFile } = loadDesktopModule<JsonConfigFileModule>(
    '../../desktop/src/main/config/json-config-file'
  )
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-json-config-'))
  const configPath = join(userDataPath, 'nested', 'config.json')
  const configFile = new JsonConfigFile(configPath, {
    defaultValue: () => ({ enabled: false, items: [] as string[] }),
    normalize: (value) => {
      const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
      return {
        enabled: record.enabled === true,
        items: Array.isArray(record.items)
          ? record.items.filter((item): item is string => typeof item === 'string')
          : []
      }
    }
  })

  try {
    await expect(configFile.read()).resolves.toEqual({ enabled: false, items: [] })

    await configFile.write({ enabled: true, items: ['one', 'two'] })

    await expect(configFile.read()).resolves.toEqual({ enabled: true, items: ['one', 'two'] })
    expect(await readFile(configPath, 'utf8')).toBe(
      '{\n  "enabled": true,\n  "items": [\n    "one",\n    "two"\n  ]\n}\n'
    )
    expect((await stat(configPath)).mode & 0o777).toBe(0o600)
  } finally {
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('keeps app-owned and generated runtime config paths and payloads stable', async () => {
  const { OpenKhodamConfigFileStore } = loadDesktopModule<OpenKhodamConfigModule>(
    '../../desktop/src/main/integrations/openkhodam-config'
  )
  const { createRuntimeOpenCodeConfig, writeRuntimeOpenCodeConfig } =
    loadDesktopModule<RuntimeConfigModule>('../../desktop/src/main/opencode-runtime-config')
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-config-stores-'))
  const appConfigPath = join(userDataPath, 'openkhodam-config.json')
  const configStore = new OpenKhodamConfigFileStore(appConfigPath)
  const pluginPaths = ['/tmp/openkhodam-poc.mjs', '/tmp/google-workspace.mjs']

  try {
    await expect(configStore.read()).resolves.toEqual({
      version: 1,
      integrations: {
        googleWorkspace: {
          account: null,
          scopes: [],
          token: null,
          updatedAt: null
        }
      }
    })

    await configStore.setGoogleWorkspaceConnection(
      { email: 'fake@example.com', name: 'Fake User' },
      ['profile', 'email', 'email'],
      {
        accessToken: 'access-token',
        expiresAt: 123,
        idToken: null,
        refreshToken: 'refresh-token',
        tokenType: 'Bearer'
      }
    )

    const appConfig = JSON.parse(await readFile(appConfigPath, 'utf8')) as OpenKhodamConfigFixture
    expect(appConfig.integrations.googleWorkspace.account).toEqual({
      email: 'fake@example.com',
      name: 'Fake User'
    })
    expect(appConfig.integrations.googleWorkspace.scopes).toEqual(['email', 'profile'])
    expect(appConfig.integrations.googleWorkspace.token).toEqual({
      accessToken: 'access-token',
      expiresAt: 123,
      idToken: null,
      refreshToken: 'refresh-token',
      tokenType: 'Bearer'
    })
    expect(typeof appConfig.integrations.googleWorkspace.updatedAt).toBe('number')
    expect((await stat(appConfigPath)).mode & 0o777).toBe(0o600)

    const runtimeConfigPath = await writeRuntimeOpenCodeConfig(userDataPath, pluginPaths)
    expect(runtimeConfigPath).toBe(
      join(userDataPath, 'opencode-sidecar', 'runtime-opencode-config.json')
    )
    expect(JSON.parse(await readFile(runtimeConfigPath, 'utf8'))).toEqual(
      createRuntimeOpenCodeConfig(pluginPaths)
    )
    expect((await stat(runtimeConfigPath)).mode & 0o777).toBe(0o600)
  } finally {
    await rm(userDataPath, { recursive: true, force: true })
  }
})

function loadDesktopModule<TModule>(path: string): TModule {
  return requireDesktopModule(path) as TModule
}

test('resolves the bundled and packaged OpenKhodam plugin paths', () => {
  expect(sourcePluginPath).toBe(
    join(desktopDirectory, 'src', 'main', 'opencode-plugins', 'openkhodam-poc.ts')
  )
  expect(sourceGoogleWorkspacePluginPath).toBe(
    join(desktopDirectory, 'src', 'main', 'opencode-plugins', 'google-workspace.ts')
  )
  expect(builtPluginPath).toBe(join(desktopOutDirectory, 'opencode-plugins', 'openkhodam-poc.mjs'))
  expect(builtGoogleWorkspacePluginPath).toBe(
    join(desktopOutDirectory, 'opencode-plugins', 'google-workspace.mjs')
  )

  const resourcesPath = join('/Applications', 'OpenKhodam.app', 'Contents', 'Resources')
  const packagedPluginPath = join(resourcesPath, 'opencode-plugins', 'openkhodam-poc.mjs')
  const packagedGoogleWorkspacePluginPath = join(
    resourcesPath,
    'opencode-plugins',
    'google-workspace.mjs'
  )
  expect(packagedPluginPath).toBe(
    '/Applications/OpenKhodam.app/Contents/Resources/opencode-plugins/openkhodam-poc.mjs'
  )
  expect(packagedGoogleWorkspacePluginPath).toBe(
    '/Applications/OpenKhodam.app/Contents/Resources/opencode-plugins/google-workspace.mjs'
  )
  expect(packagedPluginPath).not.toContain('app.asar')
  expect(packagedGoogleWorkspacePluginPath).not.toContain('app.asar')
})

test('keeps the packaged plugin copy target aligned with the runtime path', async () => {
  const builderConfig = await readFile(join(desktopDirectory, 'electron-builder.yml'), 'utf8')

  expect(builderConfig).toContain('from: out/opencode-plugins/openkhodam-poc.mjs')
  expect(builderConfig).toContain('to: opencode-plugins/openkhodam-poc.mjs')
  expect(builderConfig).toContain('from: out/opencode-plugins/google-workspace.mjs')
  expect(builderConfig).toContain('to: opencode-plugins/google-workspace.mjs')
})

test('loads the ESM bundled plugin with the OpenCode loader-compatible module shape', async () => {
  const pluginModule = (await import(pathToFileURL(builtPluginPath).href)) as Record<
    string,
    unknown
  >

  expect(Object.keys(pluginModule)).toEqual(['OpenKhodamPoc'])
  expect(typeof pluginModule.OpenKhodamPoc).toBe('function')

  const plugin = await (pluginModule.OpenKhodamPoc as () => Promise<OpenKhodamPocPlugin>)()

  expect(plugin.tool.openkhodam_plugin_ping.description).toContain('non-sensitive')

  const system = [] as string[]
  await plugin['experimental.chat.system.transform'](
    { model: { providerID: 'fake-provider', modelID: 'fake-model' } },
    { system }
  )
  expect(system).toEqual([
    'OpenKhodam Desktop loaded the bundled openkhodam-poc plugin; openkhodam_plugin_ping is available.'
  ])

  const pingContext = {
    directory: '/tmp/project',
    sessionID: 'session-123',
    worktree: '/tmp/project'
  }

  const echoed = JSON.parse(
    await plugin.tool.openkhodam_plugin_ping.execute({ payload: { message: 'hello' } }, pingContext)
  ) as {
    hasDirectory: boolean
    hasSessionID: boolean
    hasWorktree: boolean
    message: string
    ok: boolean
    plugin: string
    tool: string
  }

  expect(echoed).toEqual({
    hasDirectory: true,
    hasSessionID: true,
    hasWorktree: true,
    message: 'hello',
    ok: true,
    plugin: 'openkhodam-poc',
    tool: toolName
  })

  const pong = JSON.parse(
    await plugin.tool.openkhodam_plugin_ping.execute({ payload: {} }, pingContext)
  ) as { message: string }
  expect(pong.message).toBe('pong')
})

test('loads the Google Workspace ESM plugin and searches Drive with safe metadata', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-google-drive-'))
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const originalClientId = process.env.OPENKHODAM_GOOGLE_OAUTH_CLIENT_ID
  const originalClientSecret = process.env.OPENKHODAM_GOOGLE_OAUTH_CLIENT_SECRET
  let tokenBody: string | null = null
  let driveAuthorization: string | null = null
  let driveUrl: URL | null = null

  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', 'openid', 'profile', googleDriveMetadataReadonlyScope],
    token: {
      accessToken: 'expired-access-token',
      expiresAt: Date.now() - 1_000,
      idToken: 'old-id-token',
      refreshToken: 'refresh-token',
      tokenType: 'Bearer'
    },
    updatedAt: Date.now() - 1_000
  })

  process.env.OPENKHODAM_CONFIG_PATH = configPath
  process.env.OPENKHODAM_GOOGLE_OAUTH_CLIENT_ID = 'fake-client-id'
  process.env.OPENKHODAM_GOOGLE_OAUTH_CLIENT_SECRET = 'fake-client-secret'
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)

    if (url === 'https://oauth2.googleapis.com/token') {
      const body = init?.body
      tokenBody = body instanceof URLSearchParams ? body.toString() : (body?.toString() ?? null)
      return new Response(
        JSON.stringify({
          access_token: 'new-access-token',
          expires_in: 3600,
          scope: `openid email profile ${googleDriveMetadataReadonlyScope}`,
          token_type: 'Bearer'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    if (url.startsWith('https://www.googleapis.com/drive/v3/files')) {
      driveUrl = new URL(url)
      driveAuthorization = new Headers(init?.headers).get('authorization')
      return new Response(
        JSON.stringify({
          files: [
            {
              accessToken: 'should-not-leak',
              id: 'file-1',
              mimeType: 'application/pdf',
              modifiedTime: '2026-06-25T12:00:00.000Z',
              name: 'Budget Plan',
              owners: [{ emailAddress: 'owner@example.com' }],
              webViewLink: 'https://drive.google.com/file/d/file-1/view'
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    throw new Error(`Unexpected fetch URL: ${url}`)
  }) as typeof fetch

  try {
    const plugin = await loadGoogleWorkspacePlugin()
    expect(plugin.tool.google_drive_search_files.description).toContain('metadata only')

    const output = JSON.parse(
      await plugin.tool.google_drive_search_files.execute(
        { limit: 50, query: "budget's \\ plan" },
        {}
      )
    ) as {
      files: Array<Record<string, unknown>>
    }

    expect(tokenBody).not.toBeNull()
    const tokenParams = new URLSearchParams(tokenBody ?? '')
    expect(tokenParams.get('client_id')).toBe('fake-client-id')
    expect(tokenParams.get('client_secret')).toBe('fake-client-secret')
    expect(tokenParams.get('grant_type')).toBe('refresh_token')
    expect(tokenParams.get('refresh_token')).toBe('refresh-token')
    expect(driveAuthorization).toBe('Bearer new-access-token')
    expect(driveUrl?.searchParams.get('pageSize')).toBe('20')
    expect(driveUrl?.searchParams.get('fields')).toBe(
      'files(id,name,mimeType,modifiedTime,webViewLink)'
    )
    expect(driveUrl?.searchParams.get('q')).toBe(
      "name contains 'budget\\'s \\\\ plan' and trashed = false"
    )
    expect(output).toEqual({
      files: [
        {
          id: 'file-1',
          mimeType: 'application/pdf',
          modifiedTime: '2026-06-25T12:00:00.000Z',
          name: 'Budget Plan',
          webViewLink: 'https://drive.google.com/file/d/file-1/view'
        }
      ]
    })

    const outputText = JSON.stringify(output)
    expect(outputText).not.toContain('expired-access-token')
    expect(outputText).not.toContain('new-access-token')
    expect(outputText).not.toContain('refresh-token')
    expect(outputText).not.toContain('should-not-leak')
    expect(outputText).not.toContain('owner@example.com')

    const persisted = JSON.parse(await readFile(configPath, 'utf8')) as OpenKhodamConfigFixture
    expect(persisted.integrations.googleWorkspace.token?.accessToken).toBe('new-access-token')
    expect(persisted.integrations.googleWorkspace.token?.refreshToken).toBe('refresh-token')
    expect(persisted.integrations.googleWorkspace.scopes).toEqual([
      'email',
      googleDriveMetadataReadonlyScope,
      'openid',
      'profile'
    ])
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    restoreEnv('OPENKHODAM_GOOGLE_OAUTH_CLIENT_ID', originalClientId)
    restoreEnv('OPENKHODAM_GOOGLE_OAUTH_CLIENT_SECRET', originalClientSecret)
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('returns a clear Settings connection error when Google Workspace is disconnected', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-google-disconnected-'))
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH

  process.env.OPENKHODAM_CONFIG_PATH = configPath

  try {
    const plugin = await loadGoogleWorkspacePlugin()
    await expect(
      plugin.tool.google_drive_search_files.execute({ query: 'budget' }, {})
    ).rejects.toThrow(
      'Google Workspace is disconnected. Connect Google Workspace in Settings before using google_drive_search_files.'
    )
  } finally {
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('returns a clear reconnect error when the Drive metadata scope is missing', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-google-missing-scope-'))
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH

  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', 'openid', 'profile'],
    token: {
      accessToken: 'valid-access-token',
      expiresAt: Date.now() + 60 * 60 * 1000,
      idToken: null,
      refreshToken: 'refresh-token',
      tokenType: 'Bearer'
    },
    updatedAt: Date.now()
  })
  process.env.OPENKHODAM_CONFIG_PATH = configPath

  try {
    const plugin = await loadGoogleWorkspacePlugin()
    await expect(
      plugin.tool.google_drive_search_files.execute({ query: 'budget' }, {})
    ).rejects.toThrow(
      'Google Drive access is not enabled. Reconnect Google Workspace in Settings to grant Drive metadata read-only access.'
    )
  } finally {
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(userDataPath, { recursive: true, force: true })
  }
})

async function loadGoogleWorkspacePlugin(): Promise<GoogleWorkspacePlugin> {
  const pluginModule = (await import(pathToFileURL(builtGoogleWorkspacePluginPath).href)) as Record<
    string,
    unknown
  >

  expect(Object.keys(pluginModule)).toEqual(['GoogleWorkspace'])
  expect(typeof pluginModule.GoogleWorkspace).toBe('function')

  return (pluginModule.GoogleWorkspace as () => Promise<GoogleWorkspacePlugin>)()
}

async function writeOpenKhodamConfig(
  configPath: string,
  googleWorkspace: OpenKhodamConfigFixture['integrations']['googleWorkspace']
): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: 1,
        integrations: {
          googleWorkspace
        }
      } satisfies OpenKhodamConfigFixture,
      null,
      2
    )}\n`,
    'utf8'
  )
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}

test('registers the ping tool from the ESM artifact through the real OpenCode loader', async () => {
  test.setTimeout(90_000)

  await expectOpenCodeLoadsPlugins([builtPluginPath, builtGoogleWorkspacePluginPath])
})

test('registers the ping tool from the TS source through the real OpenCode loader', async () => {
  test.setTimeout(90_000)

  await expectOpenCodeLoadsPlugins([sourcePluginPath, sourceGoogleWorkspacePluginPath])
})

async function expectOpenCodeLoadsPlugins(pluginPaths: string[]): Promise<void> {
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-opencode-loader-'))
  const runtimeConfigPath = join(userDataPath, 'opencode-sidecar', 'runtime-opencode-config.json')

  await mkdir(dirname(runtimeConfigPath), { recursive: true })
  await writeFile(
    runtimeConfigPath,
    `${JSON.stringify(
      {
        $schema: 'https://opencode.ai/config.json',
        plugin: pluginPaths
      },
      null,
      2
    )}\n`,
    'utf8'
  )

  const server = await startOpenCodeServe(createOpenCodeSmokeEnv(userDataPath, runtimeConfigPath))

  try {
    const response = await fetch(`${server.url}/experimental/tool/ids`, {
      signal: AbortSignal.timeout(30_000)
    }).catch((error) => {
      throw new Error(`Failed to fetch OpenCode tool IDs: ${String(error)}\n${server.logs()}`)
    })
    const body = await response.text()

    expect(response.status, `${body}\n${server.logs()}`).toBe(200)
    expect(JSON.parse(body) as string[]).toContain(toolName)
    expect(JSON.parse(body) as string[]).toContain(googleDriveToolName)
    expect(server.logs()).not.toMatch(/failed to load plugin/i)
  } finally {
    await server.stop()
    await rm(userDataPath, { recursive: true, force: true })
  }
}

function createOpenCodeSmokeEnv(
  userDataPath: string,
  runtimeConfigPath: string
): NodeJS.ProcessEnv {
  const profileDir = join(userDataPath, 'opencode-sidecar')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: userDataPath,
    OPENKHODAM_CONFIG_PATH: join(userDataPath, 'openkhodam-config.json'),
    OPENCODE_AUTH_CONTENT: '{}',
    OPENCODE_CLIENT: 'openkhodam-desktop',
    OPENCODE_CONFIG: runtimeConfigPath,
    OPENCODE_CONFIG_DIR: join(profileDir, 'config'),
    OPENCODE_DISABLE_AUTOCOMPACT: '1',
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_MODELS_FETCH: '1',
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    XDG_CACHE_HOME: join(profileDir, 'cache'),
    XDG_CONFIG_HOME: join(profileDir, 'config'),
    XDG_DATA_HOME: join(profileDir, 'data'),
    XDG_STATE_HOME: join(profileDir, 'state')
  }

  delete env.OPENCODE_CONFIG_CONTENT
  delete env.OPENCODE_PURE

  return env
}

async function startOpenCodeServe(env: NodeJS.ProcessEnv): Promise<{
  logs: () => string
  stop: () => Promise<void>
  url: string
}> {
  const child = spawn(
    'pnpm',
    ['exec', 'opencode', 'serve', '--hostname', '127.0.0.1', '--port', '0', '--print-logs'],
    {
      cwd: desktopDirectory,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )

  let logs = ''

  const url = await new Promise<string>((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      fail(new Error(`opencode serve did not start within 30s.\n${logs}`))
    }, 30_000)

    function finish(value: string): void {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(value)
    }

    function fail(error: Error): void {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      child.kill()
      reject(error)
    }

    function append(chunk: Buffer): void {
      logs += chunk.toString()
      const match = /opencode server listening on (https?:\/\/[^\s]+)/.exec(logs)
      if (match?.[1]) finish(match[1])
    }

    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.once('error', fail)
    child.once('exit', (code) => {
      fail(new Error(`opencode serve exited before becoming ready: ${code ?? 'unknown'}.\n${logs}`))
    })
  })

  return {
    logs: () => logs,
    stop: () => stopProcess(child),
    url
  }
}

async function stopProcess(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null) return

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 5_000)

    child.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })

    child.kill()
  })
}
