import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { dirname, join, sep } from 'node:path'
import { app, utilityProcess, type UtilityProcess } from 'electron'

export type OpenCodeConnection = {
  url: string
  username: string
  password: string
}

export type OpenCodeSidecarStatus = {
  state: 'stopped' | 'starting' | 'connected' | 'error'
  url: string | null
  version: string | null
  pid: number | null
  message: string
  updatedAt: number
}

type HealthResponse = {
  healthy?: boolean
  version?: string
}

type SidecarMessage =
  | { type: 'ready' }
  | { type: 'stopped' }
  | { type: 'stdout'; message: string }
  | { type: 'stderr'; message: string }
  | { type: 'error'; error: { message: string; stack?: string } }

type StatusListener = (status: OpenCodeSidecarStatus) => void

export type OpenCodeSidecar = {
  getConnection: () => Promise<OpenCodeConnection>
  getStatus: () => OpenCodeSidecarStatus
  onStatusChange: (listener: StatusListener) => () => void
  restart: () => Promise<OpenCodeSidecarStatus>
  start: () => Promise<OpenCodeSidecarStatus>
  stop: () => Promise<OpenCodeSidecarStatus>
}

const require = createRequire(__filename)
const hostname = '127.0.0.1'
const username = 'opencode'
const serviceName = 'opencode server'
const startupTimeoutMs = 30_000
const shutdownTimeoutMs = 5_000

export function createOpenCodeSidecar(): OpenCodeSidecar {
  let opencodeChildProcess: UtilityProcess | null = null
  let connection: OpenCodeConnection | null = null
  let stopping = false
  let startPromise: Promise<OpenCodeSidecarStatus> | null = null
  let status = createStatus('stopped', 'OpenCode sidecar is not running.')
  const listeners = new Set<StatusListener>()

  function setStatus(next: OpenCodeSidecarStatus): void {
    status = next
    listeners.forEach((listener) => listener(status))
  }

  async function start(): Promise<OpenCodeSidecarStatus> {
    if (startPromise) return startPromise
    if (opencodeChildProcess && status.state === 'connected') return status

    startPromise = startInner().finally(() => {
      startPromise = null
    })

    return startPromise
  }

  async function getConnection(): Promise<OpenCodeConnection> {
    await start()
    if (!connection) throw new Error(status.message)
    return connection
  }

  async function restart(): Promise<OpenCodeSidecarStatus> {
    await stop()
    return start()
  }

  async function stop(): Promise<OpenCodeSidecarStatus> {
    const current = opencodeChildProcess
    if (!current) {
      connection = null
      setStatus(createStatus('stopped', 'OpenCode sidecar is not running.'))
      return status
    }

    stopping = true
    current.postMessage({ type: 'stop' })

    await Promise.race([
      waitForExit(current),
      delay(shutdownTimeoutMs).then(() => {
        current.kill()
      })
    ]).catch(() => undefined)

    opencodeChildProcess = null
    connection = null
    stopping = false
    setStatus(createStatus('stopped', 'OpenCode sidecar stopped.'))
    return status
  }

  function onStatusChange(listener: StatusListener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  async function startInner(): Promise<OpenCodeSidecarStatus> {
    const cliPath = resolveOpenCodeCliPath()
    if (!existsSync(cliPath)) {
      const message = `OpenCode binary was not found at ${cliPath}. Run pnpm approve-builds opencode-ai, then pnpm install.`
      setStatus(createStatus('error', message))
      return status
    }

    const sidecarPath = resolveSidecarPath()
    if (!existsSync(sidecarPath)) {
      const message = `OpenCode sidecar worker was not found at ${sidecarPath}. Run pnpm build.`
      setStatus(createStatus('error', message))
      return status
    }

    const port = await resolvePort()
    const password = randomUUID()
    const url = `http://${hostname}:${port}`
    const nextConnection: OpenCodeConnection = { url, username, password }

    setStatus({
      ...createStatus('starting', 'Starting OpenCode server sidecar...'),
      url,
      pid: null
    })

    const sidecarProcess = utilityProcess.fork(sidecarPath, [], {
      cwd: process.cwd(),
      env: createSidecarEnv(password),
      serviceName,
      stdio: 'pipe'
    })

    opencodeChildProcess = sidecarProcess
    connection = nextConnection

    let exited = false
    const ready = createDeferred<void>()

    sidecarProcess.on('message', (message: SidecarMessage) => {
      if (message.type === 'stdout') {
        console.log(`[opencode] ${message.message}`)
        return
      }

      if (message.type === 'stderr') {
        console.warn(`[opencode] ${message.message}`)
        return
      }

      if (message.type === 'ready') {
        ready.resolve()
        return
      }

      if (message.type === 'error') {
        ready.reject(
          Object.assign(new Error(message.error.message), { stack: message.error.stack })
        )
        if (opencodeChildProcess === sidecarProcess) {
          setStatus(
            createStatus('error', `Failed to start OpenCode sidecar: ${message.error.message}`, url)
          )
        }
        return
      }

      if (message.type === 'stopped') {
        ready.reject(new Error('OpenCode sidecar stopped before it became ready.'))
      }
    })

    sidecarProcess.once('error', (error) => {
      ready.reject(error)
      setStatus(createStatus('error', `Failed to start OpenCode sidecar: ${String(error)}`, url))
    })

    sidecarProcess.once('exit', (code) => {
      exited = true
      if (opencodeChildProcess === sidecarProcess) {
        opencodeChildProcess = null
        connection = null
      }
      if (stopping) return
      ready.reject(new Error(`OpenCode sidecar exited with code ${code ?? 'unknown'}.`))
      setStatus(
        createStatus('error', `OpenCode sidecar exited with code ${code ?? 'unknown'}.`, url)
      )
    })

    sidecarProcess.postMessage({
      type: 'start',
      cliPath,
      hostname,
      port,
      corsOrigins: resolveCorsOrigins()
    })

    try {
      await Promise.race([
        ready.promise,
        delay(startupTimeoutMs).then(() => {
          throw new Error(`OpenCode sidecar did not signal ready within ${startupTimeoutMs}ms.`)
        })
      ])

      const health = await waitForHealth(url, password, () => !exited)
      setStatus({
        state: 'connected',
        url,
        version: health.version ?? null,
        pid: sidecarProcess.pid ?? null,
        message: 'OpenCode server is connected.',
        updatedAt: Date.now()
      })
      console.log(`[opencode] connected to ${url} (${health.version ?? 'unknown version'})`)
    } catch (error) {
      if (opencodeChildProcess === sidecarProcess) {
        sidecarProcess.kill()
        opencodeChildProcess = null
        connection = null
      }

      const message = error instanceof Error ? error.message : String(error)
      setStatus(createStatus('error', message, url))
    }

    return status
  }

  return {
    getConnection,
    getStatus: () => status,
    onStatusChange,
    restart,
    start,
    stop
  }
}

function createStatus(
  state: OpenCodeSidecarStatus['state'],
  message: string,
  url: string | null = null
): OpenCodeSidecarStatus {
  return {
    state,
    url,
    version: null,
    pid: null,
    message,
    updatedAt: Date.now()
  }
}

function createSidecarEnv(password: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENCODE_CLIENT: 'openkhodam-desktop',
    OPENCODE_SERVER_USERNAME: username,
    OPENCODE_SERVER_PASSWORD: password,
    XDG_STATE_HOME: process.env.XDG_STATE_HOME ?? app.getPath('userData')
  }

  return {
    ...env,
    NO_PROXY: withLoopbackNoProxy(env.NO_PROXY),
    no_proxy: withLoopbackNoProxy(env.no_proxy)
  }
}

function withLoopbackNoProxy(value: string | undefined): string {
  const items = (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  for (const item of ['127.0.0.1', 'localhost', '::1']) {
    if (!items.some((current) => current.toLowerCase() === item)) items.push(item)
  }

  return items.join(',')
}

function resolveCorsOrigins(): string[] {
  const configured = parseCorsOrigins(process.env.OPENCODE_CORS_ORIGINS)
  if (configured.length > 0) return configured

  const rendererOrigin = resolveRendererOrigin(process.env.ELECTRON_RENDERER_URL)
  return rendererOrigin ? [rendererOrigin] : []
}

function parseCorsOrigins(value: string | undefined): string[] {
  return unique(
    (value ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
  )
}

function resolveRendererOrigin(rendererUrl: string | undefined): string | undefined {
  if (!rendererUrl) return

  try {
    return new URL(rendererUrl).origin
  } catch {
    return rendererUrl
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function resolveOpenCodeCliPath(): string {
  const packageJsonPath = require.resolve('opencode-ai/package.json')
  const cliPath = join(dirname(packageJsonPath), 'bin', 'opencode.exe')

  if (!app.isPackaged) return cliPath

  return cliPath.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`)
}

function resolveSidecarPath(): string {
  return join(__dirname, 'opencode-sidecar-worker.js')
}

async function resolvePort(): Promise<number> {
  const configured = Number.parseInt(process.env.OPENCODE_PORT ?? '', 10)
  if (Number.isInteger(configured) && configured > 0) return configured

  return new Promise((resolve, reject) => {
    const server = createServer()

    server.once('error', reject)
    server.listen(0, hostname, () => {
      const address = server.address()
      server.close(() => {
        if (typeof address === 'object' && address) {
          resolve(address.port)
        } else {
          reject(new Error('Could not reserve a port for OpenCode sidecar.'))
        }
      })
    })
  })
}

async function waitForHealth(
  url: string,
  password: string,
  isAlive: () => boolean
): Promise<HealthResponse> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < startupTimeoutMs) {
    if (!isAlive()) throw new Error('OpenCode sidecar exited before it became healthy.')

    const health = await checkHealth(url, password)
    if (health?.healthy) return health
    await delay(250)
  }

  throw new Error(`OpenCode sidecar did not become healthy within ${startupTimeoutMs}ms.`)
}

async function checkHealth(url: string, password: string): Promise<HealthResponse | null> {
  try {
    const headers = new Headers()
    const auth = Buffer.from(`${username}:${password}`).toString('base64')
    headers.set('authorization', `Basic ${auth}`)

    const response = await fetch(`${url}/global/health`, {
      headers,
      signal: AbortSignal.timeout(1_000)
    })

    if (!response.ok) return null
    return (await response.json()) as HealthResponse
  } catch {
    return null
  }
}

function waitForExit(current: UtilityProcess): Promise<void> {
  return new Promise((resolve) => {
    current.once('exit', () => resolve())
  })
}

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })

  return { promise, resolve, reject }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
