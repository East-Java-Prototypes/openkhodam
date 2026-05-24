import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { dirname, join, sep } from 'node:path'
import { app } from 'electron'

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

type StatusListener = (status: OpenCodeSidecarStatus) => void

export type OpenCodeSidecar = {
  getStatus: () => OpenCodeSidecarStatus
  onStatusChange: (listener: StatusListener) => () => void
  restart: () => Promise<OpenCodeSidecarStatus>
  start: () => Promise<OpenCodeSidecarStatus>
  stop: () => Promise<OpenCodeSidecarStatus>
}

const require = createRequire(__filename)
const hostname = '127.0.0.1'
const username = 'opencode'
const startupTimeoutMs = 30_000
const shutdownTimeoutMs = 5_000

export function createOpenCodeSidecar(): OpenCodeSidecar {
  let child: ChildProcess | null = null
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
    if (child && status.state === 'connected') return status

    startPromise = startInner().finally(() => {
      startPromise = null
    })

    return startPromise
  }

  async function restart(): Promise<OpenCodeSidecarStatus> {
    await stop()
    return start()
  }

  async function stop(): Promise<OpenCodeSidecarStatus> {
    const current = child
    if (!current) {
      setStatus(createStatus('stopped', 'OpenCode sidecar is not running.'))
      return status
    }

    stopping = true
    current.kill()

    await Promise.race([waitForExit(current), delay(shutdownTimeoutMs)]).catch(() => undefined)

    if (!current.killed) current.kill('SIGKILL')

    child = null
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

    const port = await resolvePort()
    const password = randomUUID()
    const url = `http://${hostname}:${port}`

    setStatus({
      ...createStatus('starting', 'Starting OpenCode server sidecar...'),
      url,
      pid: null
    })

    const nextChild = spawn(
      cliPath,
      [
        'serve',
        '--hostname',
        hostname,
        '--port',
        String(port),
        '--print-logs',
        '--log-level',
        'WARN'
      ],
      {
        cwd: process.cwd(),
        env: createSidecarEnv(password),
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )

    child = nextChild

    nextChild.stdout?.on('data', (chunk: Buffer) => {
      const message = chunk.toString('utf8').trim()
      if (message) console.log(`[opencode] ${message}`)
    })

    nextChild.stderr?.on('data', (chunk: Buffer) => {
      const message = chunk.toString('utf8').trim()
      if (message) console.warn(`[opencode] ${message}`)
    })

    nextChild.once('error', (error) => {
      setStatus(createStatus('error', `Failed to start OpenCode sidecar: ${error.message}`, url))
    })

    nextChild.once('exit', (code, signal) => {
      if (child === nextChild) child = null
      if (stopping) return
      const detail = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`
      setStatus(createStatus('error', `OpenCode sidecar exited with ${detail}.`, url))
    })

    try {
      const health = await waitForHealth(url, password, nextChild)
      setStatus({
        state: 'connected',
        url,
        version: health.version ?? null,
        pid: nextChild.pid ?? null,
        message: 'OpenCode server is connected.',
        updatedAt: Date.now()
      })
      console.log(`[opencode] connected to ${url} (${health.version ?? 'unknown version'})`)
    } catch (error) {
      if (child === nextChild) {
        nextChild.kill()
        child = null
      }

      const message = error instanceof Error ? error.message : String(error)
      setStatus(createStatus('error', message, url))
    }

    return status
  }

  return {
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

function resolveOpenCodeCliPath(): string {
  const packageJsonPath = require.resolve('opencode-ai/package.json')
  const cliPath = join(dirname(packageJsonPath), 'bin', 'opencode.exe')

  if (!app.isPackaged) return cliPath

  return cliPath.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`)
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
  current: ChildProcess
): Promise<HealthResponse> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < startupTimeoutMs) {
    if (current.exitCode !== null || current.signalCode !== null) {
      throw new Error('OpenCode sidecar exited before it became healthy.')
    }

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

function waitForExit(current: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    current.once('exit', () => resolve())
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
