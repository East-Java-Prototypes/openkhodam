import { spawn, type ChildProcess } from 'node:child_process'

type StartCommand = {
  type: 'start'
  cliPath: string
  hostname: string
  port: number
  corsOrigins: string[]
}

type StopCommand = {
  type: 'stop'
}

type SidecarCommand = StartCommand | StopCommand

type SidecarMessage =
  | { type: 'ready' }
  | { type: 'stopped' }
  | { type: 'stdout'; message: string }
  | { type: 'stderr'; message: string }
  | { type: 'error'; error: { message: string; stack?: string } }

type ParentPort = {
  postMessage(message: SidecarMessage): void
  on(event: 'message', listener: (event: { data: unknown }) => void): void
}

const parentPort = getParentPort()
let child: ChildProcess | null = null
let stopping = false

parentPort.on('message', (event) => {
  const command = parseCommand(event.data)
  if (!command) return

  if (command.type === 'stop') {
    stop()
    return
  }

  start(command)
})

function start(command: StartCommand): void {
  try {
    if (child) throw new Error('OpenCode sidecar is already running.')

    child = spawn(command.cliPath, createArgs(command), {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    child.stdout?.on('data', (chunk: Buffer) => {
      const message = chunk.toString('utf8').trim()
      if (!message) return

      parentPort.postMessage({ type: 'stdout', message })
      if (message.includes('opencode server listening')) {
        parentPort.postMessage({ type: 'ready' })
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      const message = chunk.toString('utf8').trim()
      if (message) parentPort.postMessage({ type: 'stderr', message })
    })

    child.once('error', (error) => {
      parentPort.postMessage({ type: 'error', error: serializeError(error) })
    })

    child.once('exit', (code) => {
      child = null
      parentPort.postMessage({ type: 'stopped' })
      setImmediate(() => process.exit(stopping ? 0 : (code ?? 0)))
    })
  } catch (error) {
    parentPort.postMessage({ type: 'error', error: serializeError(error) })
    setImmediate(() => process.exit(1))
  }
}

function stop(): void {
  stopping = true

  if (!child) {
    parentPort.postMessage({ type: 'stopped' })
    setImmediate(() => process.exit(0))
    return
  }

  child.kill()
}

function createArgs(command: StartCommand): string[] {
  return [
    'serve',
    '--hostname',
    command.hostname,
    '--port',
    String(command.port),
    '--print-logs',
    '--log-level',
    'WARN',
    ...command.corsOrigins.flatMap((origin) => ['--cors', origin])
  ]
}

function parseCommand(value: unknown): SidecarCommand | undefined {
  if (!value || typeof value !== 'object') return

  const command = value as Partial<StartCommand | StopCommand>
  if (command.type === 'stop') return { type: 'stop' }
  if (command.type !== 'start') return
  if (typeof command.cliPath !== 'string') return
  if (typeof command.hostname !== 'string') return
  if (typeof command.port !== 'number') return
  if (!Array.isArray(command.corsOrigins)) return
  if (!command.corsOrigins.every((origin) => typeof origin === 'string')) return

  return {
    type: 'start',
    cliPath: command.cliPath,
    hostname: command.hostname,
    port: command.port,
    corsOrigins: command.corsOrigins
  }
}

function serializeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: error.message, stack: error.stack }
  return { message: String(error) }
}

function getParentPort(): ParentPort {
  const port = process.parentPort as ParentPort | undefined
  if (!port) throw new Error('OpenCode sidecar parent port unavailable.')
  return port
}
