import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createOpenKhodamClient } from '@openkhodam/client'
import {
  GOOGLE_DOCS_ARTIFACTS_DIRECTORY_NAME,
  GOOGLE_SHEETS_ARTIFACTS_DIRECTORY_NAME,
  ProjectArtifactsFileStore,
  ProjectArtifactsModule
} from './project-artifacts.js'
import { createOpenKhodamApp, startOpenKhodamServer, type OpenKhodamListener } from './index.js'

const options = {
  rendererTokens: ['renderer-token'],
  pluginTokens: ['plugin-token'],
  version: '0.1.0'
}

describe('OpenKhodam Hono app', () => {
  it('rejects requests without an accepted token', async () => {
    const response = await createOpenKhodamApp(options).request('http://localhost/health')
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'unauthorized', message: 'Unauthorized' }
    })
  })

  it('accepts configured credentials and rejects unknown tokens', async () => {
    const app = createOpenKhodamApp(options)
    await expect(
      app.request('http://localhost/health', {
        headers: { authorization: 'Bearer renderer-token' }
      })
    ).resolves.toMatchObject({ status: 200 })
    await expect(
      app.request('http://localhost/health', { headers: { authorization: 'Bearer plugin-token' } })
    ).resolves.toMatchObject({ status: 200 })
    await expect(
      app.request('http://localhost/health', { headers: { authorization: 'Bearer unknown' } })
    ).resolves.toMatchObject({ status: 401 })
  })

  it('permits only configured renderer origins and actual JSON preflight headers', async () => {
    const app = createOpenKhodamApp({
      ...options,
      corsOrigins: ['file://', 'http://127.0.0.1:5173']
    })
    const packaged = await app.request('http://localhost/health', {
      headers: { authorization: 'Bearer renderer-token', origin: 'file://' }
    })
    expect(packaged.headers.get('access-control-allow-origin')).toBe('file://')
    expect(packaged.status).toBe(200)
    const devPreflight = await app.request('http://localhost/health', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://127.0.0.1:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type'
      }
    })
    expect(devPreflight.status).toBe(204)
    expect(devPreflight.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5173')
    expect(devPreflight.headers.get('access-control-allow-headers')).toContain('content-type')
    const foreignPreflight = await app.request('http://localhost/artifacts/list', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' }
    })
    expect(foreignPreflight.status).toBe(401)
    expect(foreignPreflight.headers.get('access-control-allow-origin')).toBeNull()
    const foreign = await app.request('http://localhost/health', {
      headers: { authorization: 'Bearer renderer-token', origin: 'https://evil.example' }
    })
    expect(foreign.status).toBe(200)
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull()
    await expect(
      app.request('http://localhost/health', { headers: { origin: 'file://' } })
    ).resolves.toMatchObject({ status: 401 })
  })

  it('exposes authenticated health, version, and capabilities', async () => {
    const app = createOpenKhodamApp({ ...options, capabilities: ['health'] })
    const headers = { authorization: 'Bearer renderer-token' }
    await expect(
      (await app.request('http://localhost/health', { headers })).json()
    ).resolves.toEqual({ status: 'ok' })
    await expect(
      (await app.request('http://localhost/version', { headers })).json()
    ).resolves.toEqual({ version: '0.1.0' })
    await expect(
      (await app.request('http://localhost/capabilities', { headers })).json()
    ).resolves.toEqual({
      protocolVersion: '1',
      capabilities: ['health']
    })
  })

  it('rejects cross-role artifact access without revealing roles or tokens', async () => {
    const app = createOpenKhodamApp(options)
    const projectDirectory = await mkdtemp(join(tmpdir(), 'openkhodam-artifacts-'))
    try {
      const readWithPlugin = await app.request('http://localhost/artifacts/list', {
        method: 'POST',
        headers: { authorization: 'Bearer plugin-token', 'content-type': 'application/json' },
        body: JSON.stringify({ projectDirectory })
      })
      expect(readWithPlugin.status).toBe(401)
      const mutateWithRenderer = await app.request('http://localhost/artifacts/record', {
        method: 'POST',
        headers: { authorization: 'Bearer renderer-token', 'content-type': 'application/json' },
        body: JSON.stringify({ projectDirectory, sessionId: 's', artifact: { id: 'd' } })
      })
      expect(mutateWithRenderer.status).toBe(401)
      await expect(mutateWithRenderer.text()).resolves.not.toMatch(/renderer|plugin|token/i)
    } finally {
      await rm(projectDirectory, { recursive: true, force: true })
    }
  })
})

describe('OpenKhodam listener', () => {
  let listener: OpenKhodamListener | undefined

  afterEach(async () => listener?.close())

  it('binds loopback, serves requests, and shuts down', async () => {
    listener = await startOpenKhodamServer(options)
    const response = await fetch(`http://127.0.0.1:${listener.port}/health`, {
      headers: { authorization: 'Bearer plugin-token' }
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok' })
    await listener.close()
    listener = undefined
    await expect(
      fetch(`http://127.0.0.1:${response.url.split(':')[2].split('/')[0]}/health`)
    ).rejects.toThrow()
  })

  it('round trips artifact list and semantic record methods through a real listener and client', async () => {
    const projectDirectory = await mkdtemp(join(tmpdir(), 'openkhodam-artifacts-'))
    listener = await startOpenKhodamServer(options)
    const client = createOpenKhodamClient({
      baseUrl: `http://127.0.0.1:${listener.port}`,
      token: 'renderer-token'
    })
    try {
      await expect(client.listProjectArtifacts({ projectDirectory })).resolves.toEqual({
        version: 1,
        sessions: {}
      })
      await expect(
        createOpenKhodamClient({
          baseUrl: `http://127.0.0.1:${listener.port}`,
          token: 'plugin-token'
        }).recordLinkedGoogleArtifact({
          projectDirectory,
          sessionId: 'session-1',
          messageId: 'message-1',
          artifact: { id: 'doc-1', title: 'Doc', url: 'https://docs.google.com/document/d/doc-1' }
        })
      ).resolves.toMatchObject({ id: 'doc-1', listed: true, type: 'google.doc.document' })
    } finally {
      await rm(projectDirectory, { recursive: true, force: true })
    }
  })
})

describe('ProjectArtifactsModule', () => {
  const directories: string[] = []
  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
    )
  })
  async function project() {
    const path = await mkdtemp(join(tmpdir(), 'openkhodam-artifacts-'))
    directories.push(path)
    return path
  }
  const document = {
    type: 'google.doc.document' as const,
    id: 'doc-1',
    title: 'Doc',
    revision: '1',
    text: 'hello',
    link: 'https://docs.google.com/document/d/doc-1',
    body: { blocks: [{ id: 'block-1', ordinal: 0, type: 'paragraph' as const, text: 'hello' }] }
  }
  const spreadsheet = {
    type: 'google.sheet.spreadsheet' as const,
    id: 'sheet-1',
    title: 'Sheet',
    link: 'https://docs.google.com/spreadsheets/d/sheet-1',
    sheets: [],
    ranges: []
  }

  it('persists server-owned Docs and Sheets paths with their compatible schemas', async () => {
    const projectDirectory = await project()
    const module = new ProjectArtifactsModule(() => 123)
    const doc = await module.persistGoogleDocDocumentArtifact({ projectDirectory, document })
    const sheet = await module.persistGoogleSheetSpreadsheetArtifact({
      projectDirectory,
      spreadsheet
    })
    expect(doc.artifactPath).toMatch(
      new RegExp(
        `^\\.openkhodam/artifacts/${GOOGLE_DOCS_ARTIFACTS_DIRECTORY_NAME}/encoded-.+\\.json$`
      )
    )
    expect(sheet.artifactPath).toMatch(
      new RegExp(
        `^\\.openkhodam/artifacts/${GOOGLE_SHEETS_ARTIFACTS_DIRECTORY_NAME}/encoded-.+\\.json$`
      )
    )
    await expect(readFile(join(projectDirectory, doc.artifactPath), 'utf8')).resolves.toContain(
      '"schemaVersion": 1'
    )
    await expect(readFile(join(projectDirectory, sheet.artifactPath), 'utf8')).resolves.toContain(
      '"schemaVersion": 1'
    )
  })

  it('rejects symlinked artifact directories and files', async () => {
    const projectDirectory = await project()
    const outside = await project()
    const docDirectory = join(
      projectDirectory,
      '.openkhodam',
      'artifacts',
      GOOGLE_DOCS_ARTIFACTS_DIRECTORY_NAME
    )
    await rm(join(projectDirectory, '.openkhodam'), { recursive: true, force: true })
    await (
      await import('node:fs/promises')
    ).mkdir(join(projectDirectory, '.openkhodam', 'artifacts'), {
      recursive: true
    })
    await symlink(outside, docDirectory)
    await expect(
      new ProjectArtifactsModule().persistGoogleDocDocumentArtifact({ projectDirectory, document })
    ).rejects.toThrow('must not be a symlink')

    const cleanProject = await project()
    const persisted = await new ProjectArtifactsModule().persistGoogleDocDocumentArtifact({
      projectDirectory: cleanProject,
      document
    })
    await rm(join(cleanProject, persisted.artifactPath))
    await symlink(join(outside, 'linked.json'), join(cleanProject, persisted.artifactPath))
    await expect(
      new ProjectArtifactsModule().persistGoogleDocDocumentArtifact({
        projectDirectory: cleanProject,
        document
      })
    ).rejects.toThrow('must not be a symlink')
  })

  it('rejects secret-bearing linked URLs before persistence', async () => {
    const projectDirectory = await project()
    const app = createOpenKhodamApp(options)
    const response = await app.request('http://localhost/artifacts/google-docs/snapshot-link', {
      method: 'POST',
      headers: { authorization: 'Bearer plugin-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        projectDirectory,
        sessionId: 'session',
        document: { ...document, link: 'https://token@example.test/doc' }
      })
    })
    expect(response.status).toBe(400)
    await expect(readdir(join(projectDirectory, '.openkhodam'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it.each([
    'https://example.test/?token=value',
    'https://example.test/?client_secret=value',
    'https://example.test/?credential=value',
    'https://example.test/?password=value',
    'https://example.test/?client%5Fsecret=value',
    'https://example.test/#access_token=value'
  ])('rejects parsed and encoded secret parameter names without persistence: %s', async (link) => {
    const projectDirectory = await project()
    await expect(
      new ProjectArtifactsModule().snapshotGoogleDocDocument({
        projectDirectory,
        sessionId: 'session',
        document: { ...document, link }
      })
    ).rejects.toThrow('secret-like')
    await expect(readdir(join(projectDirectory, '.openkhodam'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('serializes concurrent records for one canonical project', async () => {
    const projectDirectory = await project()
    const module = new ProjectArtifactsModule()
    await Promise.all(
      ['one', 'two', 'three'].map((id) =>
        module.recordLinkedGoogleArtifact({
          projectDirectory,
          sessionId: 'session',
          artifact: { id, type: 'google.doc.document' }
        })
      )
    )
    await expect(
      module.listSessionLinkedGoogleArtifacts(projectDirectory, 'session')
    ).resolves.toHaveLength(3)
  })

  it('queues reads until an in-flight semantic snapshot and link completes', async () => {
    const projectDirectory = await project()
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const module = new ProjectArtifactsModule(Date.now, {
      beforeRecordLinkedGoogleArtifact: () => gate
    })
    const snapshot = module.snapshotGoogleDocDocument({
      projectDirectory,
      sessionId: 'session',
      document
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    const queuedRead = module.listProjectArtifacts(projectDirectory)
    let settled = false
    void queuedRead.then(() => (settled = true))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(settled).toBe(false)
    release()
    await snapshot
    await expect(queuedRead).resolves.toMatchObject({ sessions: { session: [{ id: 'doc-1' }] } })
  })

  it('cleans only a newly-created snapshot when linking fails', async () => {
    const projectDirectory = await project()
    const module = new ProjectArtifactsModule(Date.now, {
      beforeRecordLinkedGoogleArtifact: () => {
        throw new Error('link failed')
      }
    })
    await expect(
      module.snapshotGoogleDocDocument({ projectDirectory, sessionId: 'session', document })
    ).rejects.toThrow('link failed')
    const artifactDirectory = join(
      projectDirectory,
      '.openkhodam',
      'artifacts',
      GOOGLE_DOCS_ARTIFACTS_DIRECTORY_NAME
    )
    await expect(readdir(artifactDirectory)).resolves.toEqual([])

    const existing = await new ProjectArtifactsModule().persistGoogleDocDocumentArtifact({
      projectDirectory,
      document
    })
    await expect(
      module.snapshotGoogleDocDocument({ projectDirectory, sessionId: 'session', document })
    ).rejects.toThrow('link failed')
    await expect(
      readFile(join(projectDirectory, existing.artifactPath), 'utf8')
    ).resolves.toContain('doc-1')
  })

  it('preserves the link failure when snapshot rollback fails and preserves existing snapshots', async () => {
    const projectDirectory = await project()
    const module = new ProjectArtifactsModule(Date.now, {
      beforeRecordLinkedGoogleArtifact: () => {
        throw new Error('link failed')
      }
    })
    const existing = await new ProjectArtifactsModule().persistGoogleDocDocumentArtifact({
      projectDirectory,
      document
    })
    const originalDelete = ProjectArtifactsFileStore.prototype.deleteGoogleDocDocumentArtifact
    ProjectArtifactsFileStore.prototype.deleteGoogleDocDocumentArtifact = async () => {
      throw new Error('rollback failed')
    }
    await expect(
      module.snapshotGoogleDocDocument({
        projectDirectory,
        sessionId: 'session',
        document: { ...document, id: 'doc-2' }
      })
    ).rejects.toThrow('link failed')
    ProjectArtifactsFileStore.prototype.deleteGoogleDocDocumentArtifact = originalDelete
    await expect(
      readFile(join(projectDirectory, existing.artifactPath), 'utf8')
    ).resolves.toContain('doc-1')
  })

  it('logs only a path-free cleanup outcome when rollback throws an absolute-path error', async () => {
    const projectDirectory = await project()
    const module = new ProjectArtifactsModule(Date.now, {
      beforeRecordLinkedGoogleArtifact: () => {
        throw new Error('link failed')
      }
    })
    const originalDelete = ProjectArtifactsFileStore.prototype.deleteGoogleDocDocumentArtifact
    const warn = console.warn
    const warnings: unknown[][] = []
    ProjectArtifactsFileStore.prototype.deleteGoogleDocDocumentArtifact = async () => {
      throw new Error(`unlink failed at ${projectDirectory}/secret.json`)
    }
    console.warn = (...args: unknown[]) => warnings.push(args)
    try {
      await expect(
        module.snapshotGoogleDocDocument({ projectDirectory, sessionId: 'session', document })
      ).rejects.toThrow('link failed')
    } finally {
      ProjectArtifactsFileStore.prototype.deleteGoogleDocDocumentArtifact = originalDelete
      console.warn = warn
    }
    expect(warnings).toEqual([
      [
        'Failed to clean up Google Docs artifact snapshot after link failure.',
        { cleanupError: 'cleanup failed' }
      ]
    ])
    expect(JSON.stringify(warnings)).not.toContain(projectDirectory)
  })

  it('does not rewrite an existing semantic link when message provenance is absent', async () => {
    const projectDirectory = await project()
    const module = new ProjectArtifactsModule(() => 123)
    await module.snapshotGoogleDocDocument({
      projectDirectory,
      sessionId: 'session',
      messageId: 'message-1',
      document
    })
    const before = await readFile(join(projectDirectory, '.openkhodam', 'artifacts.json'), 'utf8')
    await module.snapshotGoogleDocDocument({ projectDirectory, sessionId: 'session', document })
    await expect(
      readFile(join(projectDirectory, '.openkhodam', 'artifacts.json'), 'utf8')
    ).resolves.toBe(before)
  })

  it('updates generic records and adds a missing snapshot path without message provenance', async () => {
    const projectDirectory = await project()
    const module = new ProjectArtifactsModule(() => 123)
    await module.recordLinkedGoogleArtifact({
      projectDirectory,
      sessionId: 'session',
      artifact: { id: 'doc-1', title: 'Legacy', url: document.link }
    })
    await expect(
      module.recordLinkedGoogleArtifact({
        projectDirectory,
        sessionId: 'session',
        artifact: { id: 'doc-1', title: 'Updated', url: document.link }
      })
    ).resolves.toMatchObject({ title: 'Updated' })
    await expect(
      module.snapshotGoogleDocDocument({ projectDirectory, sessionId: 'session', document })
    ).resolves.toMatchObject({ artifactPath: expect.stringContaining('google-docs') })
  })

  it.each([
    'https://example.test/?authorization=value',
    'https://example.test/?cookie=value',
    'https://example.test/?apiKey=value',
    'https://example.test/?refreshToken=value',
    'https://example.test/?credentials=value',
    'https://example.test/?password=value',
    'https://example.test/?client%5Fsecret=value',
    'https://example.test/#/route?x=1&api%4Bey=value',
    'https://example.test/#/route?x=1&refresh_token=value&other=1',
    'https://example.test/#/route?credentials=value',
    'https://example.test/#route=1&token=value',
    'https://example.test/#/route?key=value',
    'https://example.test/#/route?sig=value',
    'https://example.test/#%2Fdoc%3Ftoken%3Dvalue',
    'https://example.test/#%2Fdoc%3Faccess%255Ftoken%3Dvalue'
  ])('does not persist normalized secret names anywhere in query or hash: %s', async (link) => {
    const projectDirectory = await project()
    await expect(
      new ProjectArtifactsModule().snapshotGoogleDocDocument({
        projectDirectory,
        sessionId: 'session',
        document: { ...document, link }
      })
    ).rejects.toThrow('secret-like')
    await expect(readdir(join(projectDirectory, '.openkhodam'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })
})
