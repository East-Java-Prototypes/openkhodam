import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, relative } from 'node:path'

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
const googleDocsReadToolName = 'google_docs_read'
const googleDriveMetadataReadonlyScope = 'https://www.googleapis.com/auth/drive.metadata.readonly'
const googleDocsDocumentsScope = 'https://www.googleapis.com/auth/documents'

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
    google_docs_read: {
      description: string
      execute: (
        args: { documentId?: string },
        context: {
          abort?: AbortSignal
          directory?: string
          sessionID?: string
          worktree?: string
        }
      ) => Promise<string>
    }
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
type ProjectArtifactsModule = typeof import('../../desktop/src/main/integrations/project-artifacts')
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

test('stores project session linked Google Docs with stable path and dedupe timestamps', async () => {
  const { PROJECT_ARTIFACTS_CONFIG_VERSION, ProjectArtifactsFileStore } =
    loadDesktopModule<ProjectArtifactsModule>(
      '../../desktop/src/main/integrations/project-artifacts'
    )
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-project-artifacts-'))
  await mkdir(join(tempRoot, 'workspace'), { recursive: true })
  const projectPath = join(tempRoot, 'workspace', '..', 'workspace')
  const expectedProjectDirectory = await realpath(join(tempRoot, 'workspace'))
  let now = 1_000
  const store = new ProjectArtifactsFileStore(projectPath, { now: () => now })

  try {
    expect(store.projectDirectory).toBe(expectedProjectDirectory)
    expect(store.filePath).toBe(join(expectedProjectDirectory, '.openkhodam', 'artifacts.json'))
    await expect(store.read()).resolves.toEqual({
      version: PROJECT_ARTIFACTS_CONFIG_VERSION,
      sessions: {}
    })

    const recorded = await store.recordLinkedGoogleDoc({
      doc: {
        id: 'doc-1',
        title: 'Launch Plan',
        url: 'https://docs.google.com/document/d/doc-1/edit'
      },
      messageId: 'message-1',
      sessionId: 'session-1'
    })

    expect(recorded).toEqual({
      artifactPath: null,
      firstMessageId: 'message-1',
      firstSeenAt: 1_000,
      id: 'doc-1',
      lastMessageId: 'message-1',
      lastSeenAt: 1_000,
      listed: true,
      title: 'Launch Plan',
      url: 'https://docs.google.com/document/d/doc-1/edit'
    })
    expect(JSON.parse(await readFile(store.filePath, 'utf8'))).toEqual({
      version: PROJECT_ARTIFACTS_CONFIG_VERSION,
      sessions: {
        'session-1': [recorded]
      }
    })
    expect((await stat(store.filePath)).mode & 0o777).toBe(0o600)

    now = 2_000
    const rerecorded = await store.recordLinkedGoogleDoc({
      doc: {
        id: 'doc-1',
        title: 'Updated Launch Plan',
        url: 'https://docs.google.com/document/d/doc-1/edit'
      },
      messageId: 'message-2',
      sessionId: 'session-1'
    })

    expect(rerecorded).toMatchObject({
      artifactPath: null,
      firstMessageId: 'message-1',
      firstSeenAt: 1_000,
      id: 'doc-1',
      lastMessageId: 'message-2',
      lastSeenAt: 2_000,
      listed: true,
      title: 'Updated Launch Plan'
    })
    await expect(store.listSessionLinkedDocs('session-1')).resolves.toEqual([rerecorded])
    await expect(store.listProjectArtifacts()).resolves.toEqual({
      version: PROJECT_ARTIFACTS_CONFIG_VERSION,
      sessions: {
        'session-1': [rerecorded]
      }
    })
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('gets or creates linked Google Docs without rewriting existing session docs', async () => {
  const { getOrCreateLinkedGoogleDoc, ProjectArtifactsFileStore } =
    loadDesktopModule<ProjectArtifactsModule>(
      '../../desktop/src/main/integrations/project-artifacts'
    )
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-project-artifacts-get-or-create-'))
  const projectPath = join(tempRoot, 'project')
  await mkdir(projectPath, { recursive: true })
  const store = new ProjectArtifactsFileStore(projectPath)

  try {
    const created = await getOrCreateLinkedGoogleDoc({
      doc: {
        id: 'doc-1',
        title: 'Launch Plan',
        url: 'https://docs.google.com/document/d/doc-1/edit'
      },
      messageId: 'message-1',
      projectDirectory: projectPath,
      sessionId: 'session-1'
    })
    const firstFileContents = await readFile(store.filePath, 'utf8')

    const existing = await getOrCreateLinkedGoogleDoc({
      doc: {
        id: 'doc-1',
        title: 'Updated Launch Plan',
        url: 'https://docs.google.com/document/d/doc-1/edit'
      },
      messageId: 'message-2',
      projectDirectory: projectPath,
      sessionId: 'session-1'
    })

    expect(existing).toEqual(created)
    await expect(store.listSessionLinkedDocs('session-1')).resolves.toEqual([created])
    expect(await readFile(store.filePath, 'utf8')).toBe(firstFileContents)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('rejects untrusted project artifact paths before creating project memory', async () => {
  const { ProjectArtifactsFileStore, createProjectArtifactsIntegration } =
    loadDesktopModule<ProjectArtifactsModule>(
      '../../desktop/src/main/integrations/project-artifacts'
    )
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-project-artifacts-paths-'))
  const integration = createProjectArtifactsIntegration()
  const relativeProjectPath = relative(process.cwd(), join(tempRoot, 'relative-project'))
  const missingProjectPath = join(tempRoot, 'missing-project')
  const fileProjectPath = join(tempRoot, 'project-file')
  const removedProjectPath = join(tempRoot, 'removed-project')
  const doc = { id: 'doc-1' }

  try {
    await mkdir(removedProjectPath, { recursive: true })
    await writeFile(fileProjectPath, 'not a directory', 'utf8')
    const removedStore = new ProjectArtifactsFileStore(removedProjectPath)

    expect(() => new ProjectArtifactsFileStore(relativeProjectPath)).toThrow(/absolute path/)
    expect(() => new ProjectArtifactsFileStore(missingProjectPath)).toThrow(/existing directory/)
    expect(() => new ProjectArtifactsFileStore(fileProjectPath)).toThrow(/existing directory/)
    expect(() => new ProjectArtifactsFileStore('')).toThrow(/non-empty string/)
    expect(() => new ProjectArtifactsFileStore(`${tempRoot}\0bad`)).toThrow(/non-empty string/)

    await expect(
      integration.listProjectArtifacts({ projectDirectory: relativeProjectPath })
    ).rejects.toThrow(/absolute path/)
    await expect(
      integration.listSessionLinkedDocs({
        projectDirectory: missingProjectPath,
        sessionId: 'session-1'
      })
    ).rejects.toThrow(/existing directory/)
    await expect(
      integration.recordLinkedGoogleDoc({
        doc,
        messageId: 'message-1',
        projectDirectory: fileProjectPath,
        sessionId: 'session-1'
      })
    ).rejects.toThrow(/existing directory/)
    await expect(
      integration.delistLinkedGoogleDoc({
        id: 'doc-1',
        projectDirectory: relativeProjectPath,
        sessionId: 'session-1'
      })
    ).rejects.toThrow(/absolute path/)
    await expect(
      integration.relistLinkedGoogleDoc({
        id: 'doc-1',
        projectDirectory: missingProjectPath,
        sessionId: 'session-1'
      })
    ).rejects.toThrow(/existing directory/)

    await rm(removedProjectPath, { recursive: true, force: true })
    await expect(
      removedStore.recordLinkedGoogleDoc({ messageId: 'message-1', sessionId: 'session-1', doc })
    ).rejects.toThrow(/existing directory/)

    await expect(stat(join(process.cwd(), relativeProjectPath, '.openkhodam'))).rejects.toThrow()
    await expect(stat(join(missingProjectPath, '.openkhodam'))).rejects.toThrow()
    await expect(stat(join(fileProjectPath, '.openkhodam'))).rejects.toThrow()
    await expect(stat(join(removedProjectPath, '.openkhodam'))).rejects.toThrow()
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('rejects project artifact symlinks before reading or writing', async () => {
  const { ProjectArtifactsFileStore } = loadDesktopModule<ProjectArtifactsModule>(
    '../../desktop/src/main/integrations/project-artifacts'
  )
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-project-artifacts-symlink-'))
  const projectPath = join(tempRoot, 'project')
  const outsideParentTarget = join(tempRoot, 'outside-parent-target')
  const outsideFileTarget = join(tempRoot, 'outside-artifacts.json')
  const doc = { id: 'doc-1' }
  const fullDoc = {
    type: 'google.doc.document' as const,
    id: 'doc-1',
    title: 'Launch Plan',
    revision: 'rev-1',
    text: 'Hello Docs',
    link: 'https://docs.google.com/document/d/doc-1/edit',
    body: {
      blocks: [
        {
          id: 'body-block-1',
          ordinal: 1,
          type: 'paragraph' as const,
          text: 'Hello Docs'
        }
      ]
    }
  }

  try {
    await mkdir(projectPath, { recursive: true })
    await mkdir(outsideParentTarget, { recursive: true })
    await symlink(outsideParentTarget, join(projectPath, '.openkhodam'), 'dir')

    const parentSymlinkStore = new ProjectArtifactsFileStore(projectPath)
    await expect(parentSymlinkStore.read()).rejects.toThrow(/must not be a symlink/)
    await expect(
      parentSymlinkStore.recordLinkedGoogleDoc({
        messageId: 'message-1',
        sessionId: 'session-1',
        doc
      })
    ).rejects.toThrow(/must not be a symlink/)
    await expect(parentSymlinkStore.persistGoogleDocDocumentArtifact(fullDoc)).rejects.toThrow(
      /must not be a symlink/
    )
    await expect(stat(join(outsideParentTarget, 'artifacts.json'))).rejects.toThrow()

    await rm(join(projectPath, '.openkhodam'), { force: true })
    await mkdir(join(projectPath, '.openkhodam'), { recursive: true })
    await symlink(outsideParentTarget, join(projectPath, '.openkhodam', 'artifacts'), 'dir')

    const nestedSymlinkStore = new ProjectArtifactsFileStore(projectPath)
    await expect(nestedSymlinkStore.persistGoogleDocDocumentArtifact(fullDoc)).rejects.toThrow(
      /\.openkhodam\/artifacts must not be a symlink/
    )
    await expect(stat(join(outsideParentTarget, 'google-docs'))).rejects.toThrow()

    await rm(join(projectPath, '.openkhodam', 'artifacts'), { force: true })
    await writeFile(outsideFileTarget, 'outside target', 'utf8')
    await symlink(outsideFileTarget, join(projectPath, '.openkhodam', 'artifacts.json'), 'file')

    const fileSymlinkStore = new ProjectArtifactsFileStore(projectPath)
    await expect(fileSymlinkStore.read()).rejects.toThrow(/artifacts\.json must not be a symlink/)
    await expect(
      fileSymlinkStore.recordLinkedGoogleDoc({
        messageId: 'message-1',
        sessionId: 'session-1',
        doc
      })
    ).rejects.toThrow(/artifacts\.json must not be a symlink/)
    await expect(readFile(outsideFileTarget, 'utf8')).resolves.toBe('outside target')
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('preserves linked-doc delist intent until explicitly relisted', async () => {
  const { ProjectArtifactsFileStore } = loadDesktopModule<ProjectArtifactsModule>(
    '../../desktop/src/main/integrations/project-artifacts'
  )
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-project-artifacts-listing-'))
  const projectPath = join(tempRoot, 'project')
  await mkdir(projectPath, { recursive: true })
  let now = 10
  const store = new ProjectArtifactsFileStore(projectPath, { now: () => now })
  const doc = {
    id: 'doc-1',
    title: 'Launch Plan',
    url: 'https://docs.google.com/document/d/doc-1/edit'
  }

  try {
    await store.recordLinkedGoogleDoc({ doc, messageId: 'message-1', sessionId: 'session-1' })

    const delisted = await store.delistLinkedGoogleDoc({ id: 'doc-1', sessionId: 'session-1' })
    expect(delisted?.listed).toBe(false)

    now = 20
    const rerecorded = await store.recordLinkedGoogleDoc({
      doc: { ...doc, title: 'Updated Launch Plan' },
      messageId: 'message-2',
      sessionId: 'session-1'
    })
    expect(rerecorded).toMatchObject({
      firstMessageId: 'message-1',
      firstSeenAt: 10,
      lastMessageId: 'message-2',
      lastSeenAt: 20,
      listed: false,
      title: 'Updated Launch Plan'
    })

    const relisted = await store.relistLinkedGoogleDoc({ id: 'doc-1', sessionId: 'session-1' })
    expect(relisted?.listed).toBe(true)
    await expect(store.listSessionLinkedDocs('session-1')).resolves.toEqual([relisted])
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('normalizes invalid linked-doc artifact records defensively', async () => {
  const { PROJECT_ARTIFACTS_CONFIG_VERSION, ProjectArtifactsFileStore } =
    loadDesktopModule<ProjectArtifactsModule>(
      '../../desktop/src/main/integrations/project-artifacts'
    )
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-project-artifacts-normalize-'))
  const projectPath = join(tempRoot, 'project')
  await mkdir(projectPath, { recursive: true })
  const store = new ProjectArtifactsFileStore(projectPath)

  try {
    await mkdir(dirname(store.filePath), { recursive: true })
    await writeFile(
      store.filePath,
      `${JSON.stringify(
        {
          sessions: {
            ' session-a ': [
              null,
              {
                firstMessageId: ' message-1 ',
                firstSeenAt: 50.9,
                id: 'doc-1',
                lastMessageId: ' message-2 ',
                lastSeenAt: 75.2,
                listed: false,
                title: ' Original title ',
                url: 'https://docs.google.com/document/d/doc-1/edit?access_token=drop-me'
              },
              {
                firstSeenAt: 60,
                id: 'doc-1',
                lastMessageId: 'message-3',
                lastSeenAt: 100,
                listed: true,
                title: 'Newer title'
              },
              { id: '', title: 'ignored' }
            ],
            ' session-b ': [
              {
                id: 'doc-2',
                lastSeenAt: 12
              }
            ],
            ' ': [{ id: 'ignored' }],
            'session-c': 'not-a-doc-list'
          },
          version: 99
        },
        null,
        2
      )}\n`,
      'utf8'
    )

    await expect(store.read()).resolves.toEqual({
      version: PROJECT_ARTIFACTS_CONFIG_VERSION,
      sessions: {
        'session-a': [
          {
            artifactPath: null,
            firstMessageId: 'message-1',
            firstSeenAt: 50,
            id: 'doc-1',
            lastMessageId: 'message-3',
            lastSeenAt: 100,
            listed: false,
            title: 'Newer title',
            url: null
          }
        ],
        'session-b': [
          {
            artifactPath: null,
            firstMessageId: null,
            firstSeenAt: 12,
            id: 'doc-2',
            lastMessageId: null,
            lastSeenAt: 12,
            listed: true,
            title: null,
            url: null
          }
        ]
      }
    })
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('rejects secret-bearing linked-doc URLs without persisting them', async () => {
  const { ProjectArtifactsFileStore } = loadDesktopModule<ProjectArtifactsModule>(
    '../../desktop/src/main/integrations/project-artifacts'
  )
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-project-artifacts-secrets-'))
  const projectPath = join(tempRoot, 'project')
  await mkdir(projectPath, { recursive: true })
  const store = new ProjectArtifactsFileStore(projectPath)

  try {
    for (const url of [
      '/doc?key=should-not-persist',
      '/doc?sig=should-not-persist',
      'https://docs.google.com/#/doc?key=should-not-persist',
      'https://docs.google.com/#/doc?sig=should-not-persist',
      'https://docs.google.com/document/d/doc-1/edit?x-api-key=should-not-persist',
      'https://docs.google.com/document/d/doc-1/edit?accessKeyId=should-not-persist',
      'https://docs.google.com/document/d/doc-1/edit?authorizationHeader=should-not-persist',
      'https://docs.google.com/document/d/doc-1/edit#cookieHeader=should-not-persist',
      'https://docs.google.com/document/d/doc-1/edit?key=should-not-persist',
      'https://docs.google.com/document/d/doc-1/edit#key=should-not-persist',
      'https://docs.google.com/document/d/doc-1/edit?privateKey=should-not-persist',
      'https://docs.google.com/document/d/doc-1/edit?secretAccessKey=should-not-persist',
      'https://docs.google.com/document/d/doc-1/edit?sig=should-not-persist',
      'https://docs.google.com/document/d/doc-1/edit?signature=should-not-persist'
    ]) {
      await expect(
        store.recordLinkedGoogleDoc({
          doc: { id: 'doc-1', url },
          sessionId: 'session-1'
        })
      ).rejects.toThrow(/secret-like value/i)
    }

    await expect(store.read()).resolves.toEqual({ version: 1, sessions: {} })
    await expect(stat(store.filePath)).rejects.toThrow(/ENOENT|no such file/i)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
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

test('loads the Google Workspace ESM plugin and reads Google Docs artifacts safely', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-google-docs-read-'))
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const originalClientId = process.env.OPENKHODAM_GOOGLE_OAUTH_CLIENT_ID
  const originalClientSecret = process.env.OPENKHODAM_GOOGLE_OAUTH_CLIENT_SECRET
  let docsAuthorization: string | null = null
  let docsUrl: URL | null = null
  let tokenBody: string | null = null

  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleDocsDocumentsScope, 'openid', 'profile'],
    token: {
      accessToken: 'expired-docs-access-token',
      expiresAt: Date.now() - 1_000,
      idToken: null,
      refreshToken: 'refresh-token',
      tokenType: 'Bearer'
    },
    updatedAt: Date.now()
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
          access_token: 'new-docs-access-token',
          expires_in: 3600,
          scope: `openid email profile ${googleDocsDocumentsScope}`,
          token_type: 'Bearer'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    if (url.startsWith('https://docs.googleapis.com/v1/documents/doc-1')) {
      docsUrl = new URL(url)
      docsAuthorization = new Headers(init?.headers).get('authorization')
      return new Response(
        JSON.stringify({
          accessToken: 'should-not-leak',
          body: {
            content: [
              {
                startIndex: 101,
                endIndex: 112,
                paragraph: {
                  elements: [
                    { startIndex: 101, endIndex: 112, textRun: { content: 'Hello Docs\n' } }
                  ]
                }
              },
              {
                startIndex: 212,
                endIndex: 224,
                paragraph: {
                  elements: [
                    { startIndex: 212, endIndex: 224, textRun: { content: 'Second line\n' } }
                  ]
                }
              }
            ]
          },
          documentId: 'doc-1',
          owners: [{ emailAddress: 'owner@example.com' }],
          revisionId: 'rev-1',
          title: 'Docs Plan'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    throw new Error(`Unexpected fetch URL: ${url}`)
  }) as typeof fetch

  try {
    const plugin = await loadGoogleWorkspacePlugin()
    expect(plugin.tool.google_docs_read.description).toContain('google.doc.document')

    const output = JSON.parse(
      await plugin.tool.google_docs_read.execute({ documentId: ' doc-1 ' }, {})
    ) as {
      document: Record<string, unknown>
    }

    expect(tokenBody).not.toBeNull()
    const tokenParams = new URLSearchParams(tokenBody ?? '')
    expect(tokenParams.get('client_id')).toBe('fake-client-id')
    expect(tokenParams.get('client_secret')).toBe('fake-client-secret')
    expect(tokenParams.get('grant_type')).toBe('refresh_token')
    expect(tokenParams.get('refresh_token')).toBe('refresh-token')
    expect(docsAuthorization).toBe('Bearer new-docs-access-token')
    expect(docsUrl?.pathname).toBe('/v1/documents/doc-1')
    expect(docsUrl?.searchParams.get('fields')).toBe(
      'documentId,title,revisionId,body(content(startIndex,endIndex,paragraph(elements(startIndex,endIndex,textRun(content)))))'
    )
    expect(output).toEqual({
      document: {
        type: 'google.doc.document',
        id: 'doc-1',
        title: 'Docs Plan',
        revision: 'rev-1',
        text: 'Hello Docs\nSecond line',
        link: 'https://docs.google.com/document/d/doc-1/edit',
        body: {
          blocks: [
            {
              id: 'body-block-1',
              ordinal: 1,
              type: 'paragraph',
              text: 'Hello Docs\n'
            },
            {
              id: 'body-block-2',
              ordinal: 2,
              type: 'paragraph',
              text: 'Second line\n'
            }
          ]
        },
        preview: {
          truncated: false,
          totalTextLength: 22,
          totalBlockCount: 2,
          includedBlockCount: 2
        }
      }
    })

    const outputText = JSON.stringify(output)
    expect(outputText).not.toContain('expired-docs-access-token')
    expect(outputText).not.toContain('new-docs-access-token')
    expect(outputText).not.toContain('refresh-token')
    expect(outputText).not.toContain('should-not-leak')
    expect(outputText).not.toContain('owner@example.com')
    expect(outputText).not.toContain('startIndex')
    expect(outputText).not.toContain('endIndex')
    expect(outputText).not.toContain('textStartIndex')
    expect(outputText).not.toContain('textEndIndex')
    expect(outputText).not.toContain('markdown')
    expect(outputText).not.toContain('101')
    expect(outputText).not.toContain('112')
    expect(outputText).not.toContain('212')
    expect(outputText).not.toContain('224')

    const persisted = JSON.parse(await readFile(configPath, 'utf8')) as OpenKhodamConfigFixture
    expect(persisted.integrations.googleWorkspace.token?.accessToken).toBe('new-docs-access-token')
    expect(persisted.integrations.googleWorkspace.scopes).toEqual([
      'email',
      googleDocsDocumentsScope,
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

test('bounds Google Docs read previews while persisting the full normalized artifact', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-google-docs-preview-'))
  const userDataPath = join(tempRoot, 'user-data')
  const projectPath = join(tempRoot, 'project')
  const fallbackWorktreePath = join(tempRoot, 'fallback-worktree')
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const textCapBlock = 'x'.repeat(700)
  const blockCapBlock = 'b'.repeat(10)
  const textCapBlocks = Array.from({ length: 25 }, () => textCapBlock)
  const blockCapBlocks = Array.from({ length: 25 }, () => blockCapBlock)

  await mkdir(projectPath, { recursive: true })
  await mkdir(fallbackWorktreePath, { recursive: true })
  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleDocsDocumentsScope, 'openid', 'profile'],
    token: {
      accessToken: 'valid-docs-access-token',
      expiresAt: Date.now() + 60 * 60 * 1000,
      idToken: null,
      refreshToken: 'refresh-token',
      tokenType: 'Bearer'
    },
    updatedAt: Date.now()
  })
  process.env.OPENKHODAM_CONFIG_PATH = configPath
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)

    if (url.startsWith('https://docs.googleapis.com/v1/documents/doc-text-cap')) {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer valid-docs-access-token')
      return new Response(
        JSON.stringify({
          body: {
            content: createGoogleDocParagraphs(textCapBlocks)
          },
          documentId: 'doc-text-cap',
          revisionId: 'rev-text-cap',
          title: 'Text Cap Doc'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    if (url.startsWith('https://docs.googleapis.com/v1/documents/doc-block-cap')) {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer valid-docs-access-token')
      return new Response(
        JSON.stringify({
          body: {
            content: createGoogleDocParagraphs(blockCapBlocks)
          },
          documentId: 'doc-block-cap',
          revisionId: 'rev-block-cap',
          title: 'Block Cap Doc'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    throw new Error(`Unexpected fetch URL: ${url}`)
  }) as typeof fetch

  try {
    const plugin = await loadGoogleWorkspacePlugin()
    const context = {
      directory: projectPath,
      sessionID: 'session-1',
      worktree: fallbackWorktreePath
    }

    const textCapOutput = JSON.parse(
      await plugin.tool.google_docs_read.execute({ documentId: 'doc-text-cap' }, context)
    ) as {
      document: Record<string, unknown>
    }
    const textCapDocument = textCapOutput.document as {
      body: { blocks: Array<{ text: string }> }
      preview: Record<string, unknown>
      text: string
    }
    expect(textCapDocument.text).toHaveLength(12_000)
    expect(textCapDocument.body.blocks).toHaveLength(18)
    expect(textCapDocument.body.blocks[17]?.text).toHaveLength(100)
    expect(textCapDocument.preview).toEqual({
      truncated: true,
      totalTextLength: 17_500,
      totalBlockCount: 25,
      includedBlockCount: 18
    })
    expect(JSON.stringify(textCapDocument)).not.toContain('markdown')

    const blockCapOutput = JSON.parse(
      await plugin.tool.google_docs_read.execute({ documentId: 'doc-block-cap' }, context)
    ) as {
      document: Record<string, unknown>
    }
    const blockCapDocument = blockCapOutput.document as {
      body: { blocks: Array<{ text: string }> }
      preview: Record<string, unknown>
      text: string
    }
    expect(blockCapDocument.text).toHaveLength(200)
    expect(blockCapDocument.body.blocks).toHaveLength(20)
    expect(blockCapDocument.preview).toEqual({
      truncated: true,
      totalTextLength: 250,
      totalBlockCount: 25,
      includedBlockCount: 20
    })

    const textCapArtifactPath = join(
      projectPath,
      '.openkhodam',
      'artifacts',
      'google-docs',
      'doc-text-cap.json'
    )
    const fullTextCapArtifact = JSON.parse(await readFile(textCapArtifactPath, 'utf8')) as {
      body: { blocks: Array<{ text: string }> }
      text: string
    }
    expect(fullTextCapArtifact.text).toHaveLength(17_500)
    expect(fullTextCapArtifact.body.blocks).toHaveLength(25)
    expect(fullTextCapArtifact.body.blocks[17]?.text).toHaveLength(700)
    expect(JSON.stringify(fullTextCapArtifact)).not.toContain('markdown')

    const artifacts = JSON.parse(
      await readFile(join(projectPath, '.openkhodam', 'artifacts.json'), 'utf8')
    ) as {
      sessions: Record<string, Array<Record<string, unknown>>>
    }
    expect(artifacts.sessions['session-1']).toHaveLength(2)
    expect(artifacts.sessions['session-1']?.[0]).toMatchObject({
      artifactPath: '.openkhodam/artifacts/google-docs/doc-text-cap.json',
      id: 'doc-text-cap',
      title: 'Text Cap Doc',
      url: 'https://docs.google.com/document/d/doc-text-cap/edit'
    })
    expect(JSON.stringify(artifacts)).not.toContain(textCapBlock)
    await expect(stat(join(fallbackWorktreePath, '.openkhodam'))).rejects.toThrow()
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('records linked Google Docs from directory context when worktree is root-like', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-google-docs-artifacts-'))
  const userDataPath = join(tempRoot, 'user-data')
  const projectPath = join(tempRoot, 'project')
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  let docsCalls = 0

  await mkdir(projectPath, { recursive: true })
  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleDocsDocumentsScope, 'openid', 'profile'],
    token: {
      accessToken: 'valid-docs-access-token',
      expiresAt: Date.now() + 60 * 60 * 1000,
      idToken: null,
      refreshToken: 'refresh-token',
      tokenType: 'Bearer'
    },
    updatedAt: Date.now()
  })
  process.env.OPENKHODAM_CONFIG_PATH = configPath
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)

    if (url.startsWith('https://docs.googleapis.com/v1/documents/doc-1')) {
      docsCalls += 1
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer valid-docs-access-token')
      return new Response(
        JSON.stringify({
          body: {
            content: [
              {
                paragraph: {
                  elements: [{ textRun: { content: `Hello Docs ${docsCalls}\n` } }]
                }
              }
            ]
          },
          documentId: 'doc-1',
          revisionId: `rev-${docsCalls}`,
          title: docsCalls === 1 ? 'Docs Plan' : 'Updated Docs Plan'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    throw new Error(`Unexpected fetch URL: ${url}`)
  }) as typeof fetch

  try {
    const plugin = await loadGoogleWorkspacePlugin()
    const context = {
      directory: projectPath,
      sessionID: 'session-1',
      worktree: '/'
    }

    const firstOutput = JSON.parse(
      await plugin.tool.google_docs_read.execute({ documentId: 'doc-1' }, context)
    ) as {
      document: Record<string, unknown>
    }
    expect(firstOutput.document).toMatchObject({
      id: 'doc-1',
      link: 'https://docs.google.com/document/d/doc-1/edit',
      title: 'Docs Plan',
      type: 'google.doc.document'
    })

    const artifactsPath = join(projectPath, '.openkhodam', 'artifacts.json')
    const fullArtifactPath = join(
      projectPath,
      '.openkhodam',
      'artifacts',
      'google-docs',
      'doc-1.json'
    )
    const artifactContents = await readFile(artifactsPath, 'utf8')
    const artifacts = JSON.parse(artifactContents) as {
      sessions: Record<string, Array<Record<string, unknown>>>
    }
    expect(artifacts.sessions['session-1']).toHaveLength(1)
    expect(artifacts.sessions['session-1']?.[0]).toMatchObject({
      artifactPath: '.openkhodam/artifacts/google-docs/doc-1.json',
      firstMessageId: null,
      id: 'doc-1',
      lastMessageId: null,
      listed: true,
      title: 'Docs Plan',
      url: 'https://docs.google.com/document/d/doc-1/edit'
    })
    expect(typeof artifacts.sessions['session-1']?.[0]?.firstSeenAt).toBe('number')
    expect(artifacts.sessions['session-1']?.[0]?.lastSeenAt).toBe(
      artifacts.sessions['session-1']?.[0]?.firstSeenAt
    )
    expect(JSON.parse(await readFile(fullArtifactPath, 'utf8'))).toMatchObject({
      body: {
        blocks: [
          {
            text: 'Hello Docs 1\n'
          }
        ]
      },
      id: 'doc-1',
      revision: 'rev-1',
      text: 'Hello Docs 1',
      title: 'Docs Plan'
    })

    const secondOutput = JSON.parse(
      await plugin.tool.google_docs_read.execute({ documentId: 'doc-1' }, context)
    ) as {
      document: Record<string, unknown>
    }
    expect(secondOutput.document).toMatchObject({
      id: 'doc-1',
      title: 'Updated Docs Plan',
      type: 'google.doc.document'
    })
    expect(await readFile(artifactsPath, 'utf8')).toBe(artifactContents)
    expect(JSON.parse(await readFile(fullArtifactPath, 'utf8'))).toMatchObject({
      id: 'doc-1',
      revision: 'rev-2',
      text: 'Hello Docs 2',
      title: 'Updated Docs Plan'
    })
    expect(docsCalls).toBe(2)
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('keeps Google Docs read output when linked-doc artifact recording fails', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-google-docs-record-failure-'))
  const userDataPath = join(tempRoot, 'user-data')
  const projectPath = join(tempRoot, 'project-path-should-not-log')
  const outsideParentTarget = join(tempRoot, 'outside-parent-should-not-log')
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const originalWarn = console.warn
  const warnings: unknown[][] = []

  await mkdir(projectPath, { recursive: true })
  await mkdir(outsideParentTarget, { recursive: true })
  await symlink(outsideParentTarget, join(projectPath, '.openkhodam'), 'dir')
  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleDocsDocumentsScope, 'openid', 'profile'],
    token: {
      accessToken: 'valid-docs-access-token',
      expiresAt: Date.now() + 60 * 60 * 1000,
      idToken: null,
      refreshToken: 'refresh-token',
      tokenType: 'Bearer'
    },
    updatedAt: Date.now()
  })
  process.env.OPENKHODAM_CONFIG_PATH = configPath
  console.warn = (...args: unknown[]) => {
    warnings.push(args)
  }
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)

    if (url.startsWith('https://docs.googleapis.com/v1/documents/doc-1')) {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer valid-docs-access-token')
      return new Response(
        JSON.stringify({
          body: {
            content: [
              {
                paragraph: {
                  elements: [{ textRun: { content: 'Hello Docs\n' } }]
                }
              }
            ]
          },
          documentId: 'doc-1',
          revisionId: 'rev-1',
          title: 'Docs Plan'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    throw new Error(`Unexpected fetch URL: ${url}`)
  }) as typeof fetch

  try {
    const plugin = await loadGoogleWorkspacePlugin()
    const output = JSON.parse(
      await plugin.tool.google_docs_read.execute(
        { documentId: 'doc-1' },
        { directory: projectPath, sessionID: 'session-1' }
      )
    ) as {
      document: Record<string, unknown>
    }

    expect(output.document).toMatchObject({
      id: 'doc-1',
      link: 'https://docs.google.com/document/d/doc-1/edit',
      text: 'Hello Docs',
      title: 'Docs Plan',
      type: 'google.doc.document'
    })
    expect(warnings).toEqual([
      [
        'Failed to persist Google Doc artifact',
        {
          docId: 'doc-1',
          reason: 'artifact_persist_failed'
        }
      ]
    ])

    const warningText = JSON.stringify(warnings)
    expect(warningText).not.toContain('valid-docs-access-token')
    expect(warningText).not.toContain('refresh-token')
    expect(warningText).not.toContain('Hello Docs')
    expect(warningText).not.toContain('must not be a symlink')
    expect(warningText).not.toContain(tempRoot)
    expect(warningText).not.toContain(projectPath)
    expect(warningText).not.toContain(outsideParentTarget)
    await expect(readFile(join(outsideParentTarget, 'artifacts.json'), 'utf8')).rejects.toThrow()
  } finally {
    console.warn = originalWarn
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('logs sanitized Google API failures for Drive and Docs permission errors', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-google-api-failure-'))
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const originalWarn = console.warn
  const warnings: unknown[][] = []
  let docsAuthorization: string | null = null
  let driveAuthorization: string | null = null

  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: [
      'email',
      googleDocsDocumentsScope,
      googleDriveMetadataReadonlyScope,
      'openid',
      'profile'
    ],
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
  console.warn = (...args: unknown[]) => {
    warnings.push(args)
  }
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)

    if (url.startsWith('https://www.googleapis.com/drive/v3/files')) {
      driveAuthorization = new Headers(init?.headers).get('authorization')
      return new Response(
        JSON.stringify({
          accessToken: 'should-not-log',
          error: {
            code: 403,
            errors: [
              {
                message: 'Drive raw detail should not override the safe message.',
                reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'
              }
            ],
            message: 'Drive permission denied.',
            status: 'PERMISSION_DENIED'
          },
          rawRequestBody: 'request-body-should-not-log'
        }),
        { status: 403, headers: { 'content-type': 'application/json' } }
      )
    }

    if (url.startsWith('https://docs.googleapis.com/v1/documents/doc-denied')) {
      docsAuthorization = new Headers(init?.headers).get('authorization')
      return new Response(
        JSON.stringify({
          error: {
            code: 403,
            errors: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }],
            message: 'Request had insufficient authentication scopes.',
            status: 'PERMISSION_DENIED'
          },
          refreshToken: 'should-not-log'
        }),
        { status: 403, headers: { 'content-type': 'application/json' } }
      )
    }

    throw new Error(`Unexpected fetch URL: ${url}`)
  }) as typeof fetch

  try {
    const plugin = await loadGoogleWorkspacePlugin()
    await expect(
      plugin.tool.google_drive_search_files.execute({ query: 'budget' }, {})
    ).rejects.toThrow(
      'Google Drive files.list failed (HTTP 403, PERMISSION_DENIED, ACCESS_TOKEN_SCOPE_INSUFFICIENT): Drive permission denied.'
    )
    await expect(
      plugin.tool.google_docs_read.execute({ documentId: 'doc-denied' }, {})
    ).rejects.toThrow(
      'Google Docs documents.get failed (HTTP 403, PERMISSION_DENIED, ACCESS_TOKEN_SCOPE_INSUFFICIENT): Request had insufficient authentication scopes.'
    )

    expect(driveAuthorization).toBe('Bearer valid-access-token')
    expect(docsAuthorization).toBe('Bearer valid-access-token')
    expect(warnings).toEqual([
      [
        'Google Workspace API request failed',
        {
          code: 'PERMISSION_DENIED',
          message: 'Drive permission denied.',
          operation: 'Google Drive files.list',
          reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
          status: 403
        }
      ],
      [
        'Google Workspace API request failed',
        {
          code: 'PERMISSION_DENIED',
          message: 'Request had insufficient authentication scopes.',
          operation: 'Google Docs documents.get',
          reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
          status: 403
        }
      ]
    ])

    const warningText = JSON.stringify(warnings)
    expect(warningText).not.toContain('valid-access-token')
    expect(warningText).not.toContain('refresh-token')
    expect(warningText).not.toContain('should-not-log')
    expect(warningText).not.toContain('request-body-should-not-log')
  } finally {
    console.warn = originalWarn
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
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

test('returns a clear reconnect error when the Google Docs scope is missing', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-google-docs-missing-scope-'))
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH

  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleDriveMetadataReadonlyScope, 'openid', 'profile'],
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
    await expect(plugin.tool.google_docs_read.execute({ documentId: 'doc-1' }, {})).rejects.toThrow(
      'Google Docs access is not enabled. Reconnect Google Workspace in Settings to grant Google Docs read/write access.'
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

function createGoogleDocParagraphs(
  blocks: string[]
): Array<{ paragraph: { elements: Array<{ textRun: { content: string } }> } }> {
  return blocks.map((text) => ({
    paragraph: {
      elements: [{ textRun: { content: text } }]
    }
  }))
}

test('registers the ping tool from the ESM artifact through the real OpenCode loader', async () => {
  test.setTimeout(120_000)

  await expectOpenCodeLoadsPlugins([builtPluginPath, builtGoogleWorkspacePluginPath])
})

test('registers the ping tool from the TS source through the real OpenCode loader', async () => {
  test.setTimeout(120_000)

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
      signal: AbortSignal.timeout(60_000)
    }).catch((error) => {
      throw new Error(`Failed to fetch OpenCode tool IDs: ${String(error)}\n${server.logs()}`)
    })
    const body = await response.text()

    expect(response.status, `${body}\n${server.logs()}`).toBe(200)
    expect(JSON.parse(body) as string[]).toContain(toolName)
    expect(JSON.parse(body) as string[]).toContain(googleDriveToolName)
    expect(JSON.parse(body) as string[]).toContain(googleDocsReadToolName)
    expect(server.logs()).not.toMatch(/failed to load plugin/i)
  } finally {
    await server.stop()
    await removeDirectoryWithRetries(userDataPath)
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

async function removeDirectoryWithRetries(path: string): Promise<void> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true })
      return
    } catch (error) {
      if (!isRetryableRmError(error) || attempt === 5) throw error
      await wait(attempt * 100)
    }
  }
}

function isRetryableRmError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    ['EBUSY', 'ENOTEMPTY'].includes(error.code)
  )
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
