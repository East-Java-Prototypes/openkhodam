import { startOpenKhodamServer, type OpenKhodamListener } from '@openkhodam/server'

type StartCommand = {
  type: 'start'
  rendererTokens: string[]
  pluginTokens: string[]
  version: string
  port: number
  corsOrigins: string[]
}
type StopCommand = { type: 'stop' }
type Command = StartCommand | StopCommand
type Message =
  | { type: 'ready' }
  | { type: 'stopped' }
  | { type: 'error'; error: { message: string; stack?: string } }

type ParentPort = {
  postMessage(message: Message): void
  on(event: 'message', listener: (event: { data: unknown }) => void): void
}

const parentPort = getParentPort()
let listener: OpenKhodamListener | undefined

parentPort.on('message', (event) => {
  const command = parseCommand(event.data)
  if (!command) return
  if (command.type === 'stop') {
    void stop()
    return
  }
  void start(command)
})

async function start(command: StartCommand): Promise<void> {
  try {
    if (listener) throw new Error('OpenKhodam sidecar is already running.')
    listener = await startOpenKhodamServer({
      rendererTokens: command.rendererTokens,
      pluginTokens: command.pluginTokens,
      version: command.version,
      port: command.port,
      corsOrigins: command.corsOrigins
    })
    parentPort.postMessage({ type: 'ready' })
  } catch (error) {
    parentPort.postMessage({ type: 'error', error: serializeError(error) })
  }
}

async function stop(): Promise<void> {
  try {
    await listener?.close()
    listener = undefined
    parentPort.postMessage({ type: 'stopped' })
    process.exit(0)
  } catch (error) {
    parentPort.postMessage({ type: 'error', error: serializeError(error) })
    process.exit(1)
  }
}

function parseCommand(value: unknown): Command | undefined {
  if (!value || typeof value !== 'object') return
  const command = value as Partial<StartCommand | StopCommand>
  if (command.type === 'stop') return { type: 'stop' }
  if (
    command.type === 'start' &&
    Array.isArray(command.rendererTokens) &&
    command.rendererTokens.every((token) => typeof token === 'string') &&
    Array.isArray(command.pluginTokens) &&
    command.pluginTokens.every((token) => typeof token === 'string') &&
    typeof command.version === 'string' &&
    typeof command.port === 'number' &&
    Array.isArray(command.corsOrigins) &&
    command.corsOrigins.every((origin) => typeof origin === 'string')
  ) {
    return {
      type: 'start',
      rendererTokens: command.rendererTokens,
      pluginTokens: command.pluginTokens,
      version: command.version,
      port: command.port,
      corsOrigins: command.corsOrigins
    }
  }
  return undefined
}

function serializeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: error.message, stack: error.stack }
  return { message: String(error) }
}

function getParentPort(): ParentPort {
  const port = process.parentPort as ParentPort | undefined
  if (!port) throw new Error('OpenKhodam sidecar parent port unavailable.')
  return port
}
