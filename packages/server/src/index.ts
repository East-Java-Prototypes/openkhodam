import { serve } from '@hono/node-server'
import {
  type ApiError,
  parseProjectArtifactsListInput,
  parseRecordLinkedGoogleArtifactInput,
  parseSnapshotGoogleDocDocumentInput,
  parseSnapshotGoogleSheetSpreadsheetInput,
  parseUpdateLinkedGoogleArtifactListingInput,
  protocolVersion
} from '@openkhodam/protocol'
import { Hono } from 'hono'
import type { Server } from 'node:http'
import { ProjectArtifactsModule } from './project-artifacts.js'

export * from './project-artifacts.js'

export interface OpenKhodamServerOptions {
  tokens?: readonly string[]
  rendererTokens?: readonly string[]
  pluginTokens?: readonly string[]
  version: string
  capabilities?: string[]
  corsOrigins?: readonly string[]
  artifacts?: ProjectArtifactsModule
}

function errorResponse(code: ApiError['error']['code'], message: string) {
  return { error: { code, message } } as ApiError
}

export function createOpenKhodamApp(options: OpenKhodamServerOptions) {
  const app = new Hono()
  const artifacts = options.artifacts ?? new ProjectArtifactsModule()
  const rendererTokens = options.rendererTokens ?? options.tokens ?? []
  const pluginTokens = options.pluginTokens ?? options.tokens ?? []

  app.use('*', async (context, next) => {
    const origin = context.req.header('origin')
    if (origin && options.corsOrigins?.includes(origin)) {
      context.header('access-control-allow-origin', origin)
      context.header('access-control-allow-headers', 'authorization, accept, content-type')
      if (context.req.method === 'OPTIONS') return context.body(null, 204)
    }
    return next()
  })

  app.use('*', async (context, next) => {
    const token = bearerToken(context.req.header('authorization'))
    const role =
      token &&
      (rendererTokens.includes(token)
        ? 'renderer'
        : pluginTokens.includes(token)
          ? 'plugin'
          : undefined)
    if (!role) {
      return context.json(errorResponse('unauthorized', 'Unauthorized'), 401)
    }
    context.set('openkhodamRole' as never, role as never)
    return next()
  })

  app.get('/health', (context) => context.json({ status: 'ok' as const }))
  app.get('/version', (context) => context.json({ version: options.version }))
  app.get('/capabilities', (context) =>
    context.json({
      protocolVersion,
      capabilities: options.capabilities ?? ['health', 'version', 'capabilities']
    })
  )

  app.post('/artifacts/list', requireRole('renderer'), async (context) =>
    artifactRoute(context, async () =>
      artifacts.listProjectArtifacts(
        parseProjectArtifactsListInput(await context.req.json()).projectDirectory
      )
    )
  )
  app.post('/artifacts/session/list', requireRole('renderer'), async (context) =>
    artifactRoute(context, async () => {
      const body = await context.req.json()
      const input = parseProjectArtifactsListInput(body)
      if (typeof (body as Record<string, unknown>).sessionId !== 'string')
        throw new Error('sessionId must be a string')
      return artifacts.listSessionLinkedGoogleArtifacts(
        input.projectDirectory,
        (body as { sessionId: string }).sessionId
      )
    })
  )
  app.post('/artifacts/record', requireRole('plugin'), async (context) =>
    artifactRoute(context, async () =>
      artifacts.recordLinkedGoogleArtifact(
        parseRecordLinkedGoogleArtifactInput(await context.req.json())
      )
    )
  )
  app.post('/artifacts/delist', requireRole('plugin'), async (context) =>
    artifactRoute(context, async () =>
      artifacts.delistLinkedGoogleArtifact(
        parseUpdateLinkedGoogleArtifactListingInput(await context.req.json())
      )
    )
  )
  app.post('/artifacts/relist', requireRole('plugin'), async (context) =>
    artifactRoute(context, async () =>
      artifacts.relistLinkedGoogleArtifact(
        parseUpdateLinkedGoogleArtifactListingInput(await context.req.json())
      )
    )
  )
  app.post('/artifacts/google-docs/snapshot-link', requireRole('plugin'), async (context) =>
    artifactRoute(context, async () =>
      artifacts.snapshotGoogleDocDocument(
        parseSnapshotGoogleDocDocumentInput(await context.req.json())
      )
    )
  )
  app.post('/artifacts/google-sheets/snapshot-link', requireRole('plugin'), async (context) =>
    artifactRoute(context, async () =>
      artifacts.snapshotGoogleSheetSpreadsheet(
        parseSnapshotGoogleSheetSpreadsheetInput(await context.req.json())
      )
    )
  )

  app.notFound((context) => context.json(errorResponse('not_found', 'Not found'), 404))
  return app
}

function bearerToken(value: string | undefined): string | undefined {
  return value?.startsWith('Bearer ') ? value.slice('Bearer '.length) : undefined
}

function requireRole(role: 'renderer' | 'plugin') {
  return async (
    context: { get(name: never): unknown; json(value: unknown, status?: number): Response },
    next: () => Promise<void>
  ) => {
    if (context.get('openkhodamRole' as never) !== role)
      return context.json(errorResponse('unauthorized', 'Unauthorized'), 401)
    await next()
    return undefined
  }
}

async function artifactRoute(
  context: { json(value: unknown, status?: number): Response },
  action: () => Promise<unknown>
): Promise<Response> {
  try {
    return context.json(await action())
  } catch (error) {
    return context.json(
      errorResponse(
        'validation_error',
        error instanceof Error ? error.message : 'Invalid artifact request'
      ),
      400
    )
  }
}

export interface OpenKhodamListener {
  port: number
  close(): Promise<void>
}

export async function startOpenKhodamServer(
  options: OpenKhodamServerOptions & { port?: number }
): Promise<OpenKhodamListener> {
  const server = serve({
    fetch: createOpenKhodamApp(options).fetch,
    hostname: '127.0.0.1',
    port: options.port ?? 0
  }) as Server
  await onceListening(server)
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('OpenKhodam listener did not expose a TCP address')
  return { port: address.port, close: () => closeServer(server) }
}

function onceListening(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}
