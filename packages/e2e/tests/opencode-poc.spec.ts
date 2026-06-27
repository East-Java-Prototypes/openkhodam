import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

import { expect, test } from '@playwright/test'

const testsDirectory = dirname(fileURLToPath(import.meta.url))
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
const sourceGoogleWorkspaceRuntimePath = join(
  desktopDirectory,
  'src',
  'main',
  'integrations',
  'google-workspace-runtime.ts'
)
const toolName = 'openkhodam_plugin_ping'
const googleDriveToolName = 'google_drive_search_files'
const googleDocsReadToolName = 'google_docs_read'
const googleDocsAppendTextToolName = 'google_docs_append_text'
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
    google_docs_append_text: {
      description: string
      execute: (
        args: { documentId?: string; text?: string },
        context: {
          abort?: AbortSignal
          ask?: (input: {
            always: string[]
            metadata: Record<string, unknown>
            patterns: string[]
            permission: string
          }) => Promise<void>
        }
      ) => Promise<string>
    }
    google_docs_read: {
      description: string
      execute: (args: { documentId?: string }, context: { abort?: AbortSignal }) => Promise<string>
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
                endIndex: 12,
                paragraph: {
                  elements: [{ textRun: { content: 'Hello Docs\n' } }]
                }
              },
              {
                endIndex: 24,
                paragraph: {
                  elements: [{ textRun: { content: 'Second line\n' } }]
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
      'documentId,title,revisionId,body(content(endIndex,paragraph(elements(textRun(content)))))'
    )
    expect(output).toEqual({
      document: {
        type: 'google.doc.document',
        id: 'doc-1',
        title: 'Docs Plan',
        revision: 'rev-1',
        text: 'Hello Docs\nSecond line',
        link: 'https://docs.google.com/document/d/doc-1/edit'
      }
    })

    const outputText = JSON.stringify(output)
    expect(outputText).not.toContain('expired-docs-access-token')
    expect(outputText).not.toContain('new-docs-access-token')
    expect(outputText).not.toContain('refresh-token')
    expect(outputText).not.toContain('should-not-leak')
    expect(outputText).not.toContain('owner@example.com')

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

test('asks permission before appending Google Docs text and sends a safe batchUpdate', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-google-docs-append-'))
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const events: string[] = []
  const appendedText = '\nApproved append'
  let batchAuthorization: string | null = null
  let batchBody: unknown = null
  let batchUrl: URL | null = null
  let permissionRequest: Record<string, unknown> | null = null

  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleDocsDocumentsScope, 'openid', 'profile'],
    token: {
      accessToken: 'append-access-token',
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

    if (url.startsWith('https://docs.googleapis.com/v1/documents/doc-append:batchUpdate')) {
      events.push('batchUpdate')
      batchUrl = new URL(url)
      batchAuthorization = new Headers(init?.headers).get('authorization')
      batchBody = typeof init?.body === 'string' ? JSON.parse(init.body) : null
      return new Response(
        JSON.stringify({
          documentId: 'doc-append',
          writeControl: { targetRevisionId: 'rev-after-append' }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    if (url.startsWith('https://docs.googleapis.com/v1/documents/doc-append')) {
      events.push('documents.get')
      return new Response(
        JSON.stringify({
          body: {
            content: [
              {
                endIndex: 18,
                paragraph: {
                  elements: [{ textRun: { content: 'Existing body\n' } }]
                }
              }
            ]
          },
          documentId: 'doc-append',
          revisionId: 'rev-before-append',
          title: 'Append Target'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    throw new Error(`Unexpected fetch URL: ${url}`)
  }) as typeof fetch

  try {
    const plugin = await loadGoogleWorkspacePlugin()
    expect(plugin.tool.google_docs_append_text.description).toContain('permission approval')

    const output = JSON.parse(
      await plugin.tool.google_docs_append_text.execute(
        { documentId: 'doc-append', text: appendedText },
        {
          ask: async (input) => {
            events.push('ask')
            permissionRequest = input
          }
        }
      )
    ) as Record<string, unknown>

    expect(events).toEqual(['documents.get', 'ask', 'batchUpdate'])
    expect(permissionRequest).toEqual({
      permission: 'google_docs_append_text',
      patterns: ['google-docs:doc-append'],
      always: ['google-docs:doc-append'],
      metadata: {
        action: 'append_text',
        characterCount: appendedText.length,
        documentId: 'doc-append',
        documentTitle: 'Append Target',
        insertionIndex: 17,
        link: 'https://docs.google.com/document/d/doc-append/edit',
        textPreview: 'Approved append'
      }
    })
    expect(batchUrl?.pathname).toBe('/v1/documents/doc-append:batchUpdate')
    expect(batchAuthorization).toBe('Bearer append-access-token')
    expect(batchBody).toEqual({
      requests: [
        {
          insertText: {
            location: { index: 17 },
            text: appendedText
          }
        }
      ]
    })
    expect(output).toEqual({
      ok: true,
      documentId: 'doc-append',
      insertedTextLength: appendedText.length,
      insertionIndex: 17,
      link: 'https://docs.google.com/document/d/doc-append/edit',
      revision: 'rev-after-append',
      title: 'Append Target'
    })

    const outputText = JSON.stringify(output)
    expect(outputText).not.toContain('append-access-token')
    expect(outputText).not.toContain('refresh-token')
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv('OPENKHODAM_CONFIG_PATH', originalConfigPath)
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('keeps Google Docs append approval required at the runtime write boundary', async () => {
  const runtimeSource = await readFile(sourceGoogleWorkspaceRuntimePath, 'utf8')

  expect(runtimeSource).toContain(
    'approve: (input: GoogleDocsAppendApprovalInput) => Promise<void>'
  )
  expect(runtimeSource).toContain(
    "throw new Error('Google Docs append requires approval before writing to Google Docs.')"
  )
  expect(runtimeSource).toContain('await approve({ document, insertionIndex, text: textToAppend })')
  expect(runtimeSource).not.toContain('approve?.')
})

test('does not call the Google Docs write API when append permission is denied', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-google-docs-denied-'))
  const configPath = join(userDataPath, 'openkhodam-config.json')
  const originalFetch = globalThis.fetch
  const originalConfigPath = process.env.OPENKHODAM_CONFIG_PATH
  const events: string[] = []

  await writeOpenKhodamConfig(configPath, {
    account: { email: 'fake@example.com', name: 'Fake User' },
    scopes: ['email', googleDocsDocumentsScope, 'openid', 'profile'],
    token: {
      accessToken: 'append-access-token',
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
    if (url.startsWith('https://docs.googleapis.com/v1/documents/doc-denied:batchUpdate')) {
      events.push('batchUpdate')
      throw new Error('Batch update should not be called when append approval is denied.')
    }

    if (url.startsWith('https://docs.googleapis.com/v1/documents/doc-denied')) {
      events.push('documents.get')
      return new Response(
        JSON.stringify({
          body: {
            content: [
              {
                endIndex: 4,
                paragraph: { elements: [{ textRun: { content: 'Body\n' } }] }
              }
            ]
          },
          documentId: 'doc-denied',
          title: 'Denied Target'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }

    throw new Error(`Unexpected fetch URL: ${url}`)
  }) as typeof fetch

  try {
    const plugin = await loadGoogleWorkspacePlugin()
    await expect(
      plugin.tool.google_docs_append_text.execute(
        { documentId: 'doc-denied', text: 'Denied append' },
        {
          ask: async () => {
            events.push('ask')
            throw new Error('Permission denied')
          }
        }
      )
    ).rejects.toThrow('Permission denied')
    expect(events).toEqual(['documents.get', 'ask'])
  } finally {
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
    expect(JSON.parse(body) as string[]).toContain(googleDocsReadToolName)
    expect(JSON.parse(body) as string[]).toContain(googleDocsAppendTextToolName)
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
