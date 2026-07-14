import { spawn } from 'node:child_process'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises'
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
const googleDriveMetadataReadonlyScope = 'https://www.googleapis.com/auth/drive.metadata.readonly'
const googleDocsDocumentsScope = 'https://www.googleapis.com/auth/documents'
const googleSheetsSpreadsheetsScope = 'https://www.googleapis.com/auth/spreadsheets.readonly'
const googleSheetsSpreadsheetsWriteScope = 'https://www.googleapis.com/auth/spreadsheets'
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
    google_workspace_execute_command: {
      description: string
      execute: (
        args: { command?: string; input?: unknown },
        context: {
          abort?: AbortSignal
          directory?: string
          messageID?: string
          sessionID?: string
          worktree?: string
        }
      ) => Promise<string>
    }
    google_workspace_list_commands: {
      args: { query: Record<string, unknown> }
      description: string
      execute: (args: { query: string }, context: { abort?: AbortSignal }) => Promise<string>
    }
  }
}

type OpenKhodamConfigFixture = {
  version: 1
  projects: {
    openedFolders: Array<{ directory: string; lastOpenedAt: number }>
  }
  preferences: {
    openCode: {
      modelSelectionsByDirectory: Record<string, { providerID: string; modelID: string }>
    }
  }
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

type GoogleWorkspaceCommandContext = {
  abort?: AbortSignal
  directory?: string
  messageID?: string
  sessionID?: string
  worktree?: string
}

async function executeGoogleWorkspaceCommand(
  plugin: GoogleWorkspacePlugin,
  command: string,
  input: Record<string, unknown>,
  context: GoogleWorkspaceCommandContext
): Promise<string> {
  return plugin.tool.google_workspace_execute_command.execute({ command, input }, context)
}

async function listGoogleWorkspaceCommands(plugin: GoogleWorkspacePlugin): Promise<{
  commands: Array<{
    description: string
    id: string
    inputSchema: { properties?: Record<string, unknown>; required: string[] }
  }>
}> {
  return JSON.parse(await plugin.tool.google_workspace_list_commands.execute({ query: '' }, {}))
}

function googleDocsOperationCommandInput(operation: {
  match?: string
  occurrence?: number | string
  text?: string
  type: string
}): Record<string, unknown> {
  const { type: _type, ...input } = operation
  return input
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
  const skillPath = '/tmp/opencode-skills'

  try {
    await expect(configStore.read()).resolves.toEqual({
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
    expect(appConfig.projects.openedFolders).toEqual([])
    expect(appConfig.preferences.openCode.modelSelectionsByDirectory).toEqual({})
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

    const runtimeConfigPath = await writeRuntimeOpenCodeConfig(userDataPath, pluginPaths, skillPath)
    expect(runtimeConfigPath).toBe(
      join(userDataPath, 'opencode-sidecar', 'runtime-opencode-config.json')
    )
    expect(JSON.parse(await readFile(runtimeConfigPath, 'utf8'))).toEqual(
      createRuntimeOpenCodeConfig(pluginPaths, skillPath)
    )
    expect((await stat(runtimeConfigPath)).mode & 0o777).toBe(0o600)
  } finally {
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('resolves the bundled Google Workspace artifact skill in development, built, and packaged modes', async () => {
  const { resolveOpenKhodamSkillPath } = loadDesktopModule<{
    resolveOpenKhodamSkillPath: (options: {
      baseDir?: string
      dev?: boolean
      packaged?: boolean
      resourcesPath?: string
    }) => string
  }>('../../desktop/src/main/opencode-skill-path')
  const desktopDirectory = '/app/packages/desktop'

  expect(resolveOpenKhodamSkillPath({ baseDir: desktopDirectory, dev: true })).toBe(
    join(desktopDirectory, 'src', 'main', 'opencode-skills')
  )
  expect(resolveOpenKhodamSkillPath({ baseDir: join(desktopDirectory, 'out', 'main') })).toBe(
    join(desktopDirectory, 'out', 'opencode-skills')
  )
  expect(
    resolveOpenKhodamSkillPath({
      packaged: true,
      resourcesPath: '/app/resources'
    })
  ).toBe('/app/resources/opencode-skills')
})

test('bundles a valid Google Workspace artifact workflow skill', async () => {
  const skillPath = join(
    process.cwd(),
    '..',
    'desktop',
    'src',
    'main',
    'opencode-skills',
    'google-workspace-artifact-workflow',
    'SKILL.md'
  )
  const skill = await readFile(skillPath, 'utf8')

  expect(skill).toContain('name: google-workspace-artifact-workflow')
  expect(skill).toContain('description:')
  expect(skill).toContain('google.docs.read')
  expect(skill).toContain('google.artifacts.read')
  expect(skill).toContain('artifactRef')
  expect(skill).toContain('nextCursor')
  expect(skill).toContain('discard old cursors')
  expect(skill).toContain('stale, missing, invalid')
  expect(skill).toContain('first tab')
  expect(skill).toContain('rich text, native lists, and simple rectangular table cells')
  expect(skill).toContain('Merged or irregular tables and images are unsupported')
  expect(skill).toContain('explicit unsupported-table markers')
})

test('build emits the bundled Google Workspace artifact skill tree', async () => {
  const sourceSkillPath = join(
    process.cwd(),
    '..',
    'desktop',
    'src',
    'main',
    'opencode-skills',
    'google-workspace-artifact-workflow',
    'SKILL.md'
  )
  const builtSkillPath = join(
    process.cwd(),
    '..',
    'desktop',
    'out',
    'opencode-skills',
    'google-workspace-artifact-workflow',
    'SKILL.md'
  )

  expect(await readFile(builtSkillPath, 'utf8')).toBe(await readFile(sourceSkillPath, 'utf8'))
})

test('Google Workspace config hook retains project skill paths and appends the managed path once', async () => {
  const originalManagedSkillPath = process.env.OPENKHODAM_MANAGED_SKILL_PATH
  process.env.OPENKHODAM_MANAGED_SKILL_PATH = '/managed/skills'
  try {
    const plugin = await loadGoogleWorkspacePlugin()
    const config = { skills: { paths: ['/project/skills', '/managed/skills'] } }

    plugin.config(config)

    expect(config.skills.paths).toEqual(['/project/skills', '/managed/skills'])
  } finally {
    restoreEnv('OPENKHODAM_MANAGED_SKILL_PATH', originalManagedSkillPath)
  }
})

test('normalizes and stores per-directory OpenCode model selections in app config', async () => {
  const { OpenKhodamConfigFileStore } = loadDesktopModule<OpenKhodamConfigModule>(
    '../../desktop/src/main/integrations/openkhodam-config'
  )
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-model-selection-'))
  const userDataPath = join(tempRoot, 'user-data')
  const projectPath = join(tempRoot, 'project')
  const projectLinkPath = join(tempRoot, 'project-link')
  const configPath = join(userDataPath, 'openkhodam-config.json')

  try {
    await mkdir(projectPath, { recursive: true })
    await symlink(projectPath, projectLinkPath)
    const expectedProjectDirectory = await realpath(projectPath)
    await mkdir(userDataPath, { recursive: true })
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          projects: {
            openedFolders: []
          },
          preferences: {
            openCode: {
              modelSelectionsByDirectory: {
                [join(projectPath, '..', 'project')]: {
                  providerID: ' fake-provider ',
                  modelID: ' fake-model '
                },
                relative: { providerID: 'relative-provider', modelID: 'relative-model' },
                [join(tempRoot, 'invalid-model')]: { providerID: '', modelID: 'missing-provider' },
                [`${projectPath}\0bad`]: { providerID: 'bad-path', modelID: 'bad-model' }
              }
            }
          },
          integrations: {
            googleWorkspace: {
              account: { email: 'fake@example.com', name: 'Fake User' },
              scopes: ['profile'],
              token: {
                accessToken: 'access-token',
                expiresAt: 123,
                idToken: null,
                refreshToken: 'refresh-token',
                tokenType: 'Bearer'
              },
              updatedAt: 456
            }
          }
        } satisfies OpenKhodamConfigFixture,
        null,
        2
      )}\n`,
      'utf8'
    )

    const configStore = new OpenKhodamConfigFileStore(configPath)
    await expect(
      configStore.getOpenCodeModelSelection({ projectDirectory: projectLinkPath })
    ).resolves.toEqual({ providerID: 'fake-provider', modelID: 'fake-model' })

    await expect(
      configStore.setOpenCodeModelSelection({
        projectDirectory: projectLinkPath,
        model: { providerID: 'fake-provider', modelID: 'fake-alt-model' }
      })
    ).resolves.toEqual({ providerID: 'fake-provider', modelID: 'fake-alt-model' })

    const persisted = JSON.parse(await readFile(configPath, 'utf8')) as OpenKhodamConfigFixture
    expect(persisted.projects.openedFolders).toEqual([])
    expect(persisted.preferences.openCode.modelSelectionsByDirectory).toEqual({
      [expectedProjectDirectory]: { providerID: 'fake-provider', modelID: 'fake-alt-model' }
    })
    expect(persisted.integrations.googleWorkspace).toMatchObject({
      account: { email: 'fake@example.com', name: 'Fake User' },
      scopes: ['profile'],
      token: {
        accessToken: 'access-token',
        expiresAt: 123,
        idToken: null,
        refreshToken: 'refresh-token',
        tokenType: 'Bearer'
      },
      updatedAt: 456
    })

    await expect(
      configStore.setOpenCodeModelSelection({ projectDirectory: projectPath, model: null })
    ).resolves.toBeNull()
    await expect(
      configStore.getOpenCodeModelSelection({ projectDirectory: projectPath })
    ).resolves.toBeNull()
    const cleared = JSON.parse(await readFile(configPath, 'utf8')) as OpenKhodamConfigFixture
    expect(cleared.projects.openedFolders).toEqual([])
    expect(cleared.preferences.openCode.modelSelectionsByDirectory).toEqual({})
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('serializes same-process OpenKhodam config mutations across store instances', async () => {
  const { OpenKhodamConfigFileStore } = loadDesktopModule<OpenKhodamConfigModule>(
    '../../desktop/src/main/integrations/openkhodam-config'
  )
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-config-concurrency-'))
  const configPath = join(tempRoot, 'openkhodam-config.json')
  const projectPaths = await Promise.all(
    ['one', 'two', 'three'].map(async (name) => {
      const path = join(tempRoot, name)
      await mkdir(path, { recursive: true })
      return path
    })
  )
  const firstStore = new OpenKhodamConfigFileStore(configPath)
  const secondStore = new OpenKhodamConfigFileStore(join(tempRoot, '.', 'openkhodam-config.json'))

  try {
    await Promise.all([
      ...projectPaths.map((projectDirectory, index) =>
        (index % 2 === 0 ? firstStore : secondStore).setOpenCodeModelSelection({
          projectDirectory,
          model: { providerID: `provider-${index}`, modelID: `model-${index}` }
        })
      ),
      firstStore.recordOpenedProjectFolder({ directory: projectPaths[0] }),
      secondStore.setGoogleWorkspaceConnection(
        { email: 'concurrent@example.com', name: 'Concurrent User' },
        ['email'],
        {
          accessToken: 'concurrent-access',
          expiresAt: 123,
          idToken: null,
          refreshToken: null,
          tokenType: 'Bearer'
        }
      )
    ])

    const persisted = await firstStore.read()
    expect(persisted.preferences.openCode.modelSelectionsByDirectory).toEqual({
      [projectPaths[0]]: { providerID: 'provider-0', modelID: 'model-0' },
      [projectPaths[1]]: { providerID: 'provider-1', modelID: 'model-1' },
      [projectPaths[2]]: { providerID: 'provider-2', modelID: 'model-2' }
    })
    expect(persisted.projects.openedFolders).toEqual([
      expect.objectContaining({ directory: projectPaths[0] })
    ])
    expect(persisted.integrations.googleWorkspace.account).toEqual({
      email: 'concurrent@example.com',
      name: 'Concurrent User'
    })
    expect((await stat(configPath)).mode & 0o777).toBe(0o600)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
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
      type: 'google.doc.document',
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
      title: 'Updated Launch Plan',
      type: 'google.doc.document'
    })
    const linkedSheet = await store.recordLinkedGoogleArtifact({
      artifact: {
        id: 'doc-1',
        title: 'Launch Tracker',
        type: 'google.sheet.spreadsheet',
        url: 'https://docs.google.com/spreadsheets/d/doc-1/edit'
      },
      messageId: 'message-3',
      sessionId: 'session-1'
    })

    expect(linkedSheet).toMatchObject({
      artifactPath: null,
      firstMessageId: 'message-3',
      firstSeenAt: 2_000,
      id: 'doc-1',
      lastMessageId: 'message-3',
      lastSeenAt: 2_000,
      listed: true,
      title: 'Launch Tracker',
      type: 'google.sheet.spreadsheet',
      url: 'https://docs.google.com/spreadsheets/d/doc-1/edit'
    })
    await expect(store.listSessionLinkedDocs('session-1')).resolves.toEqual([
      rerecorded,
      linkedSheet
    ])
    await expect(store.listSessionLinkedGoogleArtifacts('session-1')).resolves.toEqual([
      rerecorded,
      linkedSheet
    ])
    await expect(store.listProjectArtifacts()).resolves.toEqual({
      version: PROJECT_ARTIFACTS_CONFIG_VERSION,
      sessions: {
        'session-1': [rerecorded, linkedSheet]
      }
    })
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('gets or creates linked Google Docs while updating message provenance when present', async () => {
  const { getOrCreateLinkedGoogleDoc, ProjectArtifactsFileStore } =
    loadDesktopModule<ProjectArtifactsModule>(
      '../../desktop/src/main/integrations/project-artifacts'
    )
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-project-artifacts-get-or-create-'))
  const projectPath = join(tempRoot, 'project')
  await mkdir(projectPath, { recursive: true })
  const store = new ProjectArtifactsFileStore(projectPath, { now: () => 1234 })

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

    const existingWithoutMessage = await getOrCreateLinkedGoogleDoc({
      doc: {
        id: 'doc-1',
        title: 'Updated Launch Plan',
        url: 'https://docs.google.com/document/d/doc-1/edit'
      },
      projectDirectory: projectPath,
      sessionId: 'session-1'
    })

    expect(existingWithoutMessage).toEqual(created)
    await expect(store.listSessionLinkedDocs('session-1')).resolves.toEqual([created])
    expect(await readFile(store.filePath, 'utf8')).toBe(firstFileContents)

    const rerecorded = await getOrCreateLinkedGoogleDoc({
      doc: {
        id: 'doc-1',
        title: 'Updated Launch Plan',
        url: 'https://docs.google.com/document/d/doc-1/edit'
      },
      messageId: 'message-2',
      projectDirectory: projectPath,
      sessionId: 'session-1'
    })

    expect(rerecorded).toMatchObject({
      artifactPath: null,
      firstMessageId: 'message-1',
      firstSeenAt: created.firstSeenAt,
      id: 'doc-1',
      lastMessageId: 'message-2',
      title: 'Updated Launch Plan',
      type: 'google.doc.document'
    })

    const withArtifactPath = await getOrCreateLinkedGoogleDoc({
      doc: {
        artifactPath: expectedGoogleDocArtifactPath('doc-1'),
        id: 'doc-1',
        title: 'Updated Launch Plan',
        url: 'https://docs.google.com/document/d/doc-1/edit'
      },
      messageId: 'message-3',
      projectDirectory: projectPath,
      sessionId: 'session-1'
    })
    expect(withArtifactPath).toMatchObject({
      artifactPath: expectedGoogleDocArtifactPath('doc-1'),
      firstMessageId: 'message-1',
      firstSeenAt: created.firstSeenAt,
      id: 'doc-1',
      lastMessageId: 'message-3',
      title: 'Updated Launch Plan',
      type: 'google.doc.document'
    })
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
  const fullSheet = {
    type: 'google.sheet.spreadsheet' as const,
    id: 'sheet-1',
    title: 'Launch Sheet',
    link: 'https://docs.google.com/spreadsheets/d/sheet-1/edit',
    sheets: [
      {
        id: 1,
        title: 'Summary',
        index: 0,
        hidden: false,
        sheetType: 'GRID',
        rowCount: 10,
        columnCount: 5
      }
    ],
    ranges: [
      {
        range: 'Summary!A1:B2',
        majorDimension: 'ROWS',
        values: [['Name', 'Amount']],
        rowCount: 1,
        columnCount: 2,
        cellCount: 2,
        truncated: false
      }
    ]
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
    await expect(
      parentSymlinkStore.persistGoogleSheetSpreadsheetArtifact(fullSheet)
    ).rejects.toThrow(/must not be a symlink/)
    await expect(stat(join(outsideParentTarget, 'artifacts.json'))).rejects.toThrow()

    await rm(join(projectPath, '.openkhodam'), { force: true })
    await mkdir(join(projectPath, '.openkhodam'), { recursive: true })
    await symlink(outsideParentTarget, join(projectPath, '.openkhodam', 'artifacts'), 'dir')

    const nestedSymlinkStore = new ProjectArtifactsFileStore(projectPath)
    await expect(nestedSymlinkStore.persistGoogleDocDocumentArtifact(fullDoc)).rejects.toThrow(
      /\.openkhodam\/artifacts must not be a symlink/
    )
    await expect(
      nestedSymlinkStore.persistGoogleSheetSpreadsheetArtifact(fullSheet)
    ).rejects.toThrow(/\.openkhodam\/artifacts must not be a symlink/)
    await expect(stat(join(outsideParentTarget, 'google-docs'))).rejects.toThrow()
    await expect(stat(join(outsideParentTarget, 'google-sheets'))).rejects.toThrow()

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

test('persists Google Workspace artifact files with stable product paths', async () => {
  const { ProjectArtifactsFileStore } = loadDesktopModule<ProjectArtifactsModule>(
    '../../desktop/src/main/integrations/project-artifacts'
  )
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-google-workspace-artifact-files-'))
  const projectPath = join(tempRoot, 'project')
  const documentId = 'doc/path?:unsafe'
  const spreadsheetId = 'sheet/path?:unsafe'

  try {
    await mkdir(projectPath, { recursive: true })
    const store = new ProjectArtifactsFileStore(projectPath, { now: () => 12_345 })

    const persistedDoc = await store.persistGoogleDocDocumentArtifact({
      type: 'google.doc.document',
      id: documentId,
      title: 'Shared Docs Artifact',
      revision: 'rev-1',
      text: 'Hello shared Docs',
      link: `https://docs.google.com/document/d/${encodeURIComponent(documentId)}/edit`,
      body: {
        blocks: [
          {
            id: 'body-block-1',
            ordinal: 1,
            type: 'paragraph',
            text: 'Hello shared Docs\n'
          }
        ]
      }
    })
    const persistedSheet = await store.persistGoogleSheetSpreadsheetArtifact({
      type: 'google.sheet.spreadsheet',
      id: spreadsheetId,
      title: 'Shared Sheets Artifact',
      link: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`,
      sheets: [
        {
          id: 7,
          title: 'Summary',
          index: 0,
          hidden: false,
          sheetType: 'GRID',
          rowCount: 10,
          columnCount: 3
        }
      ],
      ranges: [
        {
          range: 'Summary!A1:C2',
          majorDimension: 'ROWS',
          values: [
            ['Name', 'Amount'],
            ['Launch', 42]
          ],
          rowCount: 2,
          columnCount: 2,
          cellCount: 4,
          truncated: false
        }
      ]
    })

    expect(persistedDoc).toEqual({
      artifactPath: expectedGoogleDocArtifactPath(documentId),
      cachedAt: 12345,
      created: true
    })
    expect(persistedSheet).toEqual({
      artifactPath: expectedGoogleSheetArtifactPath(spreadsheetId),
      cachedAt: 12345,
      created: true
    })
    const persistedDocumentPayload = JSON.parse(
      await readFile(expectedGoogleDocArtifactAbsolutePath(projectPath, documentId), 'utf8')
    )
    expect(persistedDocumentPayload).toMatchObject({
      id: documentId,
      schemaVersion: 2,
      cachedAt: 12_345,
      title: 'Shared Docs Artifact',
      type: 'google.doc.document',
      body: {
        blocks: [
          {
            id: 'body-block-1',
            text: 'Hello shared Docs\n',
            runs: [{ text: 'Hello shared Docs\n', style: {} }],
            location: { kind: 'body', bodyIndex: 0 }
          }
        ]
      }
    })
    const offlineDocument = await store.readGoogleDocDocumentArtifact(
      `google-docs:v1:${Buffer.from(documentId, 'utf8').toString('base64url')}`
    )
    expect(offlineDocument.document.body.blocks).toEqual(persistedDocumentPayload.body.blocks)
    expect(
      JSON.parse(
        await readFile(expectedGoogleSheetArtifactAbsolutePath(projectPath, spreadsheetId), 'utf8')
      )
    ).toMatchObject({
      id: spreadsheetId,
      schemaVersion: 1,
      cachedAt: 12_345,
      title: 'Shared Sheets Artifact',
      type: 'google.sheet.spreadsheet'
    })
    expect(persistedDoc.artifactPath).toContain('.openkhodam/artifacts/google-docs')
    expect(persistedSheet.artifactPath).toContain('.openkhodam/artifacts/google-sheets')
    expect(persistedDoc.artifactPath).not.toContain(documentId)
    expect(persistedSheet.artifactPath).not.toContain(spreadsheetId)
    await expect(stat(join(projectPath, '.openkhodam', 'artifacts.json'))).rejects.toThrow()
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('rejects invalid Google Docs persistence input without changing artifact files', async () => {
  const { ProjectArtifactsFileStore } = loadDesktopModule<ProjectArtifactsModule>(
    '../../desktop/src/main/integrations/project-artifacts'
  )
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-google-docs-persistence-validation-'))
  const projectPath = join(tempRoot, 'project')
  const documentId = 'validation-doc'
  const artifactPath = expectedGoogleDocArtifactAbsolutePath(projectPath, documentId)
  const validDocument = {
    type: 'google.doc.document' as const,
    id: documentId,
    title: 'Valid',
    revision: 'rev-1',
    link: null,
    text: 'Valid text',
    body: {
      blocks: [{ id: 'paragraph-1', ordinal: 1, type: 'paragraph' as const, text: 'Valid text' }]
    }
  }

  try {
    await mkdir(projectPath, { recursive: true })
    const store = new ProjectArtifactsFileStore(projectPath, { now: () => 12_345 })
    await expect(
      store.persistGoogleDocDocumentArtifact({
        ...validDocument,
        id: 'invalid-new-doc',
        body: {
          blocks: [
            {
              ...validDocument.body.blocks[0],
              runs: [],
              location: { kind: 'body', bodyIndex: -1 }
            }
          ]
        }
      })
    ).rejects.toThrow(/rich text is inconsistent|invalid paragraph location/)
    await expect(
      stat(expectedGoogleDocArtifactAbsolutePath(projectPath, 'invalid-new-doc'))
    ).rejects.toThrow()

    await store.persistGoogleDocDocumentArtifact(validDocument)
    const before = await readFile(artifactPath, 'utf8')
    await expect(
      store.persistGoogleDocDocumentArtifact({
        ...validDocument,
        body: {
          blocks: [
            {
              ...validDocument.body.blocks[0],
              runs: [{ text: 'mismatch', style: { bold: 'true' } }]
            }
          ]
        }
      })
    ).rejects.toThrow(/invalid rich text style/)
    await expect(readFile(artifactPath, 'utf8')).resolves.toBe(before)
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
      title: 'Updated Launch Plan',
      type: 'google.doc.document'
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
  const store = new ProjectArtifactsFileStore(projectPath, { now: () => 1234 })

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
              {
                artifactPath: expectedGoogleSheetArtifactPath('sheet-1'),
                firstSeenAt: 40,
                id: 'sheet-1',
                lastMessageId: 'message-sheet-1',
                lastSeenAt: 40,
                listed: true,
                title: 'Sheet Plan',
                type: 'google.sheet.spreadsheet',
                url: 'https://docs.google.com/spreadsheets/d/sheet-1/edit'
              },
              {
                firstSeenAt: 45,
                id: 'sheet-1',
                lastMessageId: 'message-sheet-2',
                lastSeenAt: 55,
                listed: true,
                title: 'Updated Sheet Plan',
                type: 'google.sheet.spreadsheet'
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
            type: 'google.doc.document',
            url: null
          },
          {
            artifactPath: expectedGoogleSheetArtifactPath('sheet-1'),
            firstMessageId: null,
            firstSeenAt: 40,
            id: 'sheet-1',
            lastMessageId: 'message-sheet-2',
            lastSeenAt: 55,
            listed: true,
            title: 'Updated Sheet Plan',
            type: 'google.sheet.spreadsheet',
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
            type: 'google.doc.document',
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
  const store = new ProjectArtifactsFileStore(projectPath, { now: () => 1234 })

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

test('requests the Google Sheets OAuth scope in the Workspace connect flow', async () => {
  const runtimeSource = await readFile(
    join(desktopDirectory, 'src', 'main', 'integrations', 'google-workspace-runtime.ts'),
    'utf8'
  )
  const integrationSource = await readFile(
    join(desktopDirectory, 'src', 'main', 'integrations', 'google-workspace.ts'),
    'utf8'
  )

  expect(runtimeSource).toContain('export const GOOGLE_SHEETS_SPREADSHEETS_SCOPE')
  expect(runtimeSource).toContain('export const GOOGLE_SHEETS_SPREADSHEETS_READONLY_SCOPE')
  expect(runtimeSource).toContain(`'${googleSheetsSpreadsheetsScope}'`)
  expect(runtimeSource).toContain(`'${googleSheetsSpreadsheetsWriteScope}'`)
  expect(integrationSource).toContain('GOOGLE_SHEETS_SPREADSHEETS_SCOPE')
  expect(integrationSource).toContain('GOOGLE_SCOPES = [')
  expect(integrationSource).toContain('GOOGLE_SHEETS_SPREADSHEETS_SCOPE')
  expect(integrationSource).toContain("authUrl.searchParams.set('scope', GOOGLE_SCOPES.join(' '))")
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
    const discovery = await listGoogleWorkspaceCommands(plugin)
    const linkSchema = discovery.commands.find(
      (command) => command.id === 'google.docs.format_text'
    )?.inputSchema.properties?.style as { properties?: { linkUrl?: unknown } }
    expect(linkSchema.properties?.linkUrl).toEqual({ type: ['string', 'null'] })
    const output = JSON.parse(
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.drive.search_files',
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
    const output = JSON.parse(
      await executeGoogleWorkspaceCommand(plugin, 'google.docs.read', { documentId: ' doc-1 ' }, {})
    ) as {
      artifactRef: string
      artifactSync: Record<string, unknown>
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
    expect(docsUrl?.searchParams.get('fields')).toContain('lists(listProperties(nestingLevels')
    expect(docsUrl?.searchParams.get('fields')).toContain('textStyle(')
    expect(docsUrl?.searchParams.get('fields')).toContain('paragraphStyle(')
    expect(output).toEqual({
      artifactRef: null,
      artifactSync: { status: 'unavailable', reason: 'project_context_missing' },
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
              id: 'paragraph-1',
              ordinal: 1,
              type: 'paragraph',
              text: 'Hello Docs\n',
              runs: [{ text: 'Hello Docs\n', style: {} }],
              location: { kind: 'body', bodyIndex: 0 }
            },
            {
              id: 'paragraph-2',
              ordinal: 2,
              type: 'paragraph',
              text: 'Second line\n',
              runs: [{ text: 'Second line\n', style: {} }],
              location: { kind: 'body', bodyIndex: 1 }
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

test('registers exactly generic Google Workspace tools and discovers strict Sheets command schemas', async () => {
  const plugin = await loadGoogleWorkspacePlugin()

  expect(Object.keys(plugin.tool)).toEqual([
    'google_workspace_list_commands',
    'google_workspace_execute_command'
  ])
  const commands = await listGoogleWorkspaceCommands(plugin)
  expect(commands.commands).toHaveLength(17)
  const byId = new Map(commands.commands.map((command) => [command.id, command.inputSchema]))
  expect(byId.get('google.sheets.read')).toMatchObject({
    additionalProperties: false,
    required: ['spreadsheetId'],
    properties: {
      spreadsheetId: { type: 'string' },
      ranges: {
        items: { type: 'string' },
        maxItems: 5,
        type: 'array'
      },
      valueRenderOption: {
        default: 'FORMATTED_VALUE',
        enum: ['FORMATTED_VALUE', 'UNFORMATTED_VALUE', 'FORMULA'],
        type: 'string'
      }
    }
  })
  expect(byId.get('google.sheets.set_values')).toMatchObject({
    additionalProperties: false,
    required: ['spreadsheetId', 'range', 'values'],
    properties: { valueInputOption: { default: 'USER_ENTERED', enum: ['USER_ENTERED', 'RAW'] } }
  })
  expect(byId.get('google.sheets.append_rows')).toMatchObject({
    additionalProperties: false,
    required: ['spreadsheetId', 'range', 'rows']
  })
  expect(byId.get('google.sheets.clear_range')).toMatchObject({
    additionalProperties: false,
    required: ['spreadsheetId', 'range']
  })
})

test('reads explicit Google Sheets ranges through Sheets API and persists a spreadsheet artifact', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-google-sheets-read-'))
  const userDataPath = join(tempRoot, 'user-data')
  const projectPath = join(tempRoot, 'project')
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const spreadsheetId = 'sheet/read?:unsafe'
  const encodedSpreadsheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`
  const events: string[] = []
  let metadataAuthorization: string | null = null
  let metadataUrl: URL | null = null
  let valuesAuthorization: string | null = null
  let valuesUrl: URL | null = null

  await mkdir(projectPath, { recursive: true })
  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleSheetsSpreadsheetsScope, 'openid', 'profile'],
    token: {
      accessToken: 'valid-sheets-access-token',
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

    if (url.startsWith(encodedSpreadsheetUrl) && !url.includes('/values:batchGet')) {
      events.push('spreadsheets.get')
      metadataUrl = new URL(url)
      metadataAuthorization = new Headers(init?.headers).get('authorization')
      return new Response(
        JSON.stringify({
          spreadsheetId,
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`,
          properties: { title: 'Sheets Plan' },
          owners: [{ emailAddress: 'owner@example.com' }],
          sheets: [
            {
              properties: {
                sheetId: 11,
                title: 'Summary',
                index: 0,
                sheetType: 'GRID',
                gridProperties: { rowCount: 1000, columnCount: 40 }
              }
            },
            {
              properties: {
                sheetId: 22,
                title: 'Hidden',
                index: 1,
                hidden: true,
                sheetType: 'GRID',
                gridProperties: { rowCount: 5, columnCount: 5 }
              }
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    if (url.startsWith(`${encodedSpreadsheetUrl}/values:batchGet`)) {
      events.push('values.batchGet')
      valuesUrl = new URL(url)
      valuesAuthorization = new Headers(init?.headers).get('authorization')
      return new Response(
        JSON.stringify({
          spreadsheetId,
          refreshToken: 'should-not-leak',
          valueRanges: [
            {
              range: 'Summary!A1:C3',
              majorDimension: 'ROWS',
              values: [
                ['Name', 'Amount', 'Formula'],
                ['Launch', 42, '=SUM(B2:B2)'],
                ['Done', true, null]
              ]
            },
            {
              range: "'Data Sheet'!B2:D4",
              majorDimension: 'ROWS',
              values: [['North', 'South', 'West']]
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
    const output = JSON.parse(
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.sheets.read',
        {
          spreadsheetId: ` ${spreadsheetId} `,
          ranges: [' Summary!A1:C3 ', "'Data Sheet'!B2:D4"],
          valueRenderOption: 'FORMULA'
        },
        { directory: projectPath, sessionID: 'session-sheets' }
      )
    ) as {
      spreadsheet: Record<string, unknown>
    }

    expect(events).toEqual(['spreadsheets.get', 'values.batchGet'])
    expect(metadataAuthorization).toBe('Bearer valid-sheets-access-token')
    expect(valuesAuthorization).toBe('Bearer valid-sheets-access-token')
    expect(metadataUrl?.origin).toBe('https://sheets.googleapis.com')
    expect(metadataUrl?.pathname).toBe(`/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`)
    expect(metadataUrl?.searchParams.get('fields')).toBe(
      'spreadsheetId,properties(title),spreadsheetUrl,sheets(properties(sheetId,title,index,sheetType,hidden,gridProperties(rowCount,columnCount)))'
    )
    expect(valuesUrl?.origin).toBe('https://sheets.googleapis.com')
    expect(valuesUrl?.pathname).toBe(
      `/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet`
    )
    expect(valuesUrl?.searchParams.getAll('ranges')).toEqual([
      'Summary!A1:C3',
      "'Data Sheet'!B2:D4"
    ])
    expect(valuesUrl?.searchParams.get('valueRenderOption')).toBe('FORMULA')
    expect(valuesUrl?.searchParams.get('fields')).toBe(
      'spreadsheetId,valueRanges(range,majorDimension,values)'
    )
    expect(output.spreadsheet).toEqual({
      type: 'google.sheet.spreadsheet',
      id: spreadsheetId,
      title: 'Sheets Plan',
      link: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`,
      sheets: [
        {
          id: 11,
          title: 'Summary',
          index: 0,
          hidden: false,
          sheetType: 'GRID',
          rowCount: 1000,
          columnCount: 40
        },
        {
          id: 22,
          title: 'Hidden',
          index: 1,
          hidden: true,
          sheetType: 'GRID',
          rowCount: 5,
          columnCount: 5
        }
      ],
      ranges: [
        {
          range: 'Summary!A1:C3',
          majorDimension: 'ROWS',
          values: [
            ['Name', 'Amount', 'Formula'],
            ['Launch', 42, '=SUM(B2:B2)'],
            ['Done', true, null]
          ],
          rowCount: 3,
          columnCount: 3,
          cellCount: 9,
          truncated: false
        },
        {
          range: "'Data Sheet'!B2:D4",
          majorDimension: 'ROWS',
          values: [['North', 'South', 'West']],
          rowCount: 1,
          columnCount: 3,
          cellCount: 3,
          truncated: false
        }
      ],
      preview: {
        truncated: false,
        totalRangeCount: 2,
        includedRangeCount: 2,
        ranges: [
          {
            range: 'Summary!A1:C3',
            truncated: false,
            totalRowCount: 3,
            totalColumnCount: 3,
            totalCellCount: 9,
            totalTextLength: 44,
            includedRowCount: 3,
            includedCellCount: 9,
            includedTextLength: 44
          },
          {
            range: "'Data Sheet'!B2:D4",
            truncated: false,
            totalRowCount: 1,
            totalColumnCount: 3,
            totalCellCount: 3,
            totalTextLength: 14,
            includedRowCount: 1,
            includedCellCount: 3,
            includedTextLength: 14
          }
        ]
      }
    })

    const fullArtifactPath = expectedGoogleSheetArtifactAbsolutePath(projectPath, spreadsheetId)
    const fullArtifact = JSON.parse(await readFile(fullArtifactPath, 'utf8')) as Record<
      string,
      unknown
    >
    expect(fullArtifact).toMatchObject({
      type: 'google.sheet.spreadsheet',
      id: spreadsheetId,
      schemaVersion: 1,
      title: 'Sheets Plan'
    })
    expect(typeof fullArtifact.cachedAt).toBe('number')
    expect(fullArtifact).not.toHaveProperty('preview')
    expect(String(fullArtifactPath)).toContain('.openkhodam/artifacts/google-sheets')
    expect(String(fullArtifactPath)).not.toContain(spreadsheetId)
    const artifacts = JSON.parse(
      await readFile(join(projectPath, '.openkhodam', 'artifacts.json'), 'utf8')
    ) as {
      sessions: Record<string, Array<Record<string, unknown>>>
    }
    expect(artifacts.sessions['session-sheets']).toHaveLength(1)
    expect(artifacts.sessions['session-sheets']?.[0]).toMatchObject({
      artifactPath: expectedGoogleSheetArtifactPath(spreadsheetId),
      firstMessageId: null,
      id: spreadsheetId,
      lastMessageId: null,
      listed: true,
      title: 'Sheets Plan',
      type: 'google.sheet.spreadsheet',
      url: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`
    })
    expect(String(artifacts.sessions['session-sheets']?.[0]?.artifactPath)).not.toContain(
      spreadsheetId
    )
    expect(JSON.stringify(artifacts)).not.toContain('Amount')
    expect(JSON.stringify(artifacts)).not.toContain('Launch')

    const outputText = JSON.stringify(output)
    expect(outputText).not.toContain('valid-sheets-access-token')
    expect(outputText).not.toContain('refresh-token')
    expect(outputText).not.toContain('should-not-leak')
    expect(outputText).not.toContain('owner@example.com')
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('derives bounded default visible-sheet ranges for Google Sheets reads', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-google-sheets-default-ranges-'))
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const requestedRanges: string[] = []

  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleSheetsSpreadsheetsScope, 'openid', 'profile'],
    token: {
      accessToken: 'default-sheets-access-token',
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

    if (
      url.startsWith('https://sheets.googleapis.com/v4/spreadsheets/default-sheet/values:batchGet')
    ) {
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer default-sheets-access-token'
      )
      const parsed = new URL(url)
      requestedRanges.push(...parsed.searchParams.getAll('ranges'))
      return new Response(
        JSON.stringify({
          spreadsheetId: 'default-sheet',
          valueRanges: requestedRanges.map((range) => ({
            range,
            majorDimension: 'ROWS',
            values: [[range]]
          }))
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    if (url.startsWith('https://sheets.googleapis.com/v4/spreadsheets/default-sheet')) {
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer default-sheets-access-token'
      )
      return new Response(
        JSON.stringify({
          spreadsheetId: 'default-sheet',
          properties: { title: 'Default Ranges' },
          sheets: [
            { properties: { title: 'First', index: 0, sheetType: 'GRID' } },
            { properties: { title: 'Hidden', index: 1, hidden: true, sheetType: 'GRID' } },
            { properties: { title: "Bob's Sheet", index: 2, sheetType: 'GRID' } },
            { properties: { title: 'Chart', index: 3, sheetType: 'OBJECT' } },
            { properties: { title: 'Third', index: 4, sheetType: 'GRID' } },
            { properties: { title: 'Fourth', index: 5, sheetType: 'GRID' } },
            { properties: { title: 'Fifth', index: 6, sheetType: 'GRID' } },
            { properties: { title: 'Sixth', index: 7, sheetType: 'GRID' } }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    throw new Error(`Unexpected fetch URL: ${url}`)
  }) as typeof fetch

  try {
    const plugin = await loadGoogleWorkspacePlugin()
    const output = JSON.parse(
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.sheets.read',
        { spreadsheetId: 'default-sheet', ranges: [] },
        {}
      )
    ) as {
      spreadsheet: { ranges: Array<{ range: string; values: string[][] }> }
    }

    expect(requestedRanges).toEqual([
      "'First'!A1:Z200",
      "'Bob''s Sheet'!A1:Z200",
      "'Third'!A1:Z200",
      "'Fourth'!A1:Z200",
      "'Fifth'!A1:Z200"
    ])
    expect(output.spreadsheet.ranges.map((range) => range.range)).toEqual(requestedRanges)
    expect(output.spreadsheet.ranges[0]?.values).toEqual([["'First'!A1:Z200"]])
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('rejects blank Google Sheets read ranges before network access', async () => {
  const plugin = await loadGoogleWorkspacePlugin()
  let fetchCalls = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    fetchCalls += 1
    throw new Error('google.sheets.read should validate blank ranges before network access')
  }) as typeof fetch

  try {
    await expect(
      executeGoogleWorkspaceCommand(
        plugin,
        'google.sheets.read',
        { spreadsheetId: 'default-sheet', ranges: [' '] },
        {}
      )
    ).rejects.toThrow('requires ranges to be an array of at most 5 strings')
    expect(fetchCalls).toBe(0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('logs sanitized Google Sheets API failures without request bodies or cell contents', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-google-sheets-failure-'))
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const originalWarn = console.warn
  const warnings: unknown[][] = []
  let sheetsAuthorization: string | null = null

  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleSheetsSpreadsheetsScope, 'openid', 'profile'],
    token: {
      accessToken: 'failure-sheets-access-token',
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

    if (
      url.startsWith('https://sheets.googleapis.com/v4/spreadsheets/sheet-denied/values:batchGet')
    ) {
      sheetsAuthorization = new Headers(init?.headers).get('authorization')
      return new Response(
        JSON.stringify({
          error: {
            code: 403,
            errors: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }],
            message: 'Sheets permission denied.',
            status: 'PERMISSION_DENIED'
          },
          requestBody: 'request-body-should-not-log',
          valueRanges: [{ values: [['sensitive-cell-should-not-log']] }]
        }),
        { status: 403, headers: { 'content-type': 'application/json' } }
      )
    }

    if (url.startsWith('https://sheets.googleapis.com/v4/spreadsheets/sheet-denied')) {
      return new Response(
        JSON.stringify({
          spreadsheetId: 'sheet-denied',
          properties: { title: 'Denied Sheet' },
          sheets: [{ properties: { title: 'Summary', index: 0, sheetType: 'GRID' } }]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    throw new Error(`Unexpected fetch URL: ${url}`)
  }) as typeof fetch

  try {
    const plugin = await loadGoogleWorkspacePlugin()
    await expect(
      executeGoogleWorkspaceCommand(
        plugin,
        'google.sheets.read',
        { spreadsheetId: 'sheet-denied' },
        {}
      )
    ).rejects.toThrow(
      'Google Sheets values.batchGet failed (HTTP 403, PERMISSION_DENIED, ACCESS_TOKEN_SCOPE_INSUFFICIENT): Sheets permission denied.'
    )

    expect(sheetsAuthorization).toBe('Bearer failure-sheets-access-token')
    expect(warnings).toEqual([
      [
        'Google Workspace API request failed',
        {
          code: 'PERMISSION_DENIED',
          message: 'Sheets permission denied.',
          operation: 'Google Sheets values.batchGet',
          reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
          status: 403
        }
      ]
    ])
    const warningText = JSON.stringify(warnings)
    expect(warningText).not.toContain('failure-sheets-access-token')
    expect(warningText).not.toContain('refresh-token')
    expect(warningText).not.toContain('request-body-should-not-log')
    expect(warningText).not.toContain('sensitive-cell-should-not-log')
  } finally {
    console.warn = originalWarn
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('writes Google Sheets edits directly and persists refreshed spreadsheet artifacts', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-google-sheets-edit-'))
  const userDataPath = join(tempRoot, 'user-data')
  const projectPath = join(tempRoot, 'project')
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const spreadsheetId = 'sheet/edit?:unsafe'
  const encodedSpreadsheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`
  const events: string[] = []
  const batchGetCallsByRange = new Map<string, number>()
  const writeBodies = new Map<string, unknown>()
  const writeUrls = new Map<string, URL>()
  let askCalls = 0

  await mkdir(projectPath, { recursive: true })
  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleSheetsSpreadsheetsWriteScope, 'openid', 'profile'],
    token: {
      accessToken: 'sheets-edit-access-token',
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
    const parsed = new URL(url)

    if (url.startsWith(`${encodedSpreadsheetUrl}/values:batchGet`)) {
      const range = parsed.searchParams.getAll('ranges')[0] ?? ''
      const count = (batchGetCallsByRange.get(range) ?? 0) + 1
      batchGetCallsByRange.set(range, count)
      events.push(`values.batchGet:${range}:${count}`)
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer sheets-edit-access-token'
      )

      const valuesByRange: Record<string, unknown[][]> = {
        'Summary!A1:B2':
          count === 1
            ? [['Old', 1]]
            : [
                ['Name', 'Amount'],
                ['Launch', 42]
              ],
        'Summary!A:C': [['Existing', 'Row']],
        'Summary!A3:B3': [['Appended', true]],
        'Summary!C1:C2': count === 1 ? [['sensitive-before-clear'], ['old value']] : []
      }

      return new Response(
        JSON.stringify({
          spreadsheetId,
          valueRanges: [
            {
              range,
              majorDimension: 'ROWS',
              values: valuesByRange[range] ?? []
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    if (url.startsWith(`${encodedSpreadsheetUrl}/values/`)) {
      const rangePath = parsed.pathname.split('/values/')[1] ?? ''
      const requestBody = typeof init?.body === 'string' ? JSON.parse(init.body) : null
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer sheets-edit-access-token'
      )
      expect(new Headers(init?.headers).get('content-type')).toBe('application/json')

      if (rangePath === 'Summary%21A1%3AB2') {
        events.push('values.update')
        writeBodies.set('set_values', requestBody)
        writeUrls.set('set_values', parsed)
        expect(init?.method).toBe('PUT')
        return new Response(
          JSON.stringify({
            spreadsheetId,
            updatedRange: 'Summary!A1:B2',
            updatedRows: 2,
            updatedColumns: 2,
            updatedCells: 4
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }

      if (rangePath === 'Summary%21A%3AC:append') {
        events.push('values.append')
        writeBodies.set('append_rows', requestBody)
        writeUrls.set('append_rows', parsed)
        expect(init?.method).toBe('POST')
        return new Response(
          JSON.stringify({
            spreadsheetId,
            tableRange: 'Summary!A1:C2',
            updates: {
              spreadsheetId,
              updatedRange: 'Summary!A3:B3',
              updatedRows: 1,
              updatedColumns: 2,
              updatedCells: 2
            }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }

      if (rangePath === 'Summary%21C1%3AC2:clear') {
        events.push('values.clear')
        writeBodies.set('clear_range', requestBody)
        writeUrls.set('clear_range', parsed)
        expect(init?.method).toBe('POST')
        return new Response(
          JSON.stringify({
            spreadsheetId,
            clearedRange: 'Summary!C1:C2'
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
    }

    if (url.startsWith(encodedSpreadsheetUrl)) {
      events.push('spreadsheets.get')
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer sheets-edit-access-token'
      )
      return new Response(
        JSON.stringify({
          spreadsheetId,
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`,
          properties: { title: 'Editable Sheet' },
          sheets: [
            {
              properties: {
                sheetId: 11,
                title: 'Summary',
                index: 0,
                sheetType: 'GRID',
                gridProperties: { rowCount: 20, columnCount: 5 }
              }
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
    const context = {
      ask: async () => {
        askCalls += 1
        throw new Error('google.sheets command should not call context.ask')
      },
      directory: projectPath,
      sessionID: 'session-sheets-edit'
    }

    const setOutput = JSON.parse(
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.sheets.set_values',
        {
          spreadsheetId,
          range: ' Summary!A1:B2 ',
          valueInputOption: 'RAW',
          values: [
            ['Name', 'Amount'],
            ['Launch', 42]
          ]
        },
        context
      )
    ) as {
      edit: Record<string, unknown>
      spreadsheet: { ranges: Array<{ range: string; values: unknown[][] }> }
    }
    const appendOutput = JSON.parse(
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.sheets.append_rows',
        {
          spreadsheetId,
          range: 'Summary!A:C',
          rows: [['Appended', true]]
        },
        context
      )
    ) as {
      edit: Record<string, unknown>
      spreadsheet: { ranges: Array<{ range: string; values: unknown[][] }> }
    }
    const clearOutput = JSON.parse(
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.sheets.clear_range',
        {
          spreadsheetId,
          range: 'Summary!C1:C2'
        },
        context
      )
    ) as {
      edit: Record<string, unknown>
      spreadsheet: { ranges: Array<{ range: string; values: unknown[][] }> }
    }

    expect(events).toEqual([
      'spreadsheets.get',
      'values.batchGet:Summary!A1:B2:1',
      'values.update',
      'values.batchGet:Summary!A1:B2:2',
      'spreadsheets.get',
      'values.batchGet:Summary!A:C:1',
      'values.append',
      'values.batchGet:Summary!A3:B3:1',
      'spreadsheets.get',
      'values.batchGet:Summary!C1:C2:1',
      'values.clear',
      'values.batchGet:Summary!C1:C2:2'
    ])
    expect(askCalls).toBe(0)
    expect(writeUrls.get('set_values')?.pathname).toBe(
      `/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/Summary%21A1%3AB2`
    )
    expect(writeUrls.get('set_values')?.searchParams.get('valueInputOption')).toBe('RAW')
    expect(writeUrls.get('append_rows')?.pathname).toBe(
      `/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/Summary%21A%3AC:append`
    )
    expect(writeUrls.get('append_rows')?.searchParams.get('valueInputOption')).toBe('USER_ENTERED')
    expect(writeUrls.get('append_rows')?.searchParams.get('insertDataOption')).toBe('INSERT_ROWS')
    expect(writeUrls.get('clear_range')?.pathname).toBe(
      `/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/Summary%21C1%3AC2:clear`
    )
    expect(writeBodies.get('set_values')).toEqual({
      majorDimension: 'ROWS',
      values: [
        ['Name', 'Amount'],
        ['Launch', 42]
      ]
    })
    expect(writeBodies.get('append_rows')).toEqual({
      majorDimension: 'ROWS',
      values: [['Appended', true]]
    })
    expect(writeBodies.get('clear_range')).toEqual({})

    expect(setOutput.edit).toMatchObject({
      affectedRange: 'Summary!A1:B2',
      inputCellCount: 4,
      inputColumnCount: 2,
      inputRowCount: 2,
      ok: true,
      operation: 'set_values',
      previousCellCount: 2,
      previousColumnCount: 2,
      previousRowCount: 1,
      rereadRange: 'Summary!A1:B2',
      requestedRange: 'Summary!A1:B2',
      spreadsheetId,
      updatedCells: 4,
      updatedColumns: 2,
      updatedRows: 2,
      valueInputOption: 'RAW'
    })
    expect(setOutput.spreadsheet.ranges[0]).toMatchObject({
      range: 'Summary!A1:B2',
      values: [
        ['Name', 'Amount'],
        ['Launch', 42]
      ]
    })
    expect(appendOutput.edit).toMatchObject({
      affectedRange: 'Summary!A3:B3',
      inputCellCount: 2,
      ok: true,
      operation: 'append_rows',
      rereadRange: 'Summary!A3:B3',
      requestedRange: 'Summary!A:C',
      updatedCells: 2,
      updatedColumns: 2,
      updatedRows: 1,
      valueInputOption: 'USER_ENTERED'
    })
    expect(appendOutput.spreadsheet.ranges[0]).toMatchObject({
      range: 'Summary!A3:B3',
      values: [['Appended', true]]
    })
    expect(clearOutput.edit).toMatchObject({
      affectedRange: 'Summary!C1:C2',
      clearedRange: 'Summary!C1:C2',
      inputCellCount: 0,
      ok: true,
      operation: 'clear_range',
      previousCellCount: 2,
      rereadRange: 'Summary!C1:C2',
      requestedRange: 'Summary!C1:C2',
      updatedCells: null,
      valueInputOption: null
    })
    expect(clearOutput.spreadsheet.ranges[0]).toMatchObject({
      range: 'Summary!C1:C2',
      values: []
    })
    expect(JSON.stringify(clearOutput)).not.toContain('sensitive-before-clear')

    const fullArtifactPath = expectedGoogleSheetArtifactAbsolutePath(projectPath, spreadsheetId)
    const fullArtifact = JSON.parse(await readFile(fullArtifactPath, 'utf8')) as Record<
      string,
      unknown
    >
    expect(fullArtifact).toMatchObject({
      id: spreadsheetId,
      schemaVersion: 1,
      title: 'Editable Sheet',
      type: 'google.sheet.spreadsheet'
    })
    expect(fullArtifact).not.toHaveProperty('preview')
    expect(fullArtifact).toHaveProperty('ranges')
    expect(typeof fullArtifact.cachedAt).toBe('number')
    expect(String(fullArtifactPath)).toContain('.openkhodam/artifacts/google-sheets')
    expect(String(fullArtifactPath)).not.toContain(spreadsheetId)
    const artifacts = JSON.parse(
      await readFile(join(projectPath, '.openkhodam', 'artifacts.json'), 'utf8')
    ) as {
      sessions: Record<string, Array<Record<string, unknown>>>
    }
    expect(artifacts.sessions['session-sheets-edit']).toHaveLength(1)
    expect(artifacts.sessions['session-sheets-edit']?.[0]).toMatchObject({
      artifactPath: expectedGoogleSheetArtifactPath(spreadsheetId),
      firstMessageId: null,
      id: spreadsheetId,
      lastMessageId: null,
      listed: true,
      title: 'Editable Sheet',
      type: 'google.sheet.spreadsheet',
      url: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`
    })
    expect(String(artifacts.sessions['session-sheets-edit']?.[0]?.artifactPath)).not.toContain(
      spreadsheetId
    )
    expect(JSON.stringify(artifacts)).not.toContain('Amount')
    expect(JSON.stringify(artifacts)).not.toContain('Launch')
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('logs sanitized Google Sheets write failures without request bodies or cell contents', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-google-sheets-edit-failure-'))
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const originalWarn = console.warn
  const warnings: unknown[][] = []
  const events: string[] = []
  let updateBody: unknown = null
  const multilineCell = 'Sensitive line one\nline two\twith tab'
  const escapedCell = 'Escaped "quote" and \\ slash'
  const repeatedWhitespaceCell = 'Repeated   whitespace\n\tcell'
  const longCell = `LONG_SECRET_${'z'.repeat(350)}`
  const jsonEscapedCell = JSON.stringify(escapedCell).slice(1, -1)
  const normalizedMultilineCell = 'Sensitive line one line two with tab'
  const normalizedRepeatedWhitespaceCell = 'Repeated whitespace cell'

  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleSheetsSpreadsheetsWriteScope, 'openid', 'profile'],
    token: {
      accessToken: 'sheets-edit-failure-token',
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

    if (
      url.startsWith('https://sheets.googleapis.com/v4/spreadsheets/sheet-conflict/values:batchGet')
    ) {
      events.push('values.batchGet')
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer sheets-edit-failure-token'
      )
      return new Response(
        JSON.stringify({
          spreadsheetId: 'sheet-conflict',
          valueRanges: [{ range: 'Summary!A1:B1', majorDimension: 'ROWS', values: [['Before']] }]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    if (url.startsWith('https://sheets.googleapis.com/v4/spreadsheets/sheet-conflict/values/')) {
      events.push('values.update')
      updateBody = typeof init?.body === 'string' ? JSON.parse(init.body) : null
      return new Response(
        JSON.stringify({
          error: {
            code: 409,
            errors: [{ reason: `conflict ${normalizedRepeatedWhitespaceCell}` }],
            message: `Sheet changed before write: ${multilineCell} ${longCell}.`,
            status: `ABORTED ${jsonEscapedCell}`
          },
          requestBody: 'request-body-should-not-log',
          values: [[multilineCell, escapedCell, repeatedWhitespaceCell, longCell]]
        }),
        { status: 409, headers: { 'content-type': 'application/json' } }
      )
    }

    if (url.startsWith('https://sheets.googleapis.com/v4/spreadsheets/sheet-conflict')) {
      events.push('spreadsheets.get')
      return new Response(
        JSON.stringify({
          spreadsheetId: 'sheet-conflict',
          properties: { title: 'Conflict Sheet' },
          sheets: [{ properties: { title: 'Summary', index: 0, sheetType: 'GRID' } }]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    throw new Error(`Unexpected fetch URL: ${url}`)
  }) as typeof fetch

  try {
    const plugin = await loadGoogleWorkspacePlugin()
    let thrownMessage = ''
    try {
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.sheets.set_values',
        {
          spreadsheetId: 'sheet-conflict',
          range: 'Summary!A1:B1',
          values: [[multilineCell, escapedCell, repeatedWhitespaceCell, longCell]]
        },
        {}
      )
    } catch (error) {
      thrownMessage = error instanceof Error ? error.message : String(error)
    }
    expect(thrownMessage).toBe('Google Sheets values.update failed (HTTP 409).')

    expect(events).toEqual(['spreadsheets.get', 'values.batchGet', 'values.update'])
    expect(updateBody).toEqual({
      majorDimension: 'ROWS',
      values: [[multilineCell, escapedCell, repeatedWhitespaceCell, longCell]]
    })
    expect(warnings).toEqual([
      [
        'Google Workspace API request failed',
        {
          code: null,
          message: null,
          operation: 'Google Sheets values.update',
          reason: null,
          status: 409
        }
      ]
    ])
    const publicFailureText = JSON.stringify([warnings, thrownMessage])
    expect(publicFailureText).not.toContain('sheets-edit-failure-token')
    expect(publicFailureText).not.toContain('refresh-token')
    expect(publicFailureText).not.toContain('request-body-should-not-log')
    expect(publicFailureText).not.toContain(multilineCell)
    expect(publicFailureText).not.toContain(normalizedMultilineCell)
    expect(publicFailureText).not.toContain(escapedCell)
    expect(publicFailureText).not.toContain(jsonEscapedCell)
    expect(publicFailureText).not.toContain(repeatedWhitespaceCell)
    expect(publicFailureText).not.toContain(normalizedRepeatedWhitespaceCell)
    expect(publicFailureText).not.toContain(longCell)
    expect(publicFailureText).not.toContain('LONG_SECRET_')
  } finally {
    console.warn = originalWarn
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('writes semantic Google Docs insert edits directly and returns a bounded reread preview', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-google-docs-edit-insert-'))
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const events: string[] = []
  const rawInsertedText = '\\n\\nDirect edit'
  const normalizedInsertedText = '\n\nDirect edit'
  const updatedText = 'Intro this is nice\nAgain this is nice\n\nDirect edit'
  let batchAuthorization: string | null = null
  let batchBody: unknown = null
  let batchUrl: URL | null = null
  let docsGets = 0

  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleDocsDocumentsScope, 'openid', 'profile'],
    token: {
      accessToken: 'edit-access-token',
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

    if (url.startsWith('https://docs.googleapis.com/v1/documents/doc-edit:batchUpdate')) {
      events.push('batchUpdate')
      batchUrl = new URL(url)
      batchAuthorization = new Headers(init?.headers).get('authorization')
      expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
      batchBody = typeof init?.body === 'string' ? JSON.parse(init.body) : null
      return new Response(
        JSON.stringify({
          documentId: 'doc-edit',
          writeControl: { targetRevisionId: 'rev-batch-edit' }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    if (url.startsWith('https://docs.googleapis.com/v1/documents/doc-edit')) {
      docsGets += 1
      events.push(`documents.get:${docsGets}`)
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer edit-access-token')
      const body =
        docsGets === 1
          ? {
              body: {
                content: [
                  {
                    startIndex: 1,
                    endIndex: 20,
                    paragraph: {
                      elements: [
                        {
                          startIndex: 1,
                          endIndex: 20,
                          textRun: { content: 'Intro this is nice\n' }
                        }
                      ]
                    }
                  },
                  {
                    startIndex: 20,
                    endIndex: 39,
                    paragraph: {
                      elements: [
                        {
                          startIndex: 20,
                          endIndex: 39,
                          textRun: { content: 'Again this is nice\n' }
                        }
                      ]
                    }
                  }
                ]
              },
              documentId: 'doc-edit',
              revisionId: 'rev-before-edit',
              title: 'Edit Target'
            }
          : {
              body: {
                content: [
                  {
                    paragraph: {
                      elements: [{ textRun: { content: 'Intro this is nice\n' } }]
                    }
                  },
                  {
                    paragraph: {
                      elements: [{ textRun: { content: 'Again this is nice\n\nDirect edit\n' } }]
                    }
                  }
                ]
              },
              documentId: 'doc-edit',
              revisionId: 'rev-after-edit',
              title: 'Edited Target'
            }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }

    throw new Error(`Unexpected fetch URL: ${url}`)
  }) as typeof fetch

  try {
    const plugin = await loadGoogleWorkspacePlugin()
    const discovery = await listGoogleWorkspaceCommands(plugin)
    const insertAfterCommand = discovery.commands.find(
      (command) => command.id === 'google.docs.insert_after_text'
    )
    expect(insertAfterCommand).toMatchObject({
      description: expect.stringContaining('Insert literal text after'),
      inputSchema: { required: ['documentId', 'match', 'text'] }
    })
    const operationSchemaText = JSON.stringify(insertAfterCommand?.inputSchema)
    expect(operationSchemaText).not.toContain('startIndex')
    expect(operationSchemaText).not.toContain('endIndex')
    expect(operationSchemaText).not.toContain('insertionIndex')

    const output = JSON.parse(
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.docs.insert_after_text',
        {
          documentId: 'doc-edit',
          match: 'this is nice',
          text: rawInsertedText
        },
        {}
      )
    ) as {
      document: Record<string, unknown>
      edit: Record<string, unknown>
    }

    expect(events).toEqual(['documents.get:1', 'batchUpdate', 'documents.get:2'])
    expect(batchUrl?.pathname).toBe('/v1/documents/doc-edit:batchUpdate')
    expect(batchAuthorization).toBe('Bearer edit-access-token')
    expect(batchBody).toEqual({
      requests: [
        {
          insertText: {
            location: { index: 38 },
            text: normalizedInsertedText
          }
        }
      ],
      writeControl: { requiredRevisionId: 'rev-before-edit' }
    })
    expect(output.edit).toEqual({
      deletedTextLength: 0,
      documentId: 'doc-edit',
      insertedTextLength: normalizedInsertedText.length,
      link: 'https://docs.google.com/document/d/doc-edit/edit',
      ok: true,
      operation: 'insert_after_text',
      revision: 'rev-after-edit',
      textLengthDelta: normalizedInsertedText.length,
      title: 'Edited Target'
    })
    expect(output.document).toMatchObject({
      id: 'doc-edit',
      link: 'https://docs.google.com/document/d/doc-edit/edit',
      preview: {
        truncated: false,
        totalTextLength: updatedText.length,
        totalBlockCount: 2,
        includedBlockCount: 2
      },
      revision: 'rev-after-edit',
      text: updatedText,
      title: 'Edited Target',
      type: 'google.doc.document'
    })

    const outputText = JSON.stringify(output)
    expect(outputText).not.toContain('edit-access-token')
    expect(outputText).not.toContain('refresh-token')
    expect(outputText).not.toContain('startIndex')
    expect(outputText).not.toContain('endIndex')
    expect(outputText).not.toContain('markdown')
    expect(outputText).not.toContain('38')
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('supports semantic Google Docs insert-before, replace, and delete edits', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-google-docs-edit-semantic-'))
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const events: string[] = []
  const batchBodies = new Map<string, unknown>()
  const docsGets = new Map<string, number>()
  const scenarios = [
    {
      afterBody: createGoogleDocParagraphs(['Alpha anchor\n', 'Beta before anchor\n']),
      afterRevision: 'rev-insert-before-after',
      afterText: 'Alpha anchor\nBeta before anchor',
      afterTitle: 'Insert Before Edited',
      beforeBody: [
        {
          startIndex: 1,
          endIndex: 14,
          paragraph: {
            elements: [{ startIndex: 1, endIndex: 14, textRun: { content: 'Alpha anchor\n' } }]
          }
        },
        {
          startIndex: 14,
          endIndex: 26,
          paragraph: {
            elements: [{ startIndex: 14, endIndex: 26, textRun: { content: 'Beta anchor\n' } }]
          }
        }
      ],
      beforeRevision: 'rev-insert-before-before',
      beforeTitle: 'Insert Before Target',
      documentId: 'doc-insert-before',
      expectedBatch: {
        requests: [
          {
            insertText: {
              location: { index: 19 },
              text: 'before '
            }
          }
        ],
        writeControl: { requiredRevisionId: 'rev-insert-before-before' }
      },
      expectedEdit: {
        deletedTextLength: 0,
        insertedTextLength: 'before '.length,
        operation: 'insert_before_text',
        textLengthDelta: 'before '.length
      },
      operation: { match: 'anchor', text: 'before ', type: 'insert_before_text' }
    },
    {
      afterBody: createGoogleDocParagraphs([
        'Intro helo this is nice\n',
        'Again hello this is great\n'
      ]),
      afterRevision: 'rev-replace-after',
      afterText: 'Intro helo this is nice\nAgain hello this is great',
      afterTitle: 'Replace Edited',
      beforeBody: [
        {
          startIndex: 1,
          endIndex: 25,
          paragraph: {
            elements: [
              { startIndex: 1, endIndex: 25, textRun: { content: 'Intro helo this is nice\n' } }
            ]
          }
        },
        {
          startIndex: 25,
          endIndex: 49,
          paragraph: {
            elements: [
              { startIndex: 25, endIndex: 49, textRun: { content: 'Again helo this is nice\n' } }
            ]
          }
        }
      ],
      beforeRevision: 'rev-replace-before',
      beforeTitle: 'Replace Target',
      documentId: 'doc-replace',
      expectedBatch: {
        requests: [
          {
            deleteContentRange: {
              range: {
                startIndex: 31,
                endIndex: 48
              }
            }
          },
          {
            insertText: {
              location: { index: 31 },
              text: 'hello this is great'
            }
          }
        ],
        writeControl: { requiredRevisionId: 'rev-replace-before' }
      },
      expectedEdit: {
        deletedTextLength: 'helo this is nice'.length,
        insertedTextLength: 'hello this is great'.length,
        operation: 'replace_text',
        textLengthDelta: 'hello this is great'.length - 'helo this is nice'.length
      },
      operation: {
        match: 'helo this is nice',
        text: 'hello this is great',
        type: 'replace_text'
      }
    },
    {
      afterBody: createGoogleDocParagraphs(['Alpha  beta\n']),
      afterRevision: 'rev-delete-after',
      afterText: 'Alpha  beta',
      afterTitle: 'Delete Edited',
      beforeBody: [
        {
          startIndex: 1,
          endIndex: 24,
          paragraph: {
            elements: [
              { startIndex: 1, endIndex: 24, textRun: { content: 'Alpha remove this beta\n' } }
            ]
          }
        }
      ],
      beforeRevision: 'rev-delete-before',
      beforeTitle: 'Delete Target',
      documentId: 'doc-delete',
      expectedBatch: {
        requests: [
          {
            deleteContentRange: {
              range: {
                startIndex: 7,
                endIndex: 18
              }
            }
          }
        ],
        writeControl: { requiredRevisionId: 'rev-delete-before' }
      },
      expectedEdit: {
        deletedTextLength: 'remove this'.length,
        insertedTextLength: 0,
        operation: 'delete_text',
        textLengthDelta: -'remove this'.length
      },
      operation: { match: 'remove this', occurrence: 'first', type: 'delete_text' }
    }
  ]

  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleDocsDocumentsScope, 'openid', 'profile'],
    token: {
      accessToken: 'semantic-edit-access-token',
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
    const parsed = new URL(url)
    const docsPathPrefix = '/v1/documents/'

    if (
      parsed.origin === 'https://docs.googleapis.com' &&
      parsed.pathname.startsWith(docsPathPrefix) &&
      parsed.pathname.endsWith(':batchUpdate')
    ) {
      const encodedDocumentId = parsed.pathname.slice(docsPathPrefix.length, -':batchUpdate'.length)
      const documentId = decodeURIComponent(encodedDocumentId)
      events.push(`${documentId}:batchUpdate`)
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer semantic-edit-access-token'
      )
      batchBodies.set(documentId, typeof init?.body === 'string' ? JSON.parse(init.body) : null)
      return new Response(
        JSON.stringify({
          documentId,
          writeControl: { targetRevisionId: `batch-${documentId}` }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    const documentId = readFetchedGoogleDocsDocumentId(url)
    const scenario = scenarios.find((candidate) => candidate.documentId === documentId)
    if (scenario) {
      const getCount = (docsGets.get(scenario.documentId) ?? 0) + 1
      docsGets.set(scenario.documentId, getCount)
      events.push(`${scenario.documentId}:documents.get:${getCount}`)
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer semantic-edit-access-token'
      )

      const body =
        getCount === 1
          ? {
              body: { content: scenario.beforeBody },
              documentId: scenario.documentId,
              revisionId: scenario.beforeRevision,
              title: scenario.beforeTitle
            }
          : {
              body: { content: scenario.afterBody },
              documentId: scenario.documentId,
              revisionId: scenario.afterRevision,
              title: scenario.afterTitle
            }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }

    throw new Error(`Unexpected fetch URL: ${url}`)
  }) as typeof fetch

  try {
    const plugin = await loadGoogleWorkspacePlugin()
    for (const scenario of scenarios) {
      const output = JSON.parse(
        await executeGoogleWorkspaceCommand(
          plugin,
          `google.docs.${scenario.operation.type}`,
          {
            documentId: scenario.documentId,
            ...googleDocsOperationCommandInput(scenario.operation)
          },
          {}
        )
      ) as {
        document: Record<string, unknown>
        edit: Record<string, unknown>
      }

      expect(batchBodies.get(scenario.documentId)).toEqual(scenario.expectedBatch)
      expect(output.edit).toEqual({
        documentId: scenario.documentId,
        link: `https://docs.google.com/document/d/${scenario.documentId}/edit`,
        ok: true,
        revision: scenario.afterRevision,
        title: scenario.afterTitle,
        ...scenario.expectedEdit
      })
      expect(output.document).toMatchObject({
        id: scenario.documentId,
        preview: {
          truncated: false,
          totalTextLength: scenario.afterText.length,
          totalBlockCount: scenario.afterBody.length,
          includedBlockCount: scenario.afterBody.length
        },
        revision: scenario.afterRevision,
        text: scenario.afterText,
        title: scenario.afterTitle,
        type: 'google.doc.document'
      })
    }

    expect(events).toEqual(
      scenarios.flatMap((scenario) => [
        `${scenario.documentId}:documents.get:1`,
        `${scenario.documentId}:batchUpdate`,
        `${scenario.documentId}:documents.get:2`
      ])
    )
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('refreshes full Google Docs artifacts after successful append_text edits', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-google-docs-edit-artifact-'))
  const userDataPath = join(tempRoot, 'user-data')
  const projectPath = join(tempRoot, 'project')
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const documentId = 'doc-edit-artifact?:unsafe'
  const encodedDocumentUrl = `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`
  const events: string[] = []
  const appendedText = '\nAppended after write'
  const updatedText = 'Before\nAppended after write'
  let batchBody: unknown = null
  let docsGets = 0

  await mkdir(projectPath, { recursive: true })
  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleDocsDocumentsScope, 'openid', 'profile'],
    token: {
      accessToken: 'edit-artifact-access-token',
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

    if (url.startsWith(`${encodedDocumentUrl}:batchUpdate`)) {
      events.push('batchUpdate')
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer edit-artifact-access-token'
      )
      batchBody = typeof init?.body === 'string' ? JSON.parse(init.body) : null
      return new Response(
        JSON.stringify({
          documentId,
          writeControl: { targetRevisionId: 'rev-artifact-batch' }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    if (url.startsWith(encodedDocumentUrl)) {
      docsGets += 1
      events.push(`documents.get:${docsGets}`)
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer edit-artifact-access-token'
      )
      const body =
        docsGets === 1
          ? {
              body: {
                content: [
                  {
                    startIndex: 1,
                    endIndex: 8,
                    paragraph: {
                      elements: [{ startIndex: 1, endIndex: 8, textRun: { content: 'Before\n' } }]
                    }
                  }
                ]
              },
              documentId,
              revisionId: 'rev-artifact-before',
              title: 'Artifact Target'
            }
          : {
              body: {
                content: createGoogleDocParagraphs([`${updatedText}\n`])
              },
              documentId,
              revisionId: 'rev-artifact-after',
              title: 'Edited Artifact Target'
            }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }

    throw new Error(`Unexpected fetch URL: ${url}`)
  }) as typeof fetch

  try {
    const plugin = await loadGoogleWorkspacePlugin()
    const output = JSON.parse(
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.docs.append_text',
        {
          documentId,
          text: appendedText
        },
        {
          directory: projectPath,
          sessionID: 'session-edit'
        }
      )
    ) as {
      document: Record<string, unknown>
      edit: Record<string, unknown>
    }

    expect(events).toEqual(['documents.get:1', 'batchUpdate', 'documents.get:2'])
    expect(batchBody).toEqual({
      requests: [
        {
          insertText: {
            location: { index: 7 },
            text: appendedText
          }
        }
      ],
      writeControl: { requiredRevisionId: 'rev-artifact-before' }
    })
    expect(output.edit).toMatchObject({
      documentId,
      insertedTextLength: appendedText.length,
      operation: 'append_text',
      revision: 'rev-artifact-after',
      title: 'Edited Artifact Target'
    })
    expect(output.document).toMatchObject({
      id: documentId,
      preview: {
        truncated: false,
        totalTextLength: updatedText.length,
        totalBlockCount: 1,
        includedBlockCount: 1
      },
      revision: 'rev-artifact-after',
      text: updatedText,
      title: 'Edited Artifact Target'
    })

    const fullArtifactPath = expectedGoogleDocArtifactAbsolutePath(projectPath, documentId)
    const fullArtifact = JSON.parse(await readFile(fullArtifactPath, 'utf8')) as {
      body: { blocks: Array<{ text: string }> }
      cachedAt: unknown
      id: string
      revision: string
      schemaVersion: unknown
      text: string
      title: string
    }
    expect(fullArtifact).toMatchObject({
      id: documentId,
      revision: 'rev-artifact-after',
      schemaVersion: 2,
      text: updatedText,
      title: 'Edited Artifact Target'
    })
    expect(typeof fullArtifact.cachedAt).toBe('number')
    expect(fullArtifact.body.blocks[0]?.text).toBe(`${updatedText}\n`)

    const artifacts = JSON.parse(
      await readFile(join(projectPath, '.openkhodam', 'artifacts.json'), 'utf8')
    ) as {
      sessions: Record<string, Array<Record<string, unknown>>>
    }
    expect(artifacts.sessions['session-edit']).toHaveLength(1)
    expect(artifacts.sessions['session-edit']?.[0]).toMatchObject({
      artifactPath: expectedGoogleDocArtifactPath(documentId),
      id: documentId,
      listed: true,
      title: 'Edited Artifact Target',
      url: `https://docs.google.com/document/d/${encodeURIComponent(documentId)}/edit`
    })
    expect(String(artifacts.sessions['session-edit']?.[0]?.artifactPath)).not.toContain(documentId)
    expect(JSON.stringify(fullArtifact)).not.toContain('markdown')
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('writes every Google Docs edit operation directly without context.ask', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-google-docs-edit-direct-'))
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const events: string[] = []
  const batchBodies = new Map<string, unknown>()
  const docsGets = new Map<string, number>()
  const directWriteCases = [
    {
      afterBody: createGoogleDocParagraphs(['Body anchor\nDirect append\n']),
      afterText: 'Body anchor\nDirect append',
      documentId: 'doc-direct-append_text',
      expectedBatch: {
        requests: [
          {
            insertText: {
              location: { index: 12 },
              text: 'Direct append'
            }
          }
        ],
        writeControl: { requiredRevisionId: 'rev-before-append_text' }
      },
      expectedEdit: {
        deletedTextLength: 0,
        insertedTextLength: 'Direct append'.length,
        operation: 'append_text',
        textLengthDelta: 'Direct append'.length
      },
      name: 'append_text',
      operation: { text: 'Direct append', type: 'append_text' }
    },
    {
      afterBody: createGoogleDocParagraphs(['Body after anchor\n']),
      afterText: 'Body after anchor',
      documentId: 'doc-direct-insert_after_text',
      expectedBatch: {
        requests: [
          {
            insertText: {
              location: { index: 5 },
              text: ' after'
            }
          }
        ],
        writeControl: { requiredRevisionId: 'rev-before-insert_after_text' }
      },
      expectedEdit: {
        deletedTextLength: 0,
        insertedTextLength: ' after'.length,
        operation: 'insert_after_text',
        textLengthDelta: ' after'.length
      },
      name: 'insert_after_text',
      operation: { match: 'Body', text: ' after', type: 'insert_after_text' }
    },
    {
      afterBody: createGoogleDocParagraphs(['Before Body anchor\n']),
      afterText: 'Before Body anchor',
      documentId: 'doc-direct-insert_before_text',
      expectedBatch: {
        requests: [
          {
            insertText: {
              location: { index: 1 },
              text: 'Before '
            }
          }
        ],
        writeControl: { requiredRevisionId: 'rev-before-insert_before_text' }
      },
      expectedEdit: {
        deletedTextLength: 0,
        insertedTextLength: 'Before '.length,
        operation: 'insert_before_text',
        textLengthDelta: 'Before '.length
      },
      name: 'insert_before_text',
      operation: { match: 'Body', text: 'Before ', type: 'insert_before_text' }
    },
    {
      afterBody: createGoogleDocParagraphs(['Replaced anchor\n']),
      afterText: 'Replaced anchor',
      documentId: 'doc-direct-replace_text',
      expectedBatch: {
        requests: [
          {
            deleteContentRange: {
              range: {
                startIndex: 1,
                endIndex: 5
              }
            }
          },
          {
            insertText: {
              location: { index: 1 },
              text: 'Replaced'
            }
          }
        ],
        writeControl: { requiredRevisionId: 'rev-before-replace_text' }
      },
      expectedEdit: {
        deletedTextLength: 'Body'.length,
        insertedTextLength: 'Replaced'.length,
        operation: 'replace_text',
        textLengthDelta: 'Replaced'.length - 'Body'.length
      },
      name: 'replace_text',
      operation: { match: 'Body', text: 'Replaced', type: 'replace_text' }
    },
    {
      afterBody: createGoogleDocParagraphs(['Body \n']),
      afterText: 'Body',
      documentId: 'doc-direct-delete_text',
      expectedBatch: {
        requests: [
          {
            deleteContentRange: {
              range: {
                startIndex: 6,
                endIndex: 12
              }
            }
          }
        ],
        writeControl: { requiredRevisionId: 'rev-before-delete_text' }
      },
      expectedEdit: {
        deletedTextLength: 'anchor'.length,
        insertedTextLength: 0,
        operation: 'delete_text',
        textLengthDelta: -'anchor'.length
      },
      name: 'delete_text',
      operation: { match: 'anchor', type: 'delete_text' }
    }
  ]

  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleDocsDocumentsScope, 'openid', 'profile'],
    token: {
      accessToken: 'direct-write-access-token',
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

    if (
      url.startsWith('https://docs.googleapis.com/v1/documents/') &&
      url.includes(':batchUpdate')
    ) {
      const parsed = new URL(url)
      const documentId = decodeURIComponent(
        parsed.pathname.slice('/v1/documents/'.length, -':batchUpdate'.length)
      )
      events.push(`${documentId}:batchUpdate`)
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer direct-write-access-token'
      )
      batchBodies.set(documentId, typeof init?.body === 'string' ? JSON.parse(init.body) : null)
      return new Response(
        JSON.stringify({
          documentId,
          writeControl: { targetRevisionId: `rev-batch-${documentId}` }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    const fetchedDocumentId = readFetchedGoogleDocsDocumentId(url)
    const directWriteCase = directWriteCases.find(
      (candidate) => candidate.documentId === fetchedDocumentId
    )
    if (directWriteCase) {
      const getCount = (docsGets.get(directWriteCase.documentId) ?? 0) + 1
      docsGets.set(directWriteCase.documentId, getCount)
      events.push(`${directWriteCase.documentId}:documents.get:${getCount}`)
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer direct-write-access-token'
      )
      return new Response(
        JSON.stringify({
          body: {
            content:
              getCount === 1
                ? [
                    {
                      startIndex: 1,
                      endIndex: 13,
                      paragraph: {
                        elements: [
                          { startIndex: 1, endIndex: 13, textRun: { content: 'Body anchor\n' } }
                        ]
                      }
                    }
                  ]
                : directWriteCase.afterBody
          },
          documentId: directWriteCase.documentId,
          revisionId:
            getCount === 1
              ? `rev-before-${directWriteCase.name}`
              : `rev-after-${directWriteCase.name}`,
          title: getCount === 1 ? 'Direct Write Target' : `Edited ${directWriteCase.name}`
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    throw new Error(`Unexpected fetch URL: ${url}`)
  }) as typeof fetch

  try {
    const plugin = await loadGoogleWorkspacePlugin()
    for (const directWriteCase of directWriteCases) {
      const output = JSON.parse(
        await executeGoogleWorkspaceCommand(
          plugin,
          `google.docs.${directWriteCase.operation.type}`,
          {
            documentId: directWriteCase.documentId,
            ...googleDocsOperationCommandInput(directWriteCase.operation)
          },
          {}
        )
      ) as {
        document: Record<string, unknown>
        edit: Record<string, unknown>
      }

      expect(batchBodies.get(directWriteCase.documentId)).toEqual(directWriteCase.expectedBatch)
      expect(output.edit).toEqual({
        documentId: directWriteCase.documentId,
        link: `https://docs.google.com/document/d/${directWriteCase.documentId}/edit`,
        ok: true,
        revision: `rev-after-${directWriteCase.name}`,
        title: `Edited ${directWriteCase.name}`,
        ...directWriteCase.expectedEdit
      })
      expect(output.document).toMatchObject({
        id: directWriteCase.documentId,
        preview: {
          truncated: false,
          totalTextLength: directWriteCase.afterText.length,
          totalBlockCount: directWriteCase.afterBody.length,
          includedBlockCount: directWriteCase.afterBody.length
        },
        revision: `rev-after-${directWriteCase.name}`,
        text: directWriteCase.afterText,
        title: `Edited ${directWriteCase.name}`,
        type: 'google.doc.document'
      })
    }
    expect(events).toEqual(
      directWriteCases.flatMap((directWriteCase) => [
        `${directWriteCase.documentId}:documents.get:1`,
        `${directWriteCase.documentId}:batchUpdate`,
        `${directWriteCase.documentId}:documents.get:2`
      ])
    )
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('discovers and executes Google Docs workspace commands with legacy-compatible requests', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-google-workspace-commands-'))
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const batchBodies = new Map<string, unknown>()
  const getCounts = new Map<string, number>()
  const cases = [
    {
      command: 'google.docs.append_text',
      input: { documentId: 'command-append', text: ' Added' },
      operation: 'append_text'
    },
    {
      command: 'google.docs.insert_before_text',
      input: { documentId: 'command-before', match: 'Body', text: 'Before ' },
      operation: 'insert_before_text'
    },
    {
      command: 'google.docs.insert_after_text',
      input: { documentId: 'command-after', match: 'Body', text: ' After' },
      operation: 'insert_after_text'
    },
    {
      command: 'google.docs.replace_text',
      input: { documentId: 'command-replace', match: 'Body', text: 'Changed' },
      operation: 'replace_text'
    },
    {
      command: 'google.docs.delete_text',
      input: { documentId: 'command-delete', match: 'anchor' },
      operation: 'delete_text'
    }
  ] as const

  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleDocsDocumentsScope, 'openid', 'profile'],
    token: {
      accessToken: 'command-access-token',
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
    if (url.includes(':batchUpdate')) {
      const documentId = decodeURIComponent(
        new URL(url).pathname.slice('/v1/documents/'.length, -':batchUpdate'.length)
      )
      batchBodies.set(documentId, typeof init?.body === 'string' ? JSON.parse(init.body) : null)
      return new Response(JSON.stringify({ documentId }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const documentId = readFetchedGoogleDocsDocumentId(url)
    const count = (getCounts.get(documentId) ?? 0) + 1
    getCounts.set(documentId, count)
    return new Response(
      JSON.stringify({
        body: {
          content: [
            {
              startIndex: 1,
              endIndex: 13,
              paragraph: {
                elements: [{ startIndex: 1, endIndex: 13, textRun: { content: 'Body anchor\n' } }]
              }
            }
          ]
        },
        documentId,
        revisionId: count === 1 ? 'before' : 'after',
        title: 'Command Target'
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }) as typeof fetch

  try {
    const plugin = await loadGoogleWorkspacePlugin()
    const discovery = JSON.parse(
      await plugin.tool.google_workspace_list_commands.execute({ query: '' }, {})
    ) as {
      commands: Array<{
        id: string
        inputSchema: { properties?: Record<string, unknown>; required: string[] }
      }>
    }
    expect(discovery.commands).toHaveLength(17)
    expect(discovery.commands.map((command) => command.id)).toEqual([
      'google.drive.search_files',
      'google.docs.read',
      'google.artifacts.read',
      ...cases.map((item) => item.command),
      'google.docs.format_text',
      'google.docs.format_paragraph',
      'google.docs.insert_list',
      'google.docs.insert_table',
      'google.docs.format_list',
      'google.sheets.read',
      'google.sheets.set_values',
      'google.sheets.append_rows',
      'google.sheets.clear_range'
    ])
    expect(
      discovery.commands.find((command) => command.id === 'google.docs.read')?.description
    ).toContain('google.artifacts.read')
    expect(
      discovery.commands.find((command) => command.id === 'google.docs.append_text')?.description
    ).toContain('artifactRef')
    expect(
      discovery.commands.find((command) => command.id === 'google.artifacts.read')?.description
    ).toContain('nextCursor')
    expect(discovery.commands.map((command) => command.inputSchema.required)).toEqual([
      [],
      ['documentId'],
      ['artifactRef'],
      ['documentId', 'text'],
      ['documentId', 'match', 'text'],
      ['documentId', 'match', 'text'],
      ['documentId', 'match', 'text'],
      ['documentId', 'match'],
      ['documentId', 'match', 'style'],
      ['documentId', 'match', 'style'],
      ['documentId', 'items', 'listType', 'placement'],
      ['documentId', 'placement', 'rows'],
      ['documentId', 'match', 'listType'],
      ['spreadsheetId'],
      ['spreadsheetId', 'range', 'values'],
      ['spreadsheetId', 'range', 'rows'],
      ['spreadsheetId', 'range']
    ])
    expect(
      discovery.commands.map((command) => Object.keys(command.inputSchema.properties ?? {}))
    ).toEqual([
      ['query', 'limit'],
      ['documentId'],
      ['artifactRef', 'cursor', 'maxBlocks', 'maxCharacters'],
      ['documentId', 'text'],
      ['documentId', 'match', 'occurrence', 'text'],
      ['documentId', 'match', 'occurrence', 'text'],
      ['documentId', 'match', 'occurrence', 'text'],
      ['documentId', 'match', 'occurrence'],
      ['documentId', 'match', 'occurrence', 'style'],
      ['documentId', 'match', 'occurrence', 'style'],
      ['documentId', 'listType', 'match', 'occurrence', 'items', 'placement'],
      ['documentId', 'match', 'occurrence', 'placement', 'rows'],
      ['documentId', 'listType', 'match', 'occurrence'],
      ['spreadsheetId', 'ranges', 'valueRenderOption'],
      ['spreadsheetId', 'range', 'values', 'valueInputOption'],
      ['spreadsheetId', 'range', 'rows', 'valueInputOption'],
      ['spreadsheetId', 'range']
    ])
    expect(plugin.tool.google_workspace_list_commands.args.query).toMatchObject({ type: 'string' })
    expect(
      JSON.parse(await plugin.tool.google_workspace_list_commands.execute({ query: 'replace' }, {}))
        .commands
    ).toHaveLength(1)

    for (const item of cases) {
      const output = JSON.parse(
        await plugin.tool.google_workspace_execute_command.execute(item, {})
      ) as { edit: { operation: string } }
      expect(output.edit.operation).toBe(item.operation)
      expect(batchBodies.get(item.input.documentId)).toMatchObject({ requests: expect.any(Array) })
      expect(getCounts.get(item.input.documentId)).toBe(2)
    }

    await expect(
      plugin.tool.google_workspace_execute_command.execute(
        { command: 'google.docs.unknown', input: {} },
        {}
      )
    ).rejects.toThrow('Unknown Google Workspace command')
    await expect(
      plugin.tool.google_workspace_execute_command.execute(
        { command: 'google.docs.append_text', input: { documentId: 'invalid' } },
        {}
      )
    ).rejects.toThrow('requires a non-empty text')
    await expect(
      plugin.tool.google_workspace_execute_command.execute(
        {
          command: 'google.docs.delete_text',
          input: { documentId: 'invalid-delete', match: 'Body', text: 'irrelevant' }
        },
        {}
      )
    ).rejects.toThrow('does not accept input property text')
    await expect(
      plugin.tool.google_workspace_execute_command.execute(
        {
          command: 'google.docs.append_text',
          input: { documentId: 'invalid-append', match: 'Body', text: 'valid' }
        },
        {}
      )
    ).rejects.toThrow('does not accept input property match')
    expect(getCounts.has('invalid')).toBe(false)
    expect(getCounts.has('invalid-delete')).toBe(false)
    expect(getCounts.has('invalid-append')).toBe(false)
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('Google Docs format commands compile strict native style requests', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-google-docs-format-'))
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const requests = new Map<string, unknown>()
  const getCounts = new Map<string, number>()
  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleDocsDocumentsScope, 'openid', 'profile'],
    token: {
      accessToken: 'format-access-token',
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
    if (url.includes(':batchUpdate')) {
      const id = decodeURIComponent(
        new URL(url).pathname.slice('/v1/documents/'.length, -':batchUpdate'.length)
      )
      requests.set(id, JSON.parse(init?.body as string))
      if (id === 'format-provider-error') {
        return new Response(
          JSON.stringify({
            error: {
              code: 400,
              message: 'Google rejected the supplied link URL.',
              status: 'INVALID_ARGUMENT'
            }
          }),
          { status: 400, headers: { 'content-type': 'application/json' } }
        )
      }
      return new Response(JSON.stringify({ documentId: id }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const id = readFetchedGoogleDocsDocumentId(url)
    const count = (getCounts.get(id) ?? 0) + 1
    getCounts.set(id, count)
    return new Response(
      JSON.stringify({
        body: {
          content: [
            {
              startIndex: 1,
              endIndex: 22,
              paragraph: {
                elements: [
                  { startIndex: 1, endIndex: 22, textRun: { content: 'Hello 😀target world\n' } }
                ]
              }
            },
            {
              startIndex: 22,
              endIndex: 46,
              paragraph: {
                elements: [
                  {
                    startIndex: 22,
                    endIndex: 46,
                    textRun: { content: 'Second target paragraph\n' }
                  }
                ]
              }
            }
          ]
        },
        documentId: id,
        revisionId: count === 1 ? 'format-before' : 'format-after',
        title: 'Format target'
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }) as typeof fetch
  try {
    const plugin = await loadGoogleWorkspacePlugin()
    await executeGoogleWorkspaceCommand(
      plugin,
      'google.docs.format_text',
      {
        documentId: 'format-text',
        match: 'target',
        occurrence: 'first',
        style: {
          backgroundColor: null,
          bold: false,
          fontFamily: 'Arial',
          fontSizePt: 12,
          foregroundColor: '#FF0000',
          italic: true,
          linkUrl: 'https://example.com/',
          strikethrough: false,
          underline: true
        }
      },
      {}
    )
    expect(requests.get('format-text')).toEqual({
      requests: [
        {
          updateTextStyle: {
            fields:
              'bold,italic,underline,strikethrough,weightedFontFamily,fontSize,foregroundColor,backgroundColor,link',
            range: { startIndex: 9, endIndex: 15 },
            textStyle: {
              bold: false,
              italic: true,
              underline: true,
              strikethrough: false,
              weightedFontFamily: { fontFamily: 'Arial' },
              fontSize: { magnitude: 12, unit: 'PT' },
              foregroundColor: { color: { rgbColor: { red: 1, green: 0, blue: 0 } } },
              link: { url: 'https://example.com/' }
            }
          }
        }
      ],
      writeControl: { requiredRevisionId: 'format-before' }
    })
    await executeGoogleWorkspaceCommand(
      plugin,
      'google.docs.format_paragraph',
      {
        documentId: 'format-paragraph',
        match: 'target',
        occurrence: 'last',
        style: {
          alignment: 'CENTER',
          lineSpacingPercent: 125,
          namedStyle: 'HEADING_2',
          spaceAbovePt: null,
          spaceBelowPt: 8
        }
      },
      {}
    )
    expect(requests.get('format-paragraph')).toEqual({
      requests: [
        {
          updateParagraphStyle: {
            fields: 'namedStyleType,alignment,lineSpacing,spaceAbove,spaceBelow',
            range: { startIndex: 22, endIndex: 46 },
            paragraphStyle: {
              namedStyleType: 'HEADING_2',
              alignment: 'CENTER',
              lineSpacing: 125,
              spaceBelow: { magnitude: 8, unit: 'PT' }
            }
          }
        }
      ],
      writeControl: { requiredRevisionId: 'format-before' }
    })
    await executeGoogleWorkspaceCommand(
      plugin,
      'google.docs.format_text',
      {
        documentId: 'format-reset',
        match: 'target',
        style: {
          backgroundColor: null,
          bold: null,
          fontFamily: null,
          fontSizePt: null,
          foregroundColor: null,
          italic: null,
          linkUrl: null,
          strikethrough: null,
          underline: null
        }
      },
      {}
    )
    expect(requests.get('format-reset')).toEqual({
      requests: [
        {
          updateTextStyle: {
            fields:
              'bold,italic,underline,strikethrough,weightedFontFamily,fontSize,foregroundColor,backgroundColor,link',
            range: { startIndex: 29, endIndex: 35 },
            textStyle: {}
          }
        }
      ],
      writeControl: { requiredRevisionId: 'format-before' }
    })
    const providerRejectedLink = 'not a provider-accepted link'
    await expect(
      executeGoogleWorkspaceCommand(
        plugin,
        'google.docs.format_text',
        {
          documentId: 'format-provider-rejected-link',
          match: 'target',
          style: { linkUrl: providerRejectedLink }
        },
        {}
      )
    ).resolves.toBeDefined()
    expect(requests.get('format-provider-rejected-link')).toMatchObject({
      requests: [{ updateTextStyle: { textStyle: { link: { url: providerRejectedLink } } } }]
    })
    await expect(
      executeGoogleWorkspaceCommand(
        plugin,
        'google.docs.format_text',
        {
          documentId: 'format-provider-error',
          match: 'target',
          style: { linkUrl: providerRejectedLink }
        },
        {}
      )
    ).rejects.toThrow('Google rejected the supplied link URL.')
    expect(requests.get('format-provider-error')).toMatchObject({
      requests: [{ updateTextStyle: { textStyle: { link: { url: providerRejectedLink } } } }]
    })
    await executeGoogleWorkspaceCommand(
      plugin,
      'google.docs.format_text',
      { documentId: 'format-utf16', match: 'target', style: { bold: true } },
      {}
    )
    expect(requests.get('format-utf16')).toMatchObject({
      requests: [{ updateTextStyle: { range: { startIndex: 29, endIndex: 35 } } }]
    })
    const fetchCount = getCounts.size
    await expect(
      executeGoogleWorkspaceCommand(
        plugin,
        'google.docs.format_text',
        { documentId: 'invalid', match: 'target', style: {} },
        {}
      )
    ).rejects.toThrow('non-empty style')
    await expect(
      executeGoogleWorkspaceCommand(
        plugin,
        'google.docs.format_paragraph',
        { documentId: 'invalid', match: 'target', style: { alignment: 'LEFT' } },
        {}
      )
    ).rejects.toThrow('valid alignment')
    await expect(
      executeGoogleWorkspaceCommand(
        plugin,
        'google.docs.format_text',
        { documentId: 'invalid', match: 'target', style: { foregroundColor: '#ff0000' } },
        {}
      )
    ).rejects.toThrow('canonical #RRGGBB')
    for (const invalidStyle of [
      { fontSizePt: 0 },
      { fontSizePt: -1 },
      { fontSizePt: Number.POSITIVE_INFINITY },
      { extra: true }
    ]) {
      await expect(
        executeGoogleWorkspaceCommand(
          plugin,
          'google.docs.format_text',
          { documentId: 'invalid', match: 'target', style: invalidStyle },
          {}
        )
      ).rejects.toThrow()
    }
    for (const invalidStyle of [
      { lineSpacingPercent: 0 },
      { spaceAbovePt: -1 },
      { spaceBelowPt: Number.NaN }
    ]) {
      await expect(
        executeGoogleWorkspaceCommand(
          plugin,
          'google.docs.format_paragraph',
          { documentId: 'invalid', match: 'target', style: invalidStyle },
          {}
        )
      ).rejects.toThrow('positive number')
    }
    expect(getCounts.size).toBe(fetchCount)
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('Google Docs list commands isolate inserted paragraphs and use native presets', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-google-docs-lists-'))
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const requests = new Map<string, unknown>()
  const events: string[] = []
  const counts = new Map<string, number>()
  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleDocsDocumentsScope, 'openid', 'profile'],
    token: {
      accessToken: 'list-token',
      expiresAt: Date.now() + 3600000,
      idToken: null,
      refreshToken: 'refresh',
      tokenType: 'Bearer'
    },
    updatedAt: Date.now()
  })
  process.env.OPENKHODAM_CONFIG_PATH = configPath
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const id = url.includes(':batchUpdate')
      ? decodeURIComponent(
          new URL(url).pathname.slice('/v1/documents/'.length, -':batchUpdate'.length)
        )
      : readFetchedGoogleDocsDocumentId(url)
    if (url.includes(':batchUpdate')) {
      events.push(`${id}:write`)
      requests.set(id, JSON.parse(init?.body as string))
      return new Response(JSON.stringify({ documentId: id }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const count = (counts.get(id) ?? 0) + 1
    counts.set(id, count)
    events.push(`${id}:get:${count}`)
    return new Response(
      JSON.stringify({
        body: {
          content: [
            {
              startIndex: 1,
              endIndex: 8,
              paragraph: {
                elements: [{ startIndex: 1, endIndex: 8, textRun: { content: 'Intro\n' } }]
              }
            },
            {
              startIndex: 8,
              endIndex: 20,
              paragraph: {
                elements: [{ startIndex: 8, endIndex: 20, textRun: { content: 'target text\n' } }]
              }
            },
            {
              startIndex: 20,
              endIndex: 27,
              paragraph: {
                elements: [{ startIndex: 20, endIndex: 27, textRun: { content: 'Outro\n' } }]
              }
            }
          ]
        },
        documentId: id,
        revisionId: count === 1 ? 'list-before' : 'list-after',
        title: 'Lists'
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }) as typeof fetch
  try {
    const plugin = await loadGoogleWorkspacePlugin()
    await executeGoogleWorkspaceCommand(
      plugin,
      'google.docs.insert_list',
      {
        documentId: 'before',
        items: ['One', 'Two'],
        listType: 'bullet',
        placement: 'before',
        match: 'target',
        occurrence: 'first'
      },
      {}
    )
    await executeGoogleWorkspaceCommand(
      plugin,
      'google.docs.insert_list',
      {
        documentId: 'after',
        items: ['One', 'Two'],
        listType: 'numbered',
        placement: 'after',
        match: 'target',
        occurrence: 'last'
      },
      {}
    )
    await executeGoogleWorkspaceCommand(
      plugin,
      'google.docs.insert_list',
      { documentId: 'end', items: ['Done'], listType: 'checkbox', placement: 'document_end' },
      {}
    )
    await executeGoogleWorkspaceCommand(
      plugin,
      'google.docs.format_list',
      { documentId: 'format', match: 'target', occurrence: 1, listType: 'bullet' },
      {}
    )
    expect(requests.get('before')).toEqual({
      requests: [
        { insertText: { location: { index: 8 }, text: 'One\nTwo\n' } },
        {
          createParagraphBullets: {
            bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
            range: { startIndex: 8, endIndex: 16 }
          }
        }
      ],
      writeControl: { requiredRevisionId: 'list-before' }
    })
    expect(requests.get('after')).toEqual({
      requests: [
        { insertText: { location: { index: 19 }, text: '\nOne\nTwo' } },
        {
          createParagraphBullets: {
            bulletPreset: 'NUMBERED_DECIMAL_ALPHA_ROMAN',
            range: { startIndex: 20, endIndex: 28 }
          }
        }
      ],
      writeControl: { requiredRevisionId: 'list-before' }
    })
    expect(requests.get('end')).toEqual({
      requests: [
        { insertText: { location: { index: 26 }, text: '\nDone' } },
        {
          createParagraphBullets: {
            bulletPreset: 'BULLET_CHECKBOX',
            range: { startIndex: 27, endIndex: 32 }
          }
        }
      ],
      writeControl: { requiredRevisionId: 'list-before' }
    })
    expect(requests.get('format')).toEqual({
      requests: [
        {
          createParagraphBullets: {
            bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
            range: { startIndex: 8, endIndex: 20 }
          }
        }
      ],
      writeControl: { requiredRevisionId: 'list-before' }
    })
    expect(events).toEqual([
      'before:get:1',
      'before:write',
      'before:get:2',
      'after:get:1',
      'after:write',
      'after:get:2',
      'end:get:1',
      'end:write',
      'end:get:2',
      'format:get:1',
      'format:write',
      'format:get:2'
    ])
    const noWriteCount = events.length
    for (const input of [
      {
        documentId: 'invalid',
        items: [],
        listType: 'bullet',
        placement: 'before',
        match: 'target'
      },
      {
        documentId: 'invalid',
        items: ['a\nb'],
        listType: 'bullet',
        placement: 'before',
        match: 'target'
      },
      {
        documentId: 'invalid',
        items: ['\ta'],
        listType: 'bullet',
        placement: 'before',
        match: 'target'
      },
      {
        documentId: 'invalid',
        items: ['a'],
        listType: 'bad',
        placement: 'before',
        match: 'target'
      },
      {
        documentId: 'invalid',
        items: ['a'],
        listType: 'bullet',
        placement: 'document_end',
        match: 'target'
      },
      { documentId: 'invalid', items: ['a'], listType: 'bullet', placement: 'before' }
    ])
      await expect(
        executeGoogleWorkspaceCommand(plugin, 'google.docs.insert_list', input, {})
      ).rejects.toThrow()
    await expect(
      executeGoogleWorkspaceCommand(
        plugin,
        'google.docs.format_list',
        { documentId: 'invalid', match: 'missing', listType: 'bullet', occurrence: 0 },
        {}
      )
    ).rejects.toThrow()
    expect(events).toHaveLength(noWriteCount)
    await expect(
      executeGoogleWorkspaceCommand(
        plugin,
        'google.docs.format_list',
        { documentId: 'unresolved', match: 'missing', listType: 'bullet' },
        {}
      )
    ).rejects.toThrow('could not find')
    expect(events.slice(-1)).toEqual(['unresolved:get:1'])
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('Google Docs insert_table stages native table creation and cell population', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-google-docs-table-'))
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const events: string[] = []
  const writes: unknown[] = []
  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleDocsDocumentsScope, 'openid', 'profile'],
    token: {
      accessToken: 'table-token',
      expiresAt: Date.now() + 3600000,
      idToken: null,
      refreshToken: 'refresh',
      tokenType: 'Bearer'
    },
    updatedAt: Date.now()
  })
  process.env.OPENKHODAM_CONFIG_PATH = configPath
  let getCount = 0
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes(':batchUpdate')) {
      events.push('write')
      writes.push(JSON.parse(init?.body as string))
      return new Response(JSON.stringify({ documentId: 'table-doc' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    getCount += 1
    events.push(`get:${getCount}`)
    const table =
      getCount >= 2
        ? [
            {
              startIndex: 9,
              endIndex: 20,
              table: {
                tableRows: [
                  {
                    tableCells: [
                      {
                        content: [
                          {
                            startIndex: 10,
                            endIndex: 12,
                            paragraph: {
                              elements: [
                                { startIndex: 10, endIndex: 11, textRun: { content: '\n' } }
                              ]
                            }
                          }
                        ]
                      },
                      {
                        content: [
                          {
                            startIndex: 12,
                            endIndex: 14,
                            paragraph: {
                              elements: [
                                { startIndex: 12, endIndex: 13, textRun: { content: '\n' } }
                              ]
                            }
                          }
                        ]
                      }
                    ]
                  },
                  {
                    tableCells: [
                      {
                        content: [
                          {
                            startIndex: 14,
                            endIndex: 16,
                            paragraph: {
                              elements: [
                                { startIndex: 14, endIndex: 15, textRun: { content: '\n' } }
                              ]
                            }
                          }
                        ]
                      },
                      {
                        content: [
                          {
                            startIndex: 16,
                            endIndex: 18,
                            paragraph: {
                              elements: [
                                { startIndex: 16, endIndex: 17, textRun: { content: '\n' } }
                              ]
                            }
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            }
          ]
        : []
    return new Response(
      JSON.stringify({
        body: {
          content: [
            {
              startIndex: 1,
              endIndex: 9,
              paragraph: {
                elements: [{ startIndex: 1, endIndex: 8, textRun: { content: 'target\n' } }]
              }
            },
            ...table,
            ...(getCount >= 3
              ? [
                  {
                    startIndex: 20,
                    endIndex: 31,
                    paragraph: {
                      elements: [
                        { startIndex: 20, endIndex: 31, textRun: { content: 'after table\n' } }
                      ]
                    }
                  }
                ]
              : [])
          ]
        },
        documentId: 'table-doc',
        revisionId: getCount === 1 ? 'before' : getCount === 2 ? 'after-table' : 'after-cells',
        title: 'Table'
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }) as typeof fetch
  try {
    const plugin = await loadGoogleWorkspacePlugin()
    const output = JSON.parse(
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.docs.insert_table',
        {
          documentId: 'table-doc',
          match: 'target',
          occurrence: 'first',
          placement: 'after',
          rows: [
            ['a', ''],
            ['ccc', 'bb']
          ]
        },
        { directory: userDataPath, sessionID: 'table-session' }
      )
    ) as {
      artifactRef: string
      edit: { operation: string; insertedTextLength: number; textLengthDelta: number }
    }
    expect(events).toEqual(['get:1', 'write', 'get:2', 'write', 'get:3'])
    expect(writes).toEqual([
      {
        requests: [{ insertTable: { rows: 2, columns: 2, location: { index: 8 } } }],
        writeControl: { requiredRevisionId: 'before' }
      },
      {
        requests: [
          { insertText: { location: { index: 16 }, text: 'bb' } },
          { insertText: { location: { index: 14 }, text: 'ccc' } },
          { insertText: { location: { index: 10 }, text: 'a' } }
        ],
        writeControl: { requiredRevisionId: 'after-table' }
      }
    ])
    expect(output.edit).toMatchObject({
      operation: 'insert_table',
      insertedTextLength: 6,
      textLengthDelta: 6
    })
    expect(output.artifactRef).toBe(
      `google-docs:v1:${Buffer.from('table-doc', 'utf8').toString('base64url')}`
    )
    const artifact = JSON.parse(
      await readFile(expectedGoogleDocArtifactAbsolutePath(userDataPath, 'table-doc'), 'utf8')
    ) as { body: { blocks: Array<{ ordinal: number; text: string }> } }
    expect(artifact.body.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ordinal: 1,
          text: 'target\n',
          location: { kind: 'body', bodyIndex: 0 }
        }),
        expect.objectContaining({
          ordinal: 2,
          text: '\n',
          location: {
            kind: 'unsupported-table',
            tableIndex: 1,
            reason: 'merged-or-irregular',
            rowIndex: 0,
            columnIndex: 0,
            paragraphIndex: 0
          }
        }),
        expect.objectContaining({
          ordinal: 6,
          text: 'after table\n',
          location: { kind: 'body', bodyIndex: 2 }
        })
      ])
    )
    const offline = JSON.parse(
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.artifacts.read',
        { artifactRef: output.artifactRef },
        { directory: userDataPath }
      )
    ) as {
      coverage: unknown
      returnedBlocks: Array<{ ordinal: number; text: string }>
    }
    expect(offline.coverage).toEqual({
      richText: true,
      lists: true,
      simpleTables: true,
      mergedOrIrregularTables: false,
      unsupportedTableStructures: { present: true, count: 1 },
      images: false,
      firstTabOnly: true
    })
    expect(offline.returnedBlocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'paragraph-1',
          ordinal: 1,
          text: 'target\n',
          type: 'paragraph'
        }),
        expect.objectContaining({
          id: 'paragraph-2',
          ordinal: 2,
          text: '\n',
          type: 'paragraph',
          location: expect.objectContaining({
            kind: 'unsupported-table',
            rowIndex: 0,
            columnIndex: 0
          })
        }),
        expect.objectContaining({
          id: 'paragraph-6',
          ordinal: 6,
          text: 'after table\n',
          type: 'paragraph'
        })
      ])
    )
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('Google Docs insert_table resolves before, after, and document_end table locations', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-google-docs-table-placement-'))
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const reads = new Map<string, number>()
  const writes: Array<{
    body: { requests: Array<{ insertTable?: { location: { index: number } } }> }
    id: string
  }> = []
  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleDocsDocumentsScope, 'openid', 'profile'],
    token: {
      accessToken: 'table-token',
      expiresAt: Date.now() + 3600000,
      idToken: null,
      refreshToken: 'refresh',
      tokenType: 'Bearer'
    },
    updatedAt: Date.now()
  })
  process.env.OPENKHODAM_CONFIG_PATH = configPath
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const id = url.includes(':batchUpdate')
      ? decodeURIComponent(
          new URL(url).pathname.slice('/v1/documents/'.length, -':batchUpdate'.length)
        )
      : readFetchedGoogleDocsDocumentId(url)
    if (url.includes(':batchUpdate')) {
      writes.push({ body: JSON.parse(init?.body as string), id })
      return new Response(JSON.stringify({ documentId: id }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const readCount = (reads.get(id) ?? 0) + 1
    reads.set(id, readCount)
    const expectedTableIndex = id === 'before' ? 2 : 8
    return new Response(
      JSON.stringify({
        body: {
          content: [
            {
              startIndex: 1,
              endIndex: 8,
              paragraph: {
                elements: [{ startIndex: 1, endIndex: 8, textRun: { content: 'target\n' } }]
              }
            },
            ...(readCount >= 2
              ? [
                  {
                    startIndex: expectedTableIndex,
                    endIndex: expectedTableIndex + 3,
                    table: {
                      tableRows: [
                        {
                          tableCells: [
                            {
                              content: [
                                {
                                  startIndex: expectedTableIndex + 1,
                                  endIndex: expectedTableIndex + 2,
                                  paragraph: {
                                    elements: [
                                      {
                                        startIndex: expectedTableIndex + 1,
                                        endIndex: expectedTableIndex + 2,
                                        textRun: { content: '\n' }
                                      }
                                    ]
                                  }
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  }
                ]
              : [])
          ]
        },
        documentId: id,
        revisionId: 'placement',
        title: 'Placement'
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }) as typeof fetch
  try {
    const plugin = await loadGoogleWorkspacePlugin()
    for (const [, input] of [
      ['before', { documentId: 'before', match: 'target', placement: 'before', rows: [['']] }],
      ['after', { documentId: 'after', match: 'target', placement: 'after', rows: [['']] }],
      ['end', { documentId: 'end', placement: 'document_end', rows: [['']] }]
    ] as const)
      await executeGoogleWorkspaceCommand(plugin, 'google.docs.insert_table', input, {})
    expect(writes).toEqual([
      {
        id: 'before',
        body: {
          requests: [{ insertTable: { rows: 1, columns: 1, location: { index: 1 } } }],
          writeControl: { requiredRevisionId: 'placement' }
        }
      },
      {
        id: 'after',
        body: {
          requests: [{ insertTable: { rows: 1, columns: 1, location: { index: 7 } } }],
          writeControl: { requiredRevisionId: 'placement' }
        }
      },
      {
        id: 'end',
        body: {
          requests: [{ insertTable: { rows: 1, columns: 1, location: { index: 7 } } }],
          writeControl: { requiredRevisionId: 'placement' }
        }
      }
    ])
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('Google Docs insert_table skips population for all-empty tables and rejects unsafe inputs before fetch', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-google-docs-table-empty-'))
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const events: string[] = []
  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleDocsDocumentsScope, 'openid', 'profile'],
    token: {
      accessToken: 'table-token',
      expiresAt: Date.now() + 3600000,
      idToken: null,
      refreshToken: 'refresh',
      tokenType: 'Bearer'
    },
    updatedAt: Date.now()
  })
  process.env.OPENKHODAM_CONFIG_PATH = configPath
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes(':batchUpdate')) {
      events.push('write')
      return new Response(JSON.stringify({}), { status: 200 })
    }
    events.push('get')
    const table =
      events.filter((event) => event === 'get').length === 2
        ? [
            {
              startIndex: 8,
              endIndex: 11,
              table: {
                tableRows: [
                  {
                    tableCells: [
                      {
                        content: [
                          {
                            startIndex: 9,
                            endIndex: 10,
                            paragraph: {
                              elements: [
                                { startIndex: 9, endIndex: 10, textRun: { content: '\n' } }
                              ]
                            }
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            }
          ]
        : []
    return new Response(
      JSON.stringify({
        body: {
          content: [
            {
              startIndex: 1,
              endIndex: 8,
              paragraph: {
                elements: [{ startIndex: 1, endIndex: 8, textRun: { content: 'target\n' } }]
              }
            },
            ...table
          ]
        },
        documentId: 'empty',
        revisionId: events.length === 1 ? 'before' : 'after',
        title: 'Empty'
      }),
      { status: 200 }
    )
  }) as typeof fetch
  try {
    const plugin = await loadGoogleWorkspacePlugin()
    await executeGoogleWorkspaceCommand(
      plugin,
      'google.docs.insert_table',
      { documentId: 'empty', placement: 'document_end', rows: [['']] },
      {}
    )
    expect(events).toEqual(['get', 'write', 'get'])
    const baseline = events.length
    const oversizedRows = Array.from({ length: 101 }, () => [''])
    const oversizedColumns = [Array.from({ length: 101 }, () => '')]
    for (const input of [
      { documentId: 'bad', placement: 'document_end', rows: [] },
      { documentId: 'bad', placement: 'document_end', rows: [[]] },
      { documentId: 'bad', placement: 'document_end', rows: [['a'], ['a', 'b']] },
      { documentId: 'bad', placement: 'document_end', rows: [[1]] },
      { documentId: 'bad', placement: 'document_end', rows: [['a\nb']] },
      { documentId: 'bad', placement: 'document_end', rows: oversizedRows },
      { documentId: 'bad', placement: 'document_end', rows: oversizedColumns },
      { documentId: 'bad', placement: 'document_end', rows: [['a'.repeat(2001)]] },
      {
        documentId: 'bad',
        placement: 'document_end',
        rows: [Array.from({ length: 11 }, () => 'a'.repeat(2000))]
      },
      { documentId: 'bad', placement: 'document_end', match: 'target', rows: [['']] },
      { documentId: 'bad', placement: 'before', rows: [['']] },
      { documentId: 'bad', placement: 'invalid', rows: [['']] }
    ])
      await expect(
        executeGoogleWorkspaceCommand(plugin, 'google.docs.insert_table', input, {})
      ).rejects.toThrow()
    expect(events).toHaveLength(baseline)
    await expect(
      executeGoogleWorkspaceCommand(
        plugin,
        'google.docs.insert_table',
        { documentId: 'missing', match: 'missing', placement: 'before', rows: [['']] },
        {}
      )
    ).rejects.toThrow('could not find')
    expect(events).toEqual(['get', 'write', 'get', 'get'])
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('Google Docs insert_table fails after structural reread without population on mismatch', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-google-docs-table-mismatch-'))
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const events: string[] = []
  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleDocsDocumentsScope, 'openid', 'profile'],
    token: {
      accessToken: 'token',
      expiresAt: Date.now() + 3600000,
      idToken: null,
      refreshToken: 'refresh',
      tokenType: 'Bearer'
    },
    updatedAt: Date.now()
  })
  process.env.OPENKHODAM_CONFIG_PATH = configPath
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes(':batchUpdate')) {
      events.push('write')
      return new Response(JSON.stringify({}), { status: 200 })
    }
    events.push('get')
    const content =
      events.length === 2
        ? [
            {
              startIndex: 1,
              endIndex: 8,
              paragraph: {
                elements: [{ startIndex: 1, endIndex: 8, textRun: { content: 'target\n' } }]
              }
            },
            { startIndex: 99, table: { tableRows: [] } }
          ]
        : [
            {
              startIndex: 1,
              endIndex: 8,
              paragraph: {
                elements: [{ startIndex: 1, endIndex: 8, textRun: { content: 'target\n' } }]
              }
            }
          ]
    return new Response(
      JSON.stringify({
        body: { content },
        documentId: 'mismatch',
        revisionId: 'revision',
        title: 'Mismatch'
      }),
      { status: 200 }
    )
  }) as typeof fetch
  try {
    const plugin = await loadGoogleWorkspacePlugin()
    await expect(
      executeGoogleWorkspaceCommand(
        plugin,
        'google.docs.insert_table',
        { documentId: 'mismatch', placement: 'document_end', rows: [['text']] },
        {}
      )
    ).rejects.toThrow('could not locate')
    expect(events).toEqual(['get', 'write', 'get'])
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('executes newly registered Google Workspace commands with strict pre-network validation', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-google-workspace-registry-'))
  const userDataPath = join(tempRoot, 'user-data')
  const projectPath = join(tempRoot, 'project')
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const requests: Array<{ body: unknown; method: string; url: URL }> = []

  await mkdir(projectPath, { recursive: true })
  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: [
      'email',
      googleDriveMetadataReadonlyScope,
      googleDocsDocumentsScope,
      googleSheetsSpreadsheetsWriteScope,
      'openid',
      'profile'
    ],
    token: {
      accessToken: 'registry-access-token',
      expiresAt: Date.now() + 60 * 60 * 1000,
      idToken: null,
      refreshToken: 'refresh-token',
      tokenType: 'Bearer'
    },
    updatedAt: Date.now()
  })
  process.env.OPENKHODAM_CONFIG_PATH = configPath
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    requests.push({ body: init?.body, method: init?.method ?? 'GET', url })
    if (url.hostname === 'www.googleapis.com' && url.pathname === '/drive/v3/files') {
      return new Response(JSON.stringify({ files: [{ id: 'drive-file', name: 'Budget' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    if (url.hostname === 'docs.googleapis.com') {
      const documentId = decodeURIComponent(url.pathname.slice('/v1/documents/'.length))
      return new Response(
        JSON.stringify({
          body: { content: [] },
          documentId,
          revisionId: 'registry-revision',
          title: 'Registry Doc'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }
    if (url.hostname === 'sheets.googleapis.com') {
      const spreadsheetId = decodeURIComponent(url.pathname.split('/')[4] ?? '')
      if (url.pathname.endsWith('/values:batchGet')) {
        return new Response(
          JSON.stringify({
            spreadsheetId,
            valueRanges: [{ majorDimension: 'ROWS', range: 'Sheet1!A1', values: [['value']] }]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      return new Response(
        JSON.stringify({
          properties: { title: 'Registry Sheet' },
          spreadsheetId,
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
          sheets: [{ properties: { index: 0, sheetId: 1, sheetType: 'GRID', title: 'Sheet1' } }]
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
      messageID: 'registry-message',
      sessionID: 'registry-session'
    }
    const execute = plugin.tool.google_workspace_execute_command.execute

    await execute({ command: 'google.drive.search_files', input: { query: 'Budget' } }, context)
    await execute({ command: 'google.docs.read', input: { documentId: 'registry-doc' } }, context)
    await execute(
      { command: 'google.sheets.read', input: { spreadsheetId: 'registry-read' } },
      context
    )
    await execute(
      {
        command: 'google.sheets.set_values',
        input: { range: 'Sheet1!A1', spreadsheetId: 'registry-set', values: [['set']] }
      },
      context
    )
    await execute(
      {
        command: 'google.sheets.append_rows',
        input: { range: 'Sheet1!A1', rows: [[]], spreadsheetId: 'registry-append' }
      },
      context
    )
    await execute(
      {
        command: 'google.sheets.clear_range',
        input: { range: 'Sheet1!A1', spreadsheetId: 'registry-clear' }
      },
      context
    )

    const driveRequest = requests.find((request) => request.url.hostname === 'www.googleapis.com')
    expect(driveRequest?.url.searchParams.get('pageSize')).toBe('10')
    expect(driveRequest?.url.searchParams.get('q')).toContain("name contains 'Budget'")
    expect(
      requests
        .find(
          (request) => request.url.pathname === '/v4/spreadsheets/registry-read/values:batchGet'
        )
        ?.url.searchParams.get('valueRenderOption')
    ).toBe('FORMATTED_VALUE')
    expect(requests.some((request) => request.url.pathname.includes('/registry-set/values/'))).toBe(
      true
    )
    expect(
      requests.some((request) => request.url.pathname.includes('/registry-append/values/'))
    ).toBe(true)
    expect(
      requests.some((request) =>
        request.url.pathname.endsWith('/registry-clear/values/Sheet1%21A1:clear')
      )
    ).toBe(true)
    expect(
      await readFile(expectedGoogleDocArtifactAbsolutePath(projectPath, 'registry-doc'), 'utf8')
    ).toContain('registry-doc')
    expect(await readFile(join(projectPath, '.openkhodam', 'artifacts.json'), 'utf8')).toContain(
      'registry-session'
    )

    const fetchCount = requests.length
    await expect(
      execute(
        {
          command: 'google.sheets.read',
          input: { ranges: ['   '], spreadsheetId: 'invalid-read' }
        },
        context
      )
    ).rejects.toThrow('requires ranges')
    await expect(
      execute(
        {
          command: 'google.sheets.set_values',
          input: { range: 'Sheet1!A1', spreadsheetId: 'invalid-set', values: [] }
        },
        context
      )
    ).rejects.toThrow('requires values')
    await expect(
      execute(
        {
          command: 'google.sheets.append_rows',
          input: { range: 'Sheet1!A1', rows: [], spreadsheetId: 'invalid-append' }
        },
        context
      )
    ).rejects.toThrow('requires rows')
    expect(requests).toHaveLength(fetchCount)
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('rejects unsupported insert_after_text matches before batchUpdate', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-google-docs-edit-unsupported-'))
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const events: string[] = []
  let docsGets = 0

  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleDocsDocumentsScope, 'openid', 'profile'],
    token: {
      accessToken: 'unsupported-access-token',
      expiresAt: Date.now() + 60 * 60 * 1000,
      idToken: null,
      refreshToken: 'refresh-token',
      tokenType: 'Bearer'
    },
    updatedAt: Date.now()
  })
  process.env.OPENKHODAM_CONFIG_PATH = configPath
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)

    if (url.startsWith('https://docs.googleapis.com/v1/documents/doc-mixed-match:batchUpdate')) {
      events.push('batchUpdate')
      throw new Error('Batch update should not be called for an unsupported selected match.')
    }

    if (url.startsWith('https://docs.googleapis.com/v1/documents/doc-mixed-match')) {
      docsGets += 1
      events.push(`documents.get:${docsGets}`)
      return new Response(
        JSON.stringify({
          body: {
            content: [
              {
                startIndex: 1,
                endIndex: 20,
                paragraph: {
                  elements: [
                    { startIndex: 1, endIndex: 20, textRun: { content: 'Intro this is nice\n' } }
                  ]
                }
              },
              {
                startIndex: 20,
                endIndex: 39,
                paragraph: {
                  elements: [{ textRun: { content: 'Again this is nice\n' } }]
                }
              }
            ]
          },
          documentId: 'doc-mixed-match',
          revisionId: 'rev-before-mixed-match',
          title: 'Mixed Match Target'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    throw new Error(`Unexpected fetch URL: ${url}`)
  }) as typeof fetch

  try {
    const plugin = await loadGoogleWorkspacePlugin()
    await expect(
      executeGoogleWorkspaceCommand(
        plugin,
        'google.docs.insert_after_text',
        {
          documentId: 'doc-mixed-match',
          match: 'this is nice',
          text: 'Should not write'
        },
        {}
      )
    ).rejects.toThrow(
      'Google Docs insert_after_text matched text in an unsupported paragraph structure.'
    )
    expect(events).toEqual(['documents.get:1'])
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('logs sanitized Google Docs batchUpdate failures after direct append_text edits', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-google-docs-edit-batch-failure-'))
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const originalWarn = console.warn
  const events: string[] = []
  const warnings: unknown[][] = []
  let batchBody: unknown = null
  let docsGets = 0

  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleDocsDocumentsScope, 'openid', 'profile'],
    token: {
      accessToken: 'conflict-access-token',
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

    if (url.startsWith('https://docs.googleapis.com/v1/documents/doc-conflict:batchUpdate')) {
      events.push('batchUpdate')
      batchBody = typeof init?.body === 'string' ? JSON.parse(init.body) : null
      return new Response(
        JSON.stringify({
          error: {
            code: 409,
            errors: [{ reason: 'failedPrecondition' }],
            message: 'Revision changed.',
            status: 'ABORTED'
          },
          requestBody: 'should-not-log'
        }),
        { status: 409, headers: { 'content-type': 'application/json' } }
      )
    }

    if (url.startsWith('https://docs.googleapis.com/v1/documents/doc-conflict')) {
      docsGets += 1
      events.push(`documents.get:${docsGets}`)
      return new Response(
        JSON.stringify({
          body: {
            content: [
              {
                startIndex: 1,
                endIndex: 15,
                paragraph: {
                  elements: [
                    { startIndex: 1, endIndex: 15, textRun: { content: 'Existing body\n' } }
                  ]
                }
              }
            ]
          },
          documentId: 'doc-conflict',
          revisionId: 'rev-before-conflict',
          title: 'Conflict Target'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    throw new Error(`Unexpected fetch URL: ${url}`)
  }) as typeof fetch

  try {
    const plugin = await loadGoogleWorkspacePlugin()
    await expect(
      executeGoogleWorkspaceCommand(
        plugin,
        'google.docs.append_text',
        {
          documentId: 'doc-conflict',
          text: 'Sensitive inserted text'
        },
        {}
      )
    ).rejects.toThrow(
      'Google Docs documents.batchUpdate failed (HTTP 409, ABORTED, failedPrecondition): Revision changed.'
    )

    expect(events).toEqual(['documents.get:1', 'batchUpdate'])
    expect(batchBody).toEqual({
      requests: [
        {
          insertText: {
            location: { index: 14 },
            text: 'Sensitive inserted text'
          }
        }
      ],
      writeControl: { requiredRevisionId: 'rev-before-conflict' }
    })
    expect(warnings.slice(-2)).toEqual([
      [
        'Google Workspace API request failed',
        {
          code: 'ABORTED',
          message: 'Revision changed.',
          operation: 'Google Docs documents.batchUpdate',
          reason: 'failedPrecondition',
          status: 409
        }
      ]
    ])

    const warningText = JSON.stringify(warnings)
    expect(warningText).not.toContain('conflict-access-token')
    expect(warningText).not.toContain('refresh-token')
    expect(warningText).not.toContain('Sensitive inserted text')
    expect(warningText).not.toContain('should-not-log')
  } finally {
    console.warn = originalWarn
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
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
  const textCapDocumentId = 'doc/text cap?:unsafe'
  const blockCapDocumentId = 'doc-block-cap'
  const noSessionDocumentId = 'doc-no-session'
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
    const docsDocumentId = readFetchedGoogleDocsDocumentId(url)

    if (docsDocumentId === textCapDocumentId) {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer valid-docs-access-token')
      return new Response(
        JSON.stringify({
          body: {
            content: createGoogleDocParagraphs(textCapBlocks)
          },
          documentId: textCapDocumentId,
          revisionId: 'rev-text-cap',
          title: 'Text Cap Doc'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    if (docsDocumentId === blockCapDocumentId) {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer valid-docs-access-token')
      return new Response(
        JSON.stringify({
          body: {
            content: createGoogleDocParagraphs(blockCapBlocks)
          },
          documentId: blockCapDocumentId,
          revisionId: 'rev-block-cap',
          title: 'Block Cap Doc'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    if (docsDocumentId === noSessionDocumentId) {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer valid-docs-access-token')
      return new Response(
        JSON.stringify({
          body: {
            content: createGoogleDocParagraphs(['Preview without session\n'])
          },
          documentId: noSessionDocumentId,
          revisionId: 'rev-no-session',
          title: 'No Session Doc'
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
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.docs.read',
        { documentId: textCapDocumentId },
        context
      )
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
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.docs.read',
        { documentId: blockCapDocumentId },
        context
      )
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

    const noSessionProjectPath = join(tempRoot, 'no-session-project')
    await mkdir(noSessionProjectPath, { recursive: true })
    const noSessionOutput = JSON.parse(
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.docs.read',
        { documentId: noSessionDocumentId },
        { directory: noSessionProjectPath }
      )
    ) as {
      document: Record<string, unknown>
    }
    expect(noSessionOutput.document).toMatchObject({
      id: noSessionDocumentId,
      preview: {
        truncated: false,
        totalTextLength: 23,
        totalBlockCount: 1,
        includedBlockCount: 1
      },
      text: 'Preview without session'
    })
    expect(noSessionOutput.artifactRef).toBe(
      `google-docs:v1:${Buffer.from(noSessionDocumentId).toString('base64url')}`
    )
    expect(noSessionOutput.artifactSync).toMatchObject({
      artifactRef: noSessionOutput.artifactRef,
      linked: false,
      providerRevision: 'rev-no-session',
      status: 'synced'
    })
    const noSessionArtifact = JSON.parse(
      await readFile(
        expectedGoogleDocArtifactAbsolutePath(noSessionProjectPath, noSessionDocumentId),
        'utf8'
      )
    )
    expect(noSessionOutput.artifactSync.cachedAt).toBe(noSessionArtifact.cachedAt)
    const noSessionOffline = JSON.parse(
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.artifacts.read',
        { artifactRef: noSessionOutput.artifactRef },
        { directory: noSessionProjectPath }
      )
    )
    expect(noSessionOffline.returnedBlocks).toMatchObject([{ text: 'Preview without session\n' }])

    const textCapArtifactPath = expectedGoogleDocArtifactAbsolutePath(
      projectPath,
      textCapDocumentId
    )
    const fullTextCapArtifact = JSON.parse(await readFile(textCapArtifactPath, 'utf8')) as {
      body: { blocks: Array<{ text: string }> }
      cachedAt: unknown
      schemaVersion: unknown
      text: string
    }
    expect(fullTextCapArtifact.schemaVersion).toBe(2)
    expect(typeof fullTextCapArtifact.cachedAt).toBe('number')
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
      artifactPath: expectedGoogleDocArtifactPath(textCapDocumentId),
      id: textCapDocumentId,
      title: 'Text Cap Doc',
      url: `https://docs.google.com/document/d/${encodeURIComponent(textCapDocumentId)}/edit`
    })
    const indexedArtifactPath = String(artifacts.sessions['session-1']?.[0]?.artifactPath)
    expect(indexedArtifactPath).not.toContain(textCapDocumentId)
    expect(indexedArtifactPath).not.toContain('text cap')
    expect(indexedArtifactPath).not.toContain('?')
    expect(indexedArtifactPath).not.toContain(':')
    expect(JSON.stringify(artifacts)).not.toContain(textCapBlock)
    await expect(stat(join(fallbackWorktreePath, '.openkhodam'))).rejects.toThrow()
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('persists Google Docs reads and serves complete offline pagination without provider calls', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-google-docs-artifact-read-'))
  const projectPath = join(tempRoot, 'project')
  const configPath = join(tempRoot, 'user-data', 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const documentId = 'offline-doc'
  const blocks = [
    ...Array.from({ length: 25 }, (_, index) => `block-${index + 1}\n`),
    'x'.repeat(17)
  ]
  await mkdir(projectPath, { recursive: true })
  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleDocsDocumentsScope, 'openid', 'profile'],
    token: {
      accessToken: 'offline-access-token',
      expiresAt: Date.now() + 60 * 60 * 1000,
      idToken: null,
      refreshToken: 'refresh-token',
      tokenType: 'Bearer'
    },
    updatedAt: Date.now()
  })
  process.env.OPENKHODAM_CONFIG_PATH = configPath
  let providerCalls = 0
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    providerCalls += 1
    const fetchedId = readFetchedGoogleDocsDocumentId(String(input))
    if (fetchedId !== documentId) throw new Error(`Unexpected fetch URL: ${String(input)}`)
    return new Response(
      JSON.stringify({
        body: { content: createGoogleDocParagraphs(blocks) },
        documentId,
        revisionId: 'offline-rev',
        title: 'Offline'
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }) as typeof fetch
  try {
    const plugin = await loadGoogleWorkspacePlugin()
    const online = JSON.parse(
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.docs.read',
        { documentId },
        { directory: projectPath, sessionID: 'offline-session' }
      )
    ) as {
      artifactRef: string
      document: { preview: { truncated: boolean } }
      nextAction?: { artifactRef: string; command: string; reason: string }
    }
    expect(online.artifactRef).toBe(
      `google-docs:v1:${Buffer.from(documentId, 'utf8').toString('base64url')}`
    )
    expect(online.document.preview.truncated).toBe(true)
    expect(online.nextAction).toEqual({
      artifactRef: online.artifactRef,
      command: 'google.artifacts.read',
      reason: 'The document preview is truncated; read the cached artifact for more content.'
    })
    expect(providerCalls).toBe(1)
    const stored = JSON.parse(
      await readFile(expectedGoogleDocArtifactAbsolutePath(projectPath, documentId), 'utf8')
    ) as { body: { blocks: Array<{ text: string }> }; text: string }
    expect(stored.body.blocks.map((block) => block.text).join('')).toBe(blocks.join(''))
    expect(stored.text).toBe(blocks.join('').trimEnd())

    globalThis.fetch = (async () => {
      providerCalls += 1
      throw new Error('offline read must not fetch')
    }) as typeof fetch

    const artifactRef = online.artifactRef
    let cursor: string | undefined
    let reconstructed = ''
    let pages = 0
    do {
      const page = JSON.parse(
        await executeGoogleWorkspaceCommand(
          plugin,
          'google.artifacts.read',
          { artifactRef, cursor, maxBlocks: 3, maxCharacters: 8 },
          { directory: projectPath }
        )
      ) as {
        coverage: unknown
        nextCursor: string | null
        nextAction?: { artifactRef: string; command: string; cursor: string; reason: string }
        returnedBlocks: Array<{ id: string; ordinal: number; text: string }>
        totalTextLength: number
      }
      expect(page.coverage).toEqual({
        richText: true,
        lists: true,
        simpleTables: true,
        mergedOrIrregularTables: false,
        unsupportedTableStructures: { present: false, count: 0 },
        images: false,
        firstTabOnly: true
      })
      if (page.nextCursor) {
        expect(page.nextAction).toEqual({
          artifactRef,
          command: 'google.artifacts.read',
          cursor: page.nextCursor,
          reason: 'More cached artifact content remains; continue with this cursor.'
        })
      } else {
        expect(page.nextAction).toBeUndefined()
      }
      expect(page.totalTextLength).toBe(
        stored.body.blocks.reduce((total, block) => total + Array.from(block.text).length, 0)
      )
      reconstructed += page.returnedBlocks.map((block) => block.text).join('')
      cursor = page.nextCursor ?? undefined
      pages += 1
    } while (cursor)
    expect(pages).toBeGreaterThan(25)
    expect(reconstructed).toBe(blocks.join(''))
    expect(reconstructed).toBe(stored.body.blocks.map((block) => block.text).join(''))
    expect(Array.from(reconstructed)).toHaveLength(
      stored.body.blocks.reduce((total, block) => total + Array.from(block.text).length, 0)
    )

    const first = JSON.parse(
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.artifacts.read',
        { artifactRef, maxCharacters: 5 },
        { directory: projectPath }
      )
    ) as { nextCursor: string; returnedBlocks: Array<{ text: string }> }
    const second = JSON.parse(
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.artifacts.read',
        { artifactRef, cursor: first.nextCursor, maxCharacters: 5 },
        { directory: projectPath }
      )
    ) as { returnedBlocks: Array<{ text: string }> }
    expect(
      first.returnedBlocks.map((block) => block.text).join('') +
        second.returnedBlocks.map((block) => block.text).join('')
    ).toBe('block-1\nbl')

    await expect(
      executeGoogleWorkspaceCommand(plugin, 'google.artifacts.read', { artifactRef }, {})
    ).rejects.toThrow('requires project context')
    await expect(
      executeGoogleWorkspaceCommand(
        plugin,
        'google.artifacts.read',
        { artifactRef, cursor: 'bad' },
        { directory: projectPath }
      )
    ).rejects.toThrow('cursor is invalid')
    await expect(
      executeGoogleWorkspaceCommand(
        plugin,
        'google.artifacts.read',
        { artifactRef: '../bad' },
        { directory: projectPath }
      )
    ).rejects.toThrow('artifact reference is malformed')
    expect(providerCalls).toBe(1)
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('returns offline artifacts after an existing Google Docs edit command persists the refreshed document', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-google-docs-edit-offline-'))
  const projectPath = join(tempRoot, 'project')
  const configPath = join(tempRoot, 'user-data', 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const documentId = 'edit-offline-doc'
  const events: string[] = []
  await mkdir(projectPath, { recursive: true })
  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleDocsDocumentsScope, 'openid', 'profile'],
    token: {
      accessToken: 'edit-offline-access-token',
      expiresAt: Date.now() + 60 * 60 * 1000,
      idToken: null,
      refreshToken: 'refresh-token',
      tokenType: 'Bearer'
    },
    updatedAt: Date.now()
  })
  process.env.OPENKHODAM_CONFIG_PATH = configPath
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes(':batchUpdate')) {
      events.push('batchUpdate')
      return new Response(JSON.stringify({ documentId }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    if (readFetchedGoogleDocsDocumentId(url) === documentId) {
      events.push('documents.get')
      return new Response(
        JSON.stringify({
          body: {
            content: [
              {
                endIndex: 22,
                paragraph: {
                  elements: [{ endIndex: 22, textRun: { content: 'Persisted after edit\n' } }]
                },
                startIndex: 1
              }
            ]
          },
          documentId,
          revisionId: 'after-edit',
          title: 'Edited offline document'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }
    throw new Error(`Unexpected fetch URL: ${url}`)
  }) as typeof fetch
  try {
    const plugin = await loadGoogleWorkspacePlugin()
    const edited = JSON.parse(
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.docs.append_text',
        { documentId, text: ' Added' },
        { directory: projectPath, sessionID: 'edit-offline-session' }
      )
    ) as {
      artifactRef: string
      document: { preview: { truncated: boolean } }
      nextAction?: { artifactRef: string; command: string; reason: string }
    }
    expect(events).toEqual(['documents.get', 'batchUpdate', 'documents.get'])
    expect(edited.artifactRef).toBe(
      `google-docs:v1:${Buffer.from(documentId, 'utf8').toString('base64url')}`
    )
    expect(edited.document.preview.truncated).toBe(false)
    expect(edited.nextAction).toBeUndefined()

    globalThis.fetch = (async () => {
      throw new Error('offline artifact read must not fetch after edit')
    }) as typeof fetch
    const offline = JSON.parse(
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.artifacts.read',
        { artifactRef: edited.artifactRef },
        { directory: projectPath }
      )
    ) as { returnedBlocks: Array<{ text: string }> }
    expect(offline.returnedBlocks.map((block) => block.text).join('')).toBe(
      'Persisted after edit\n'
    )
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('validates Google Docs offline artifact cursor and cache failure contracts without network access', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-google-docs-offline-errors-'))
  const projectPath = join(tempRoot, 'project')
  const originalFetch = globalThis.fetch
  const { ProjectArtifactsFileStore } = loadDesktopModule<ProjectArtifactsModule>(
    '../../desktop/src/main/integrations/project-artifacts'
  )
  const ref = (id: string) => `google-docs:v1:${Buffer.from(id, 'utf8').toString('base64url')}`
  const validV2 = (id: string, blocks: string[]) => ({
    type: 'google.doc.document' as const,
    id,
    title: id,
    revision: 'rev',
    link: null,
    text: blocks.join('').trimEnd(),
    body: {
      blocks: blocks.map((text, index) => ({
        id: `paragraph-${index + 1}`,
        ordinal: index,
        type: 'paragraph' as const,
        text,
        runs: [{ text, style: {} }],
        location: { kind: 'body' as const, bodyIndex: index }
      }))
    }
  })
  await mkdir(projectPath, { recursive: true })
  const store = new ProjectArtifactsFileStore(projectPath, { now: () => 1234 })
  await store.persistGoogleDocDocumentArtifact(validV2('cursor-doc', ['A😀B', '', 'C']))
  await store.persistGoogleDocDocumentArtifact(validV2('other-doc', ['Other']))
  await store.persistGoogleDocDocumentArtifact(validV2('empty-doc', []))
  globalThis.fetch = (async () => {
    throw new Error('offline success and failure paths must not fetch')
  }) as typeof fetch
  try {
    const plugin = await loadGoogleWorkspacePlugin()
    const first = JSON.parse(
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.artifacts.read',
        { artifactRef: ref('cursor-doc'), maxCharacters: 2 },
        { directory: projectPath }
      )
    ) as { nextCursor: string; returnedBlocks: Array<{ text: string }> }
    expect(first.returnedBlocks.map((block) => block.text).join('')).toBe('A😀')
    const second = JSON.parse(
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.artifacts.read',
        { artifactRef: ref('cursor-doc'), cursor: first.nextCursor, maxCharacters: 2 },
        { directory: projectPath }
      )
    ) as { returnedBlocks: Array<{ id: string; ordinal: number; text: string }> }
    expect(second.returnedBlocks).toEqual([
      {
        id: 'paragraph-1',
        ordinal: 0,
        type: 'paragraph',
        text: 'B',
        runs: [{ text: 'B', style: {} }],
        location: { kind: 'body', bodyIndex: 0 }
      },
      {
        id: 'paragraph-2',
        ordinal: 1,
        type: 'paragraph',
        text: '',
        runs: [],
        location: { kind: 'body', bodyIndex: 1 }
      },
      {
        id: 'paragraph-3',
        ordinal: 2,
        type: 'paragraph',
        text: 'C',
        runs: [{ text: 'C', style: {} }],
        location: { kind: 'body', bodyIndex: 2 }
      }
    ])
    const empty = JSON.parse(
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.artifacts.read',
        { artifactRef: ref('empty-doc') },
        { directory: projectPath }
      )
    ) as { nextCursor: string | null; returnedBlocks: unknown[]; totalTextLength: number }
    expect(empty).toMatchObject({ nextCursor: null, returnedBlocks: [], totalTextLength: 0 })

    const cursor = first.nextCursor
    await expect(
      executeGoogleWorkspaceCommand(
        plugin,
        'google.artifacts.read',
        { artifactRef: ref('other-doc'), cursor },
        { directory: projectPath }
      )
    ).rejects.toThrow('cursor is stale')
    const beforeRefresh = await store.readGoogleDocDocumentArtifact(ref('cursor-doc'))
    await store.persistGoogleDocDocumentArtifact(validV2('cursor-doc', ['Changed']))
    const afterRefresh = await store.readGoogleDocDocumentArtifact(ref('cursor-doc'))
    expect(beforeRefresh.document.cachedAt).toBe(afterRefresh.document.cachedAt)
    expect(beforeRefresh.snapshotId).not.toBe(afterRefresh.snapshotId)
    await expect(
      executeGoogleWorkspaceCommand(
        plugin,
        'google.artifacts.read',
        { artifactRef: ref('cursor-doc'), cursor },
        { directory: projectPath }
      )
    ).rejects.toThrow('cursor is stale')

    for (const decoded of [
      { artifactRef: ref('cursor-doc'), snapshotId: 'x', block: 9, character: 0 },
      { artifactRef: ref('cursor-doc'), snapshotId: 'x', block: 0, character: 7 },
      { artifactRef: ref('cursor-doc'), snapshotId: 'x', block: 0, character: 99 }
    ]) {
      const current = await store.readGoogleDocDocumentArtifact(ref('cursor-doc'))
      decoded.snapshotId = current.snapshotId
      await expect(
        executeGoogleWorkspaceCommand(
          plugin,
          'google.artifacts.read',
          {
            artifactRef: ref('cursor-doc'),
            cursor: Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url')
          },
          { directory: projectPath }
        )
      ).rejects.toThrow('cursor is invalid')
    }

    const cachePath = expectedGoogleDocArtifactAbsolutePath(projectPath, 'cursor-doc')
    const originalPayload = await readFile(cachePath, 'utf8')
    const cases: Array<[string, unknown, RegExp]> = [
      ['corrupt JSON', '{', /cache is corrupt/],
      [
        'unsupported schema',
        { ...JSON.parse(originalPayload), schemaVersion: 3 },
        /unsupported schema/
      ],
      [
        'wrong type',
        { ...JSON.parse(originalPayload), type: 'google.sheet.spreadsheet' },
        /wrong payload type/
      ],
      ...(['title', 'revision', 'link'] as const).flatMap(
        (field) =>
          [
            [
              `missing v2 ${field}`,
              (() => {
                const payload = JSON.parse(originalPayload)
                delete payload[field]
                return payload
              })(),
              /invalid v2 envelope/
            ],
            [
              `object v2 ${field}`,
              { ...JSON.parse(originalPayload), [field]: {} },
              /invalid v2 envelope/
            ]
          ] as Array<[string, unknown, RegExp]>
      ),
      [
        'fractional v2 cachedAt',
        { ...JSON.parse(originalPayload), cachedAt: 1.5 },
        /invalid document ID or body/
      ],
      [
        'negative v2 cachedAt',
        { ...JSON.parse(originalPayload), cachedAt: -1 },
        /invalid document ID or body/
      ],
      ['missing ID', { ...JSON.parse(originalPayload), id: '' }, /invalid document ID or body/],
      [
        'mismatched ID',
        { ...JSON.parse(originalPayload), id: 'different' },
        /reference does not match/
      ],
      [
        'inconsistent text',
        { ...JSON.parse(originalPayload), text: 'wrong' },
        /text is inconsistent/
      ],
      [
        'descending ordinals',
        {
          ...JSON.parse(originalPayload),
          body: {
            blocks: [
              {
                id: 'paragraph-3',
                ordinal: 3,
                type: 'paragraph',
                text: 'A😀B',
                runs: [{ text: 'A😀B', style: {} }],
                location: { kind: 'body', bodyIndex: 0 }
              },
              {
                id: 'paragraph-1',
                ordinal: 1,
                type: 'paragraph',
                text: 'C',
                runs: [{ text: 'C', style: {} }],
                location: { kind: 'body', bodyIndex: 1 }
              }
            ]
          }
        },
        /invalid paragraph block ordering/
      ],
      [
        'duplicate ordinals',
        {
          ...JSON.parse(originalPayload),
          body: {
            blocks: [
              {
                id: 'paragraph-1',
                ordinal: 1,
                type: 'paragraph',
                text: 'A😀B',
                runs: [{ text: 'A😀B', style: {} }],
                location: { kind: 'body', bodyIndex: 0 }
              },
              {
                id: 'paragraph-1b',
                ordinal: 1,
                type: 'paragraph',
                text: 'C',
                runs: [{ text: 'C', style: {} }],
                location: { kind: 'body', bodyIndex: 1 }
              }
            ]
          }
        },
        /invalid paragraph block ordering/
      ],
      [
        'negative ordinal',
        {
          ...JSON.parse(originalPayload),
          body: {
            blocks: [
              {
                id: 'paragraph-negative',
                ordinal: -1,
                type: 'paragraph',
                text: 'A😀BC',
                runs: [{ text: 'A😀BC', style: {} }],
                location: { kind: 'body', bodyIndex: 0 }
              }
            ]
          }
        },
        /invalid paragraph block ordering/
      ],
      [
        'non-integer ordinal',
        {
          ...JSON.parse(originalPayload),
          body: {
            blocks: [
              {
                id: 'paragraph-fraction',
                ordinal: 1.5,
                type: 'paragraph',
                text: 'A😀BC',
                runs: [{ text: 'A😀BC', style: {} }],
                location: { kind: 'body', bodyIndex: 0 }
              }
            ]
          }
        },
        /invalid paragraph block ordering/
      ],
      ...[
        [
          'unknown envelope property',
          (payload: any) => ({ ...payload, unexpected: true }),
          /invalid payload/
        ],
        [
          'unknown body property',
          (payload: any) => ({ ...payload, body: { ...payload.body, unexpected: true } }),
          /invalid body/
        ],
        [
          'unknown block property',
          (payload: any) => ({
            ...payload,
            body: { blocks: [{ ...payload.body.blocks[0], unexpected: true }] }
          }),
          /invalid paragraph block/
        ],
        [
          'runs wrong type',
          (payload: any) => ({
            ...payload,
            body: { blocks: [{ ...payload.body.blocks[0], runs: {} }] }
          }),
          /invalid rich text runs/
        ],
        [
          'unknown run property',
          (payload: any) => ({
            ...payload,
            body: {
              blocks: [
                {
                  ...payload.body.blocks[0],
                  runs: [{ ...payload.body.blocks[0].runs[0], unexpected: true }]
                }
              ]
            }
          }),
          /invalid rich text run/
        ],
        [
          'run text wrong type',
          (payload: any) => ({
            ...payload,
            body: {
              blocks: [
                {
                  ...payload.body.blocks[0],
                  runs: [{ ...payload.body.blocks[0].runs[0], text: 1 }]
                }
              ]
            }
          }),
          /invalid rich text runs/
        ],
        [
          'run text mismatch',
          (payload: any) => ({
            ...payload,
            body: {
              blocks: [
                {
                  ...payload.body.blocks[0],
                  runs: [{ ...payload.body.blocks[0].runs[0], text: 'wrong' }]
                }
              ]
            }
          }),
          /rich text is inconsistent/
        ],
        [
          'run style wrong type',
          (payload: any) => ({
            ...payload,
            body: {
              blocks: [
                {
                  ...payload.body.blocks[0],
                  runs: [{ ...payload.body.blocks[0].runs[0], style: null }]
                }
              ]
            }
          }),
          /invalid rich text runs/
        ],
        [
          'unknown style property',
          (payload: any) => ({
            ...payload,
            body: {
              blocks: [
                {
                  ...payload.body.blocks[0],
                  runs: [{ ...payload.body.blocks[0].runs[0], style: { unexpected: true } }]
                }
              ]
            }
          }),
          /invalid rich text style/
        ],
        [
          'style boolean wrong type',
          (payload: any) => ({
            ...payload,
            body: {
              blocks: [
                {
                  ...payload.body.blocks[0],
                  runs: [{ ...payload.body.blocks[0].runs[0], style: { bold: 'true' } }]
                }
              ]
            }
          }),
          /invalid rich text style/
        ],
        [
          'style link wrong type',
          (payload: any) => ({
            ...payload,
            body: {
              blocks: [
                {
                  ...payload.body.blocks[0],
                  runs: [{ ...payload.body.blocks[0].runs[0], style: { linkUrl: 1 } }]
                }
              ]
            }
          }),
          /invalid rich text style/
        ],
        [
          'style font wrong type',
          (payload: any) => ({
            ...payload,
            body: {
              blocks: [
                {
                  ...payload.body.blocks[0],
                  runs: [{ ...payload.body.blocks[0].runs[0], style: { fontFamily: 1 } }]
                }
              ]
            }
          }),
          /invalid rich text style/
        ],
        [
          'style font size invalid',
          (payload: any) => ({
            ...payload,
            body: {
              blocks: [
                {
                  ...payload.body.blocks[0],
                  runs: [{ ...payload.body.blocks[0].runs[0], style: { fontSizePt: 0 } }]
                }
              ]
            }
          }),
          /invalid rich text style/
        ],
        [
          'style color malformed',
          (payload: any) => ({
            ...payload,
            body: {
              blocks: [
                {
                  ...payload.body.blocks[0],
                  runs: [
                    { ...payload.body.blocks[0].runs[0], style: { foregroundColor: '#abcdef' } }
                  ]
                }
              ]
            }
          }),
          /invalid rich text style/
        ],
        [
          'paragraph style unknown property',
          (payload: any) => ({
            ...payload,
            body: { blocks: [{ ...payload.body.blocks[0], paragraphStyle: { unexpected: true } }] }
          }),
          /invalid paragraph style/
        ],
        [
          'paragraph alignment invalid',
          (payload: any) => ({
            ...payload,
            body: { blocks: [{ ...payload.body.blocks[0], paragraphStyle: { alignment: 'LEFT' } }] }
          }),
          /invalid paragraph style/
        ],
        [
          'paragraph range invalid',
          (payload: any) => ({
            ...payload,
            body: { blocks: [{ ...payload.body.blocks[0], paragraphStyle: { spaceAbovePt: -1 } }] }
          }),
          /invalid paragraph style/
        ],
        [
          'list wrong type',
          (payload: any) => ({
            ...payload,
            body: { blocks: [{ ...payload.body.blocks[0], list: [] }] }
          }),
          /invalid list metadata/
        ],
        [
          'list unknown property',
          (payload: any) => ({
            ...payload,
            body: {
              blocks: [
                {
                  ...payload.body.blocks[0],
                  list: { listId: 'list', nestingLevel: 0, kind: 'bullet', unexpected: true }
                }
              ]
            }
          }),
          /invalid list metadata/
        ],
        [
          'list kind invalid',
          (payload: any) => ({
            ...payload,
            body: {
              blocks: [
                {
                  ...payload.body.blocks[0],
                  list: { listId: 'list', nestingLevel: 0, kind: 'bad' }
                }
              ]
            }
          }),
          /invalid list metadata/
        ],
        [
          'list id invalid',
          (payload: any) => ({
            ...payload,
            body: {
              blocks: [
                { ...payload.body.blocks[0], list: { listId: '', nestingLevel: 0, kind: 'bullet' } }
              ]
            }
          }),
          /invalid list metadata/
        ],
        [
          'list nesting invalid',
          (payload: any) => ({
            ...payload,
            body: {
              blocks: [
                {
                  ...payload.body.blocks[0],
                  list: { listId: 'list', nestingLevel: -1, kind: 'bullet' }
                }
              ]
            }
          }),
          /invalid list metadata/
        ],
        [
          'list glyph invalid',
          (payload: any) => ({
            ...payload,
            body: {
              blocks: [
                {
                  ...payload.body.blocks[0],
                  list: { listId: 'list', nestingLevel: 0, kind: 'bullet', glyphType: 1 }
                }
              ]
            }
          }),
          /invalid list metadata/
        ],
        [
          'location wrong type',
          (payload: any) => ({
            ...payload,
            body: { blocks: [{ ...payload.body.blocks[0], location: null }] }
          }),
          /invalid paragraph location/
        ],
        [
          'location unknown property',
          (payload: any) => ({
            ...payload,
            body: {
              blocks: [
                {
                  ...payload.body.blocks[0],
                  location: { kind: 'body', bodyIndex: 0, unexpected: true }
                }
              ]
            }
          }),
          /invalid paragraph location/
        ],
        [
          'body location invalid offset',
          (payload: any) => ({
            ...payload,
            body: {
              blocks: [{ ...payload.body.blocks[0], location: { kind: 'body', bodyIndex: -1 } }]
            }
          }),
          /invalid paragraph location/
        ],
        [
          'table cell coordinates invalid',
          (payload: any) => ({
            ...payload,
            body: {
              blocks: [
                {
                  ...payload.body.blocks[0],
                  location: {
                    kind: 'table-cell',
                    tableIndex: 0,
                    rowIndex: 1,
                    columnIndex: 0,
                    paragraphIndex: 0,
                    rowCount: 1,
                    columnCount: 1
                  }
                }
              ]
            }
          }),
          /invalid paragraph location/
        ],
        [
          'table cell dimensions invalid',
          (payload: any) => ({
            ...payload,
            body: {
              blocks: [
                {
                  ...payload.body.blocks[0],
                  location: {
                    kind: 'table-cell',
                    tableIndex: 0,
                    rowIndex: 0,
                    columnIndex: 0,
                    paragraphIndex: 0,
                    rowCount: 0,
                    columnCount: 1
                  }
                }
              ]
            }
          }),
          /invalid paragraph location/
        ],
        [
          'unsupported location reason invalid',
          (payload: any) => ({
            ...payload,
            body: {
              blocks: [
                {
                  ...payload.body.blocks[0],
                  location: {
                    kind: 'unsupported-table',
                    tableIndex: 0,
                    reason: 'bad',
                    rowIndex: 0,
                    columnIndex: 0,
                    paragraphIndex: 0
                  }
                }
              ]
            }
          }),
          /invalid paragraph location/
        ],
        [
          'unsupported location offsets invalid',
          (payload: any) => ({
            ...payload,
            body: {
              blocks: [
                {
                  ...payload.body.blocks[0],
                  location: {
                    kind: 'unsupported-table',
                    tableIndex: 0,
                    reason: 'merged-or-irregular',
                    rowIndex: -1,
                    columnIndex: 0,
                    paragraphIndex: 0
                  }
                }
              ]
            }
          }),
          /invalid paragraph location/
        ]
      ].map(([name, mutate, expected]) => [
        name as string,
        (mutate as (payload: any) => unknown)(JSON.parse(originalPayload)),
        expected as RegExp
      ])
    ]
    for (const [, payload, expected] of cases) {
      await writeFile(
        cachePath,
        typeof payload === 'string' ? payload : JSON.stringify(payload),
        'utf8'
      )
      await expect(
        executeGoogleWorkspaceCommand(
          plugin,
          'google.artifacts.read',
          { artifactRef: ref('cursor-doc') },
          { directory: projectPath }
        )
      ).rejects.toThrow(expected)
    }
    await writeFile(cachePath, originalPayload, 'utf8')
    await rm(cachePath)
    await expect(
      executeGoogleWorkspaceCommand(
        plugin,
        'google.artifacts.read',
        { artifactRef: ref('cursor-doc') },
        { directory: projectPath }
      )
    ).rejects.toThrow('cache is missing')
  } finally {
    globalThis.fetch = originalFetch
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('reads persisted schema v1 Google Docs artifacts with limited truthful coverage', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-google-docs-v1-artifact-'))
  const projectPath = join(tempRoot, 'project')
  const documentId = 'legacy-doc'
  const artifactRef = `google-docs:v1:${Buffer.from(documentId, 'utf8').toString('base64url')}`
  await mkdir(projectPath, { recursive: true })
  const { ProjectArtifactsFileStore } = loadDesktopModule<ProjectArtifactsModule>(
    '../../desktop/src/main/integrations/project-artifacts'
  )
  const store = new ProjectArtifactsFileStore(projectPath)
  await store.persistGoogleDocDocumentArtifact({
    type: 'google.doc.document',
    id: documentId,
    title: 'Legacy',
    revision: 'legacy-rev',
    link: null,
    text: 'Legacy text',
    body: { blocks: [{ id: 'paragraph-1', ordinal: 1, type: 'paragraph', text: 'Legacy text' }] }
  })
  const cachePath = expectedGoogleDocArtifactAbsolutePath(projectPath, documentId)
  const persisted = JSON.parse(await readFile(cachePath, 'utf8'))
  persisted.schemaVersion = 1
  persisted.cachedAt = 1.5
  persisted.title = { legacy: true }
  persisted.revision = false
  persisted.link = []
  delete persisted.body.blocks[0].runs
  delete persisted.body.blocks[0].location
  await writeFile(cachePath, JSON.stringify(persisted), 'utf8')
  try {
    const plugin = await loadGoogleWorkspacePlugin()
    const result = JSON.parse(
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.artifacts.read',
        { artifactRef },
        { directory: projectPath }
      )
    ) as { coverage: unknown; returnedBlocks: Array<{ text: string }> }
    expect(result.coverage).toEqual({
      richText: false,
      lists: false,
      simpleTables: false,
      mergedOrIrregularTables: false,
      unsupportedTableStructures: { present: false, count: 0 },
      images: false,
      firstTabOnly: true
    })
    expect(result.returnedBlocks).toEqual([
      { id: 'paragraph-1', ordinal: 1, type: 'paragraph', text: 'Legacy text' }
    ])
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('preserves rich Google Docs semantic blocks and Unicode-styled pagination fragments', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-google-docs-rich-artifact-'))
  const projectPath = join(tempRoot, 'project')
  const documentId = 'rich-doc'
  const artifactRef = `google-docs:v1:${Buffer.from(documentId, 'utf8').toString('base64url')}`
  await mkdir(projectPath, { recursive: true })
  const { ProjectArtifactsFileStore } = loadDesktopModule<ProjectArtifactsModule>(
    '../../desktop/src/main/integrations/project-artifacts'
  )
  const blocks = [
    {
      id: 'paragraph-1',
      ordinal: 1,
      type: 'paragraph' as const,
      text: 'A😀BC\n',
      runs: [
        {
          text: 'A😀',
          style: {
            bold: true,
            italic: true,
            underline: true,
            strikethrough: true,
            fontFamily: 'Arial',
            fontSizePt: 12,
            foregroundColor: '#112233',
            backgroundColor: '#445566',
            linkUrl: 'https://example.com'
          }
        },
        { text: 'BC\n', style: {} }
      ],
      paragraphStyle: {
        namedStyle: 'HEADING_1',
        alignment: 'CENTER',
        lineSpacingPercent: 120,
        spaceAbovePt: 8,
        spaceBelowPt: 6
      },
      location: { kind: 'body' as const, bodyIndex: 0 }
    },
    {
      id: 'paragraph-2',
      ordinal: 2,
      type: 'paragraph' as const,
      text: 'Nested\n',
      runs: [{ text: 'Nested\n', style: {} }],
      list: {
        listId: 'bullet-list',
        nestingLevel: 1,
        kind: 'bullet' as const,
        glyphSymbol: '•'
      },
      location: { kind: 'body' as const, bodyIndex: 1 }
    },
    {
      id: 'paragraph-3',
      ordinal: 3,
      type: 'paragraph' as const,
      text: 'Cell\n',
      runs: [{ text: 'Cell\n', style: {} }],
      list: {
        listId: 'unknown-list',
        nestingLevel: 0,
        kind: 'unknown' as const,
        glyphType: 'UNSUPPORTED',
        glyphSymbol: '¤'
      },
      location: {
        kind: 'table-cell' as const,
        tableIndex: 2,
        rowIndex: 0,
        columnIndex: 1,
        paragraphIndex: 0,
        rowCount: 1,
        columnCount: 2
      }
    }
  ]
  const store = new ProjectArtifactsFileStore(projectPath)
  await store.persistGoogleDocDocumentArtifact({
    type: 'google.doc.document',
    id: documentId,
    title: 'Rich',
    revision: 'rich-rev',
    link: null,
    text: blocks
      .map((block) => block.text)
      .join('')
      .trimEnd(),
    body: { blocks }
  })
  const persisted = JSON.parse(
    await readFile(expectedGoogleDocArtifactAbsolutePath(projectPath, documentId), 'utf8')
  )
  expect(persisted.schemaVersion).toBe(2)
  expect(persisted.body.blocks).toEqual(blocks)
  try {
    const plugin = await loadGoogleWorkspacePlugin()
    let cursor: string | undefined
    const returned: typeof blocks = []
    do {
      const page = JSON.parse(
        await executeGoogleWorkspaceCommand(
          plugin,
          'google.artifacts.read',
          { artifactRef, cursor, maxBlocks: 1, maxCharacters: 2 },
          { directory: projectPath }
        )
      ) as { nextCursor: string | null; returnedBlocks: typeof blocks }
      returned.push(...page.returnedBlocks)
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    expect(returned.map((block) => block.text).join('')).toBe(
      blocks.map((block) => block.text).join('')
    )
    expect(
      returned
        .flatMap((block) => block.runs ?? [])
        .map((run) => run.text)
        .join('')
    ).toBe(
      blocks
        .flatMap((block) => block.runs)
        .map((run) => run.text)
        .join('')
    )
    expect(returned[0]).toMatchObject({
      text: 'A😀',
      runs: [{ text: 'A😀', style: blocks[0].runs[0].style }]
    })
    expect(returned).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ list: blocks[1].list }),
        expect.objectContaining({ list: blocks[2].list, location: blocks[2].location })
      ])
    )
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('normalizes provider-shaped rich Docs responses through persisted offline artifacts', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-provider-rich-docs-'))
  const userDataPath = join(tempRoot, 'user-data')
  const projectPath = join(tempRoot, 'project')
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const documentId = 'provider-rich-doc'
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  let fields: string | null = null
  await mkdir(projectPath, { recursive: true })
  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleDocsDocumentsScope, 'openid', 'profile'],
    token: {
      accessToken: 'provider-rich-access-token',
      expiresAt: Date.now() + 60 * 60 * 1000,
      idToken: null,
      refreshToken: 'refresh-token',
      tokenType: 'Bearer'
    },
    updatedAt: Date.now()
  })
  process.env.OPENKHODAM_CONFIG_PATH = configPath
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    fields = url.searchParams.get('fields')
    expect(new Headers(init?.headers).get('authorization')).toBe(
      'Bearer provider-rich-access-token'
    )
    return new Response(
      JSON.stringify({
        documentId,
        title: 'Provider rich document',
        revisionId: 'provider-rich-rev',
        lists: {
          bullet: {
            listProperties: { nestingLevels: [{ glyphType: 'BULLET', glyphSymbol: '•' }] }
          },
          numbered: {
            listProperties: { nestingLevels: [{ glyphType: 'DECIMAL', glyphSymbol: '%0.' }] }
          },
          checkbox: {
            listProperties: { nestingLevels: [{ glyphType: 'BULLET', glyphSymbol: '❏' }] }
          },
          unknown: { listProperties: { nestingLevels: [{ glyphType: 'CUSTOM', glyphSymbol: '' }] } }
        },
        body: {
          content: [
            {
              paragraph: {
                bullet: { listId: 'bullet', nestingLevel: 0 },
                paragraphStyle: {
                  namedStyleType: 'HEADING_1',
                  alignment: 'CENTER',
                  lineSpacing: 120,
                  spaceAbove: { magnitude: 0, unit: 'PT' },
                  spaceBelow: { magnitude: 0, unit: 'PT' }
                },
                elements: [
                  {
                    textRun: {
                      content: 'Styled\n',
                      textStyle: {
                        bold: true,
                        italic: false,
                        underline: true,
                        strikethrough: false,
                        weightedFontFamily: { fontFamily: 'Arial' },
                        fontSize: { magnitude: 12, unit: 'PT' },
                        foregroundColor: { color: { rgbColor: { red: 1 } } },
                        backgroundColor: { color: { rgbColor: {} } },
                        link: { url: 'https://example.test/' }
                      }
                    }
                  }
                ]
              }
            },
            ...['numbered', 'checkbox', 'unknown'].map((listId) => ({
              paragraph: {
                bullet: { listId, nestingLevel: 0 },
                elements: [{ textRun: { content: `${listId}\n` } }]
              }
            })),
            {
              table: {
                rows: 1,
                columns: 2,
                tableRows: [
                  {
                    tableCells: [
                      {
                        tableCellStyle: { rowSpan: 1, columnSpan: 1 },
                        content: [{ paragraph: { elements: [{ textRun: { content: 'A\n' } }] } }]
                      },
                      {
                        tableCellStyle: { rowSpan: 1, columnSpan: 1 },
                        content: [{ paragraph: { elements: [{ textRun: { content: 'B\n' } }] } }]
                      }
                    ]
                  }
                ]
              }
            },
            {
              table: {
                rows: 1,
                columns: 2,
                tableRows: [
                  {
                    tableCells: [
                      {
                        tableCellStyle: { rowSpan: 1, columnSpan: 2 },
                        content: [
                          { paragraph: { elements: [{ textRun: { content: 'Merged\n' } }] } }
                        ]
                      }
                    ]
                  }
                ]
              }
            }
          ]
        }
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }) as typeof fetch
  try {
    const plugin = await loadGoogleWorkspacePlugin()
    const online = JSON.parse(
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.docs.read',
        { documentId },
        { directory: projectPath }
      )
    ) as { artifactRef: string; document: { body: { blocks: Array<Record<string, unknown>> } } }
    expect(fields).toContain('rows,columns,tableRows(tableCells(tableCellStyle(rowSpan,columnSpan)')
    expect(fields).toContain(
      'textStyle(bold,italic,underline,strikethrough,weightedFontFamily,fontSize,foregroundColor,backgroundColor,link)'
    )
    expect(fields).toContain(
      'paragraphStyle(namedStyleType,alignment,lineSpacing,spaceAbove,spaceBelow)'
    )
    expect(fields).toContain('bullet(listId,nestingLevel)')
    expect(fields).toContain('lists(listProperties(nestingLevels(glyphType,glyphSymbol)))')
    expect(online.document.body.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: 'Styled\n',
          runs: [
            {
              text: 'Styled\n',
              style: expect.objectContaining({
                bold: true,
                italic: false,
                strikethrough: false,
                foregroundColor: '#FF0000',
                backgroundColor: '#000000',
                linkUrl: 'https://example.test/'
              })
            }
          ],
          paragraphStyle: expect.objectContaining({ spaceAbovePt: 0, spaceBelowPt: 0 })
        }),
        expect.objectContaining({
          text: 'numbered\n',
          list: expect.objectContaining({ kind: 'numbered' })
        }),
        expect.objectContaining({
          text: 'checkbox\n',
          list: expect.objectContaining({ kind: 'checkbox' })
        }),
        expect.objectContaining({
          text: 'unknown\n',
          list: expect.objectContaining({ kind: 'unknown' })
        }),
        expect.objectContaining({
          text: 'A\n',
          location: {
            kind: 'table-cell',
            tableIndex: 4,
            rowIndex: 0,
            columnIndex: 0,
            paragraphIndex: 0,
            rowCount: 1,
            columnCount: 2
          }
        }),
        expect.objectContaining({
          text: 'B\n',
          location: {
            kind: 'table-cell',
            tableIndex: 4,
            rowIndex: 0,
            columnIndex: 1,
            paragraphIndex: 0,
            rowCount: 1,
            columnCount: 2
          }
        }),
        expect.objectContaining({
          text: 'Merged\n',
          location: {
            kind: 'unsupported-table',
            tableIndex: 5,
            reason: 'merged-or-irregular',
            rowIndex: 0,
            columnIndex: 0,
            paragraphIndex: 0
          }
        })
      ])
    )
    const persisted = JSON.parse(
      await readFile(expectedGoogleDocArtifactAbsolutePath(projectPath, documentId), 'utf8')
    )
    expect(persisted.schemaVersion).toBe(2)
    const offline = JSON.parse(
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.artifacts.read',
        { artifactRef: online.artifactRef, maxBlocks: 100 },
        { directory: projectPath }
      )
    ) as {
      coverage: { unsupportedTableStructures: { count: number; present: boolean } }
      returnedBlocks: Array<Record<string, unknown>>
    }
    expect(offline.coverage.unsupportedTableStructures).toEqual({ present: true, count: 1 })
    expect(offline.returnedBlocks).toEqual(online.document.body.blocks)
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('rejects symlinked Google Docs artifact cache paths during offline reads', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-google-docs-offline-symlink-'))
  const projectPath = join(tempRoot, 'project')
  const outsidePath = join(tempRoot, 'outside')
  const originalFetch = globalThis.fetch
  const { ProjectArtifactsFileStore } = loadDesktopModule<ProjectArtifactsModule>(
    '../../desktop/src/main/integrations/project-artifacts'
  )
  const documentId = 'symlink-doc'
  const artifactRef = `google-docs:v1:${Buffer.from(documentId, 'utf8').toString('base64url')}`
  await mkdir(projectPath, { recursive: true })
  await mkdir(outsidePath, { recursive: true })
  const store = new ProjectArtifactsFileStore(projectPath)
  await store.persistGoogleDocDocumentArtifact({
    type: 'google.doc.document',
    id: documentId,
    title: 'Symlink test',
    revision: 'rev',
    link: null,
    text: 'outside secret',
    body: {
      blocks: [{ id: 'body-block-1', ordinal: 0, type: 'paragraph', text: 'outside secret' }]
    }
  })
  const artifactPath = expectedGoogleDocArtifactAbsolutePath(projectPath, documentId)
  const outsideArtifactPath = join(outsidePath, 'artifact.json')
  await writeFile(outsideArtifactPath, await readFile(artifactPath, 'utf8'), 'utf8')
  await rm(artifactPath)
  await symlink(outsideArtifactPath, artifactPath, 'file')
  globalThis.fetch = (async () => {
    throw new Error('offline symlink rejection must not fetch')
  }) as typeof fetch
  try {
    const plugin = await loadGoogleWorkspacePlugin()
    await expect(
      executeGoogleWorkspaceCommand(
        plugin,
        'google.artifacts.read',
        { artifactRef },
        { directory: projectPath }
      )
    ).rejects.toThrow(/must not be a symlink/)
    await expect(readFile(outsideArtifactPath, 'utf8')).resolves.toContain('outside secret')
  } finally {
    globalThis.fetch = originalFetch
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
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.docs.read',
        { documentId: 'doc-1' },
        context
      )
    ) as {
      artifactRef: string
      artifactSync: Record<string, unknown>
      document: Record<string, unknown>
    }
    expect(firstOutput.artifactRef).toBe(
      `google-docs:v1:${Buffer.from('doc-1').toString('base64url')}`
    )
    expect(firstOutput.artifactSync).toMatchObject({
      artifactRef: firstOutput.artifactRef,
      linked: true,
      providerRevision: 'rev-1',
      status: 'synced'
    })
    expect(firstOutput.document).toMatchObject({
      id: 'doc-1',
      link: 'https://docs.google.com/document/d/doc-1/edit',
      title: 'Docs Plan',
      type: 'google.doc.document'
    })

    const artifactsPath = join(projectPath, '.openkhodam', 'artifacts.json')
    const fullArtifactPath = expectedGoogleDocArtifactAbsolutePath(projectPath, 'doc-1')
    const artifactContents = await readFile(artifactsPath, 'utf8')
    const artifacts = JSON.parse(artifactContents) as {
      sessions: Record<string, Array<Record<string, unknown>>>
    }
    expect(artifacts.sessions['session-1']).toHaveLength(1)
    expect(artifacts.sessions['session-1']?.[0]).toMatchObject({
      artifactPath: expectedGoogleDocArtifactPath('doc-1'),
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
      schemaVersion: 2,
      text: 'Hello Docs 1',
      title: 'Docs Plan'
    })
    expect(firstOutput.artifactSync.cachedAt).toBe(
      JSON.parse(await readFile(fullArtifactPath, 'utf8')).cachedAt
    )

    const secondOutput = JSON.parse(
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.docs.read',
        { documentId: 'doc-1' },
        context
      )
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
      schemaVersion: 2,
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

test('records tool-call message provenance for linked Google Docs and Sheets artifacts', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-google-workspace-provenance-'))
  const userDataPath = join(tempRoot, 'user-data')
  const projectPath = join(tempRoot, 'project')
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const documentId = 'provenance-doc'
  const spreadsheetId = 'provenance-sheet'
  const encodedSpreadsheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`
  let docsCalls = 0
  let sheetMetadataCalls = 0
  let sheetValuesCalls = 0

  await mkdir(projectPath, { recursive: true })
  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleDocsDocumentsScope, googleSheetsSpreadsheetsScope, 'openid', 'profile'],
    token: {
      accessToken: 'provenance-access-token',
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

    if (url.startsWith(`https://docs.googleapis.com/v1/documents/${documentId}`)) {
      docsCalls += 1
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer provenance-access-token')
      return new Response(
        JSON.stringify({
          body: {
            content: createGoogleDocParagraphs([`Provenance Docs ${docsCalls}\n`])
          },
          documentId,
          revisionId: `doc-rev-${docsCalls}`,
          title: `Provenance Doc ${docsCalls}`
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    if (url.startsWith(`${encodedSpreadsheetUrl}/values:batchGet`)) {
      sheetValuesCalls += 1
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer provenance-access-token')
      return new Response(
        JSON.stringify({
          spreadsheetId,
          valueRanges: [
            {
              range: 'Summary!A1:B2',
              majorDimension: 'ROWS',
              values: [['Run', sheetValuesCalls]]
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    if (url.startsWith(encodedSpreadsheetUrl)) {
      sheetMetadataCalls += 1
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer provenance-access-token')
      return new Response(
        JSON.stringify({
          spreadsheetId,
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`,
          properties: { title: `Provenance Sheet ${sheetMetadataCalls}` },
          sheets: [
            {
              properties: {
                sheetId: 1,
                title: 'Summary',
                index: 0,
                sheetType: 'GRID',
                gridProperties: { rowCount: 10, columnCount: 2 }
              }
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
    const firstContext = {
      directory: projectPath,
      messageID: 'assistant-message-1',
      sessionID: 'session-provenance'
    }
    const secondContext = {
      ...firstContext,
      messageID: 'assistant-message-2'
    }

    await executeGoogleWorkspaceCommand(plugin, 'google.docs.read', { documentId }, firstContext)
    await executeGoogleWorkspaceCommand(
      plugin,
      'google.sheets.read',
      { spreadsheetId, ranges: ['Summary!A1:B2'] },
      firstContext
    )
    await executeGoogleWorkspaceCommand(plugin, 'google.docs.read', { documentId }, secondContext)
    await executeGoogleWorkspaceCommand(
      plugin,
      'google.sheets.read',
      { spreadsheetId, ranges: ['Summary!A1:B2'] },
      secondContext
    )

    expect(docsCalls).toBe(2)
    expect(sheetMetadataCalls).toBe(2)
    expect(sheetValuesCalls).toBe(2)

    const artifacts = JSON.parse(
      await readFile(join(projectPath, '.openkhodam', 'artifacts.json'), 'utf8')
    ) as {
      sessions: Record<string, Array<Record<string, unknown>>>
    }
    const sessionArtifacts = artifacts.sessions['session-provenance'] ?? []
    expect(sessionArtifacts).toHaveLength(2)
    expect(
      sessionArtifacts.find(
        (artifact) => artifact.id === documentId && artifact.type === 'google.doc.document'
      )
    ).toMatchObject({
      artifactPath: expectedGoogleDocArtifactPath(documentId),
      firstMessageId: 'assistant-message-1',
      id: documentId,
      lastMessageId: 'assistant-message-2',
      listed: true,
      title: 'Provenance Doc 2',
      url: `https://docs.google.com/document/d/${documentId}/edit`
    })
    expect(
      sessionArtifacts.find(
        (artifact) => artifact.id === spreadsheetId && artifact.type === 'google.sheet.spreadsheet'
      )
    ).toMatchObject({
      artifactPath: expectedGoogleSheetArtifactPath(spreadsheetId),
      firstMessageId: 'assistant-message-1',
      id: spreadsheetId,
      lastMessageId: 'assistant-message-2',
      listed: true,
      title: 'Provenance Sheet 2',
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
    })
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('retains full Google Doc artifacts when session index recording fails', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-google-docs-index-failure-'))
  const userDataPath = join(tempRoot, 'user-data')
  const projectPath = join(tempRoot, 'project-path-should-not-log')
  const openKhodamPath = join(projectPath, '.openkhodam')
  const googleDocsArtifactDirectory = join(openKhodamPath, 'artifacts', 'google-docs')
  const artifactsPath = join(openKhodamPath, 'artifacts.json')
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const originalWarn = console.warn
  const warnings: unknown[][] = []

  await mkdir(googleDocsArtifactDirectory, { recursive: true })
  await writeFile(artifactsPath, '{\n  "version": 1,\n  "sessions": {}\n}\n', 'utf8')
  await chmod(openKhodamPath, 0o555)
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

    if (url.startsWith('https://docs.googleapis.com/v1/documents/doc-index-failure')) {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer valid-docs-access-token')
      return new Response(
        JSON.stringify({
          body: {
            content: createGoogleDocParagraphs(['Cleanup me\n'])
          },
          documentId: 'doc-index-failure',
          revisionId: 'rev-index-failure',
          title: 'Index Failure Doc'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    throw new Error(`Unexpected fetch URL: ${url}`)
  }) as typeof fetch

  try {
    const plugin = await loadGoogleWorkspacePlugin()
    const output = JSON.parse(
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.docs.read',
        { documentId: 'doc-index-failure' },
        { directory: projectPath, sessionID: 'session-1' }
      )
    ) as {
      artifactRef: string | null
      artifactSync: Record<string, unknown>
      document: Record<string, unknown>
    }

    expect(output.document).toMatchObject({
      id: 'doc-index-failure',
      preview: {
        truncated: false,
        totalTextLength: 10,
        totalBlockCount: 1,
        includedBlockCount: 1
      },
      text: 'Cleanup me',
      title: 'Index Failure Doc',
      type: 'google.doc.document'
    })
    expect(warnings).toEqual([
      [
        'Failed to record linked Google Doc artifact',
        {
          docId: 'doc-index-failure',
          reason: 'artifact_record_failed',
          sessionId: 'session-1'
        }
      ]
    ])

    const warningText = JSON.stringify(warnings)
    expect(warningText).not.toContain('valid-docs-access-token')
    expect(warningText).not.toContain('refresh-token')
    expect(warningText).not.toContain('Cleanup me')
    expect(warningText).not.toContain('EACCES')
    expect(warningText).not.toContain(tempRoot)
    expect(warningText).not.toContain(projectPath)
    expect(output.artifactRef).toBe(
      `google-docs:v1:${Buffer.from('doc-index-failure').toString('base64url')}`
    )
    expect(output.artifactSync).toMatchObject({
      artifactRef: output.artifactRef,
      linked: false,
      providerRevision: 'rev-index-failure',
      status: 'synced'
    })
    const artifactPath = expectedGoogleDocArtifactAbsolutePath(projectPath, 'doc-index-failure')
    await expect(stat(artifactPath)).resolves.toBeTruthy()
    expect(JSON.parse(await readFile(artifactPath, 'utf8'))).toMatchObject({
      id: 'doc-index-failure',
      text: 'Cleanup me'
    })
    await expect(readFile(artifactsPath, 'utf8')).resolves.toBe(
      '{\n  "version": 1,\n  "sessions": {}\n}\n'
    )
  } finally {
    console.warn = originalWarn
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await chmod(openKhodamPath, 0o755).catch(() => undefined)
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('retains Google Sheet artifacts when session index recording fails', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-google-sheets-index-failure-'))
  const userDataPath = join(tempRoot, 'user-data')
  const projectPath = join(tempRoot, 'project-path-should-not-log')
  const openKhodamPath = join(projectPath, '.openkhodam')
  const googleSheetsArtifactDirectory = join(openKhodamPath, 'artifacts', 'google-sheets')
  const artifactsPath = join(openKhodamPath, 'artifacts.json')
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const existingSpreadsheetId = 'sheet-existing-index-failure'
  const createdSpreadsheetId = 'sheet-created-index-failure'
  const existingArtifactPath = expectedGoogleSheetArtifactAbsolutePath(
    projectPath,
    existingSpreadsheetId
  )
  const createdArtifactPath = expectedGoogleSheetArtifactAbsolutePath(
    projectPath,
    createdSpreadsheetId
  )
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const originalWarn = console.warn
  const warnings: unknown[][] = []

  await mkdir(googleSheetsArtifactDirectory, { recursive: true })
  await writeFile(artifactsPath, '{\n  "version": 1,\n  "sessions": {}\n}\n', 'utf8')
  await writeFile(
    existingArtifactPath,
    `${JSON.stringify(
      {
        type: 'google.sheet.spreadsheet',
        id: existingSpreadsheetId,
        title: 'Preexisting Sheet Artifact',
        link: `https://docs.google.com/spreadsheets/d/${existingSpreadsheetId}/edit`,
        sheets: [],
        ranges: [],
        schemaVersion: 1,
        cachedAt: 1
      },
      null,
      2
    )}\n`,
    'utf8'
  )
  await chmod(openKhodamPath, 0o555)
  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleSheetsSpreadsheetsScope, 'openid', 'profile'],
    token: {
      accessToken: 'valid-sheets-access-token',
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
    const fetchedSheet = readFetchedGoogleSheetsSpreadsheet(url)
    if (!fetchedSheet) throw new Error(`Unexpected fetch URL: ${url}`)

    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer valid-sheets-access-token')

    if (fetchedSheet.values) {
      return new Response(
        JSON.stringify({
          spreadsheetId: fetchedSheet.spreadsheetId,
          valueRanges: [
            {
              range: 'Summary!A1:A1',
              majorDimension: 'ROWS',
              values: [[`sensitive cell ${fetchedSheet.spreadsheetId}`]]
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        spreadsheetId: fetchedSheet.spreadsheetId,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${fetchedSheet.spreadsheetId}/edit`,
        properties: { title: `Sheet ${fetchedSheet.spreadsheetId}` },
        sheets: [
          {
            properties: {
              sheetId: 1,
              title: 'Summary',
              index: 0,
              sheetType: 'GRID',
              gridProperties: { rowCount: 1, columnCount: 1 }
            }
          }
        ]
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }) as typeof fetch

  try {
    const plugin = await loadGoogleWorkspacePlugin()
    const context = { directory: projectPath, sessionID: 'session-1' }

    const existingOutput = JSON.parse(
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.sheets.read',
        { spreadsheetId: existingSpreadsheetId, ranges: ['Summary!A1:A1'] },
        context
      )
    ) as {
      spreadsheet: Record<string, unknown>
    }
    expect(existingOutput.spreadsheet).toMatchObject({
      id: existingSpreadsheetId,
      title: `Sheet ${existingSpreadsheetId}`,
      type: 'google.sheet.spreadsheet'
    })
    await expect(stat(existingArtifactPath)).resolves.toMatchObject({})
    expect(JSON.parse(await readFile(existingArtifactPath, 'utf8'))).toMatchObject({
      id: existingSpreadsheetId,
      schemaVersion: 1,
      title: `Sheet ${existingSpreadsheetId}`
    })

    const createdOutput = JSON.parse(
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.sheets.read',
        { spreadsheetId: createdSpreadsheetId, ranges: ['Summary!A1:A1'] },
        context
      )
    ) as {
      spreadsheet: Record<string, unknown>
    }
    expect(createdOutput.spreadsheet).toMatchObject({
      id: createdSpreadsheetId,
      title: `Sheet ${createdSpreadsheetId}`,
      type: 'google.sheet.spreadsheet'
    })

    const artifactRecordWarnings = warnings.filter(
      (warning): warning is [string, Record<string, unknown>] =>
        warning[0] === 'Failed to record linked Google Sheet artifact' &&
        typeof warning[1] === 'object' &&
        warning[1] !== null &&
        (warning[1] as Record<string, unknown>).reason === 'artifact_record_failed'
    )
    expect(
      artifactRecordWarnings.find((warning) => warning[1].spreadsheetId === existingSpreadsheetId)
    ).toEqual([
      'Failed to record linked Google Sheet artifact',
      {
        artifactCleanedUp: null,
        reason: 'artifact_record_failed',
        sessionId: 'session-1',
        spreadsheetId: existingSpreadsheetId
      }
    ])
    expect(
      artifactRecordWarnings.find((warning) => warning[1].spreadsheetId === createdSpreadsheetId)
    ).toEqual([
      'Failed to record linked Google Sheet artifact',
      {
        artifactCleanedUp: true,
        reason: 'artifact_record_failed',
        sessionId: 'session-1',
        spreadsheetId: createdSpreadsheetId
      }
    ])

    const warningText = JSON.stringify(warnings)
    expect(warningText).not.toContain('valid-sheets-access-token')
    expect(warningText).not.toContain('refresh-token')
    expect(warningText).not.toContain('sensitive cell')
    expect(warningText).not.toContain('EACCES')
    expect(warningText).not.toContain(tempRoot)
    expect(warningText).not.toContain(projectPath)
    await expect(stat(existingArtifactPath)).resolves.toMatchObject({})
    await expect(stat(createdArtifactPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(artifactsPath, 'utf8')).resolves.toBe(
      '{\n  "version": 1,\n  "sessions": {}\n}\n'
    )
  } finally {
    console.warn = originalWarn
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await chmod(openKhodamPath, 0o755).catch(() => undefined)
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
      await executeGoogleWorkspaceCommand(
        plugin,
        'google.docs.read',
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
      executeGoogleWorkspaceCommand(plugin, 'google.drive.search_files', { query: 'budget' }, {})
    ).rejects.toThrow(
      'Google Drive files.list failed (HTTP 403, PERMISSION_DENIED, ACCESS_TOKEN_SCOPE_INSUFFICIENT): Drive permission denied.'
    )
    await expect(
      executeGoogleWorkspaceCommand(plugin, 'google.docs.read', { documentId: 'doc-denied' }, {})
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
      executeGoogleWorkspaceCommand(plugin, 'google.drive.search_files', { query: 'budget' }, {})
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
      executeGoogleWorkspaceCommand(plugin, 'google.drive.search_files', { query: 'budget' }, {})
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
    await expect(
      executeGoogleWorkspaceCommand(plugin, 'google.docs.read', { documentId: 'doc-1' }, {})
    ).rejects.toThrow(
      'Google Docs access is not enabled. Reconnect Google Workspace in Settings to grant Google Docs read/write access.'
    )
  } finally {
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('returns a clear reconnect error when the Google Sheets scope is missing', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-google-sheets-missing-scope-'))
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH

  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: [
      'email',
      googleDriveMetadataReadonlyScope,
      googleDocsDocumentsScope,
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

  try {
    const plugin = await loadGoogleWorkspacePlugin()
    await expect(
      executeGoogleWorkspaceCommand(plugin, 'google.sheets.read', { spreadsheetId: 'sheet-1' }, {})
    ).rejects.toThrow(
      'Google Sheets access is not enabled. Reconnect Google Workspace in Settings with Sheets access enabled.'
    )
  } finally {
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('returns a clear reconnect error when Google Sheets write scope is missing for edits', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-google-sheets-edit-missing-scope-'))
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const originalFetch = globalThis.fetch
  let fetchCalls = 0

  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleSheetsSpreadsheetsScope, 'openid', 'profile'],
    token: {
      accessToken: 'valid-readonly-sheets-token',
      expiresAt: Date.now() + 60 * 60 * 1000,
      idToken: null,
      refreshToken: 'refresh-token',
      tokenType: 'Bearer'
    },
    updatedAt: Date.now()
  })
  process.env.OPENKHODAM_CONFIG_PATH = configPath
  globalThis.fetch = (async () => {
    fetchCalls += 1
    throw new Error('google.sheets.set_values should not call Google APIs without write scope')
  }) as typeof fetch

  try {
    const plugin = await loadGoogleWorkspacePlugin()
    await expect(
      executeGoogleWorkspaceCommand(
        plugin,
        'google.sheets.set_values',
        { spreadsheetId: 'sheet-1', range: 'Summary!A1:B1', values: [['new value']] },
        {}
      )
    ).rejects.toThrow(
      'Google Sheets write access is not enabled. Reconnect Google Workspace in Settings to grant Sheets read/write access.'
    )
    expect(fetchCalls).toBe(0)
  } finally {
    globalThis.fetch = originalFetch
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
        projects: {
          openedFolders: []
        },
        preferences: {
          openCode: {
            modelSelectionsByDirectory: {}
          }
        },
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

function expectedGoogleDocArtifactAbsolutePath(projectPath: string, documentId: string): string {
  return join(projectPath, ...expectedGoogleDocArtifactPath(documentId).split('/'))
}

function expectedGoogleDocArtifactPath(documentId: string): string {
  return `.openkhodam/artifacts/google-docs/${expectedGoogleDocArtifactFileName(documentId)}`
}

function expectedGoogleDocArtifactFileName(documentId: string): string {
  return `encoded-${Buffer.from(documentId, 'utf8').toString('base64url')}.json`
}

function expectedGoogleSheetArtifactAbsolutePath(
  projectPath: string,
  spreadsheetId: string
): string {
  return join(projectPath, ...expectedGoogleSheetArtifactPath(spreadsheetId).split('/'))
}

function expectedGoogleSheetArtifactPath(spreadsheetId: string): string {
  return `.openkhodam/artifacts/google-sheets/${expectedGoogleSheetArtifactFileName(spreadsheetId)}`
}

function expectedGoogleSheetArtifactFileName(spreadsheetId: string): string {
  return `encoded-${Buffer.from(spreadsheetId, 'utf8').toString('base64url')}.json`
}

function readFetchedGoogleDocsDocumentId(url: string): string | null {
  const parsed = new URL(url)
  const prefix = '/v1/documents/'
  if (parsed.origin !== 'https://docs.googleapis.com' || !parsed.pathname.startsWith(prefix)) {
    return null
  }

  return decodeURIComponent(parsed.pathname.slice(prefix.length))
}

function readFetchedGoogleSheetsSpreadsheet(
  url: string
): { spreadsheetId: string; values: boolean } | null {
  const parsed = new URL(url)
  const prefix = '/v4/spreadsheets/'
  const valuesSuffix = '/values:batchGet'
  if (parsed.origin !== 'https://sheets.googleapis.com' || !parsed.pathname.startsWith(prefix)) {
    return null
  }

  const rest = parsed.pathname.slice(prefix.length)
  if (rest.endsWith(valuesSuffix)) {
    return {
      spreadsheetId: decodeURIComponent(rest.slice(0, -valuesSuffix.length)),
      values: true
    }
  }

  return {
    spreadsheetId: decodeURIComponent(rest),
    values: false
  }
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
    expect(JSON.parse(body) as string[]).not.toContain('google_drive_search_files')
    expect(JSON.parse(body) as string[]).not.toContain('google_docs_read')
    expect(JSON.parse(body) as string[]).not.toContain('google_docs_edit')
    expect(JSON.parse(body) as string[]).toContain('google_workspace_list_commands')
    expect(JSON.parse(body) as string[]).toContain('google_workspace_execute_command')
    expect(JSON.parse(body) as string[]).not.toContain('google_sheets_read')
    expect(JSON.parse(body) as string[]).not.toContain('google_sheets_edit')
    expect(JSON.parse(body) as string[]).not.toContain('google_docs_append_text')
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
