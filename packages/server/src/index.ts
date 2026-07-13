import { serve } from '@hono/node-server'
import { type ApiError, protocolVersion } from '@openkhodam/protocol'
import { Hono } from 'hono'
import type { Server } from 'node:http'

export interface OpenKhodamServerOptions {
  token: string
  version: string
  capabilities?: string[]
}

function errorResponse(code: ApiError['error']['code'], message: string) {
  return { error: { code, message } } as ApiError
}

export function createOpenKhodamApp(options: OpenKhodamServerOptions) {
  const app = new Hono()

  app.use('*', async (context, next) => {
    if (context.req.header('authorization') !== `Bearer ${options.token}`) {
      return context.json(errorResponse('unauthorized', 'Unauthorized'), 401)
    }
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

  app.notFound((context) => context.json(errorResponse('not_found', 'Not found'), 404))
  return app
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
