import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { app, utilityProcess } from 'electron'

export type OpenKhodamConnection = { url: string; token: string }
export type OpenKhodamSidecarStatus = {
  state: 'starting' | 'connected' | 'error' | 'stopped'
  url: string | null
  pid: number | null
  message: string
  updatedAt: number
}
export type WorkerMessage =
  | { type: 'ready' }
  | { type: 'stopped' }
  | { type: 'error'; error: { message: string } }
export type ManagedProcess = {
  pid?: number
  postMessage(message: unknown): void
  kill(): void
  on(event: 'message', listener: (message: WorkerMessage) => void): void
  once(event: 'error' | 'exit', listener: (value?: unknown) => void): void
}
export type OpenKhodamSidecarAdapter = {
  workerExists(): boolean
  fork(): ManagedProcess
  reservePort(): Promise<number>
  version(): string
  startupTimeoutMs?: number
  shutdownTimeoutMs?: number
}
export type OpenKhodamSidecar = {
  getConnection(): Promise<OpenKhodamConnection>
  getStatus(): OpenKhodamSidecarStatus
  onStatusChange(listener: (status: OpenKhodamSidecarStatus) => void): () => void
  start(): Promise<OpenKhodamSidecarStatus>
  stop(): Promise<OpenKhodamSidecarStatus>
  restart(): Promise<OpenKhodamSidecarStatus>
}

const hostname = '127.0.0.1'
const defaultStartupTimeoutMs = 30_000
const defaultShutdownTimeoutMs = 5_000

export function createOpenKhodamSidecar(
  adapter: OpenKhodamSidecarAdapter = electronAdapter()
): OpenKhodamSidecar {
  const connection = { url: `http://${hostname}:0`, token: randomUUID() }
  const startupTimeoutMs = adapter.startupTimeoutMs ?? defaultStartupTimeoutMs
  const shutdownTimeoutMs = adapter.shutdownTimeoutMs ?? defaultShutdownTimeoutMs
  let child: ManagedProcess | undefined
  let status = makeStatus('stopped', 'OpenKhodam sidecar is not running.')
  let queue = Promise.resolve()
  let generation = 0
  let stoppingGeneration: number | undefined
  const listeners = new Set<(status: OpenKhodamSidecarStatus) => void>()
  const set = (next: OpenKhodamSidecarStatus) => {
    status = next
    listeners.forEach((listener) => listener(next))
  }
  const enqueue = <T>(fn: () => Promise<T>) => {
    const result = queue.then(fn, fn)
    queue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  const startDirect = async (): Promise<OpenKhodamSidecarStatus> => {
    if (child && status.state === 'connected') return status
    if (child)
      return setAndReturn(
        makeStatus('error', 'OpenKhodam sidecar is still stopping.', connection.url)
      )
    if (!adapter.workerExists())
      return setAndReturn(
        makeStatus('error', 'OpenKhodam sidecar worker was not found. Run pnpm build.')
      )
    try {
      if (connection.url.endsWith(':0'))
        connection.url = `http://${hostname}:${await adapter.reservePort()}`
    } catch (error) {
      return setAndReturn(makeStatus('error', errorMessage(error), connection.url))
    }

    set({ ...makeStatus('starting', 'Starting OpenKhodam sidecar...', connection.url), pid: null })
    let current: ManagedProcess
    try {
      current = adapter.fork()
    } catch (error) {
      return setAndReturn(
        makeStatus(
          'error',
          `Failed to fork OpenKhodam sidecar: ${errorMessage(error)}`,
          connection.url
        )
      )
    }
    const currentGeneration = ++generation
    child = current
    const ready = deferred<void>()
    const isCurrent = () => child === current && generation === currentGeneration
    current.on('message', (message) => {
      if (!isCurrent()) return
      if (message.type === 'ready') ready.resolve()
      if (message.type === 'error' && stoppingGeneration !== currentGeneration)
        ready.reject(new Error(message.error.message))
      if (message.type === 'stopped' && stoppingGeneration !== currentGeneration)
        ready.reject(new Error('OpenKhodam sidecar stopped before ready.'))
    })
    current.once('error', (error) => {
      if (isCurrent()) ready.reject(error)
    })
    current.once('exit', (code) => {
      if (!isCurrent()) return
      child = undefined
      if (stoppingGeneration === currentGeneration) return
      const message = `OpenKhodam sidecar exited with code ${String(code ?? 'unknown')}.`
      ready.reject(new Error(message))
      set(makeStatus('error', message, connection.url))
    })
    try {
      current.postMessage({
        type: 'start',
        token: connection.token,
        version: adapter.version(),
        port: Number(new URL(connection.url).port)
      })
      await withTimeout(
        ready.promise,
        startupTimeoutMs,
        `OpenKhodam sidecar did not signal ready within ${startupTimeoutMs}ms.`
      )
      if (isCurrent())
        set({
          state: 'connected',
          url: connection.url,
          pid: current.pid ?? null,
          message: 'OpenKhodam sidecar is connected.',
          updatedAt: Date.now()
        })
    } catch (error) {
      stoppingGeneration = currentGeneration
      await terminate(
        current,
        currentGeneration,
        `Failed to stop OpenKhodam sidecar after startup failure: `
      )
      if (generation === currentGeneration)
        set(makeStatus('error', errorMessage(error), connection.url))
    }
    return status
  }

  const stopDirect = async (): Promise<OpenKhodamSidecarStatus> => {
    const current = child
    if (!current)
      return setAndReturn(
        makeStatus('stopped', 'OpenKhodam sidecar is not running.', connection.url)
      )
    const currentGeneration = generation
    stoppingGeneration = currentGeneration
    const exited = waitForExit(current)
    try {
      current.postMessage({ type: 'stop' })
      await withTimeout(exited, shutdownTimeoutMs, 'OpenKhodam sidecar did not stop in time.')
    } catch (error) {
      const terminationError = await terminate(
        current,
        currentGeneration,
        'Failed to force-stop OpenKhodam sidecar: '
      )
      if (terminationError)
        return setAndReturn(makeStatus('error', terminationError, connection.url))
      if (error instanceof Error && error.message !== 'OpenKhodam sidecar did not stop in time.')
        return setAndReturn(makeStatus('error', error.message, connection.url))
    }
    if (child === current && generation === currentGeneration) {
      return setAndReturn(
        makeStatus(
          'error',
          'OpenKhodam sidecar stop completed without an exit event.',
          connection.url
        )
      )
    }
    return setAndReturn(makeStatus('stopped', 'OpenKhodam sidecar stopped.', connection.url))
  }

  async function terminate(
    current: ManagedProcess,
    currentGeneration: number,
    prefix: string
  ): Promise<string | undefined> {
    const exited = waitForExit(current)
    try {
      current.kill()
    } catch (error) {
      return `${prefix}${errorMessage(error)}`
    }
    try {
      await withTimeout(exited, shutdownTimeoutMs, 'worker did not exit after kill.')
    } catch (error) {
      return `${prefix}${errorMessage(error)}`
    }
    if (child === current && generation === currentGeneration)
      return `${prefix}worker exit was not observed.`
    return undefined
  }

  const setAndReturn = (next: OpenKhodamSidecarStatus) => {
    set(next)
    return status
  }
  const start = () => enqueue(startDirect)
  const stop = (): Promise<OpenKhodamSidecarStatus> => {
    const current = child
    if (current) stoppingGeneration = generation
    return enqueue(stopDirect)
  }
  const restart = () =>
    enqueue(async () => {
      await stopDirect()
      return startDirect()
    })
  return {
    getConnection: async () => {
      await start()
      if (status.state !== 'connected') throw new Error(status.message)
      return { ...connection }
    },
    getStatus: () => status,
    onStatusChange: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start,
    stop,
    restart
  }
}

function electronAdapter(): OpenKhodamSidecarAdapter {
  return {
    workerExists: () => existsSync(join(__dirname, 'openkhodam-sidecar-worker.js')),
    fork: () =>
      utilityProcess.fork(join(__dirname, 'openkhodam-sidecar-worker.js'), [], {
        cwd: process.cwd(),
        serviceName: 'openkhodam server',
        stdio: 'pipe'
      }) as unknown as ManagedProcess,
    reservePort,
    version: () => app.getVersion()
  }
}
function makeStatus(
  state: OpenKhodamSidecarStatus['state'],
  message: string,
  url: string | null = null
): OpenKhodamSidecarStatus {
  return { state, url, pid: null, message, updatedAt: Date.now() }
}
function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, hostname, () => {
      const address = server.address()
      server.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('Could not reserve an OpenKhodam port.'))
      )
    })
  })
}
function waitForExit(process: ManagedProcess): Promise<void> {
  return new Promise((resolve) => process.once('exit', () => resolve()))
}
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(message)), timeoutMs))
  ])
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
  reject(reason?: unknown): void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((r, j) => {
    resolve = r
    reject = j
  })
  return { promise, resolve, reject }
}
