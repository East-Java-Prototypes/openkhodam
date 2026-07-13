import { describe, expect, it } from 'vitest'
import {
  createOpenKhodamSidecar,
  type ManagedProcess,
  type OpenKhodamSidecarAdapter,
  type WorkerMessage
} from './openkhodam-sidecar'

class FakeProcess implements ManagedProcess {
  pid = 123
  messages: unknown[] = []
  killed = false
  killThrows = false
  exitOnKill = true
  postMessageThrows = false
  private message?: (message: WorkerMessage) => void
  private exits: Array<(value?: unknown) => void> = []
  private errors: Array<(value?: unknown) => void> = []
  postMessage(message: unknown) {
    if (this.postMessageThrows) throw new Error('post failed')
    this.messages.push(message)
  }
  kill() {
    this.killed = true
    if (this.killThrows) throw new Error('kill failed')
    if (this.exitOnKill) this.exit(0)
  }
  on(_event: 'message', listener: (message: WorkerMessage) => void) {
    this.message = listener
  }
  once(event: 'error' | 'exit', listener: (value?: unknown) => void) {
    if (event === 'exit') this.exits.push(listener)
    else this.errors.push(listener)
  }
  ready() {
    this.message?.({ type: 'ready' })
  }
  fail(message: string) {
    this.message?.({ type: 'error', error: { message } })
  }
  stopped() {
    this.message?.({ type: 'stopped' })
    this.exit(0)
  }
  exit(code: number) {
    for (const listener of this.exits) listener(code)
  }
}
function fixture(options: { autoReady?: boolean; timeoutMs?: number } = {}): {
  adapter: OpenKhodamSidecarAdapter
  processes: FakeProcess[]
} {
  const processes: FakeProcess[] = []
  return {
    processes,
    adapter: {
      workerExists: () => true,
      reservePort: async () => 4567,
      version: () => '1.0.0',
      corsOrigins: () => ['file://'],
      startupTimeoutMs: options.timeoutMs,
      shutdownTimeoutMs: options.timeoutMs,
      fork: () => {
        const process = new FakeProcess()
        processes.push(process)
        if (options.autoReady !== false) queueMicrotask(() => process.ready())
        return process
      }
    }
  }
}
describe('OpenKhodam sidecar lifecycle', () => {
  it('serializes concurrent starts and preserves the descriptor through a live restart', async () => {
    const { adapter, processes } = fixture()
    const sidecar = createOpenKhodamSidecar(adapter)
    const [first, second] = await Promise.all([
      sidecar.getRendererConnection(),
      sidecar.getRendererConnection()
    ])
    const restart = sidecar.restart()
    await Promise.resolve()
    processes[0].stopped()
    await expect(restart).resolves.toMatchObject({ state: 'connected' })
    expect(await sidecar.getRendererConnection()).toEqual(first)
    expect(second).toEqual(first)
    expect(processes).toHaveLength(2)
  })

  it('keeps separate renderer and plugin credentials stable across restart', async () => {
    const { adapter, processes } = fixture()
    const sidecar = createOpenKhodamSidecar(adapter)
    const renderer = await sidecar.getRendererConnection()
    const plugin = await sidecar.getPluginConnection()
    expect(renderer.url).toBe(plugin.url)
    expect(renderer.token).not.toBe(plugin.token)

    const restart = sidecar.restart()
    await Promise.resolve()
    processes[0].stopped()
    await restart
    await expect(sidecar.getRendererConnection()).resolves.toEqual(renderer)
    await expect(sidecar.getPluginConnection()).resolves.toEqual(plugin)
    expect(processes[1].messages[0]).toMatchObject({
      type: 'start',
      tokens: expect.arrayContaining([renderer.token, plugin.token])
    })
  })

  it('forces a hung startup worker to terminate after its timeout', async () => {
    const { adapter, processes } = fixture({ autoReady: false, timeoutMs: 1 })
    const sidecar = createOpenKhodamSidecar(adapter)
    await expect(sidecar.start()).resolves.toMatchObject({ state: 'error' })
    expect(processes[0].killed).toBe(true)
  })

  it('forces a hung stop worker to terminate after its timeout', async () => {
    const { adapter, processes } = fixture({ timeoutMs: 1 })
    const sidecar = createOpenKhodamSidecar(adapter)
    await sidecar.start()
    await expect(sidecar.stop()).resolves.toMatchObject({ state: 'stopped' })
    expect(processes[0].killed).toBe(true)
  })

  it('ignores stale exit events from an older worker after restart', async () => {
    const { adapter, processes } = fixture()
    const sidecar = createOpenKhodamSidecar(adapter)
    await sidecar.start()
    const restart = sidecar.restart()
    await Promise.resolve()
    processes[0].stopped()
    await restart
    processes[0].exit(1)
    expect(sidecar.getStatus()).toMatchObject({ state: 'connected', pid: 123 })
  })
  it('keeps an intentional stop out of error status', async () => {
    const { adapter, processes } = fixture()
    const sidecar = createOpenKhodamSidecar(adapter)
    const states: string[] = []
    sidecar.onStatusChange((status) => states.push(status.state))
    await sidecar.start()
    const stopping = sidecar.stop()
    processes[0].stopped()
    await stopping
    expect(states).toEqual(['starting', 'connected', 'stopped'])
    expect(sidecar.getStatus().state).toBe('stopped')
  })
  it('returns error status and cleans up when fork or startup postMessage throws', async () => {
    const { adapter } = fixture()
    adapter.fork = () => {
      throw new Error('fork failed')
    }
    await expect(createOpenKhodamSidecar(adapter).start()).resolves.toMatchObject({
      state: 'error'
    })

    const second = fixture()
    second.adapter.fork = () => {
      const process = new FakeProcess()
      process.postMessageThrows = true
      second.processes.push(process)
      return process
    }
    await expect(createOpenKhodamSidecar(second.adapter).start()).resolves.toMatchObject({
      state: 'error'
    })
    expect(second.processes[0].killed).toBe(true)
  })
  it('surfaces a failed kill without dropping worker ownership', async () => {
    const { adapter, processes } = fixture({ timeoutMs: 1 })
    const sidecar = createOpenKhodamSidecar(adapter)
    await sidecar.start()
    processes[0].killThrows = true
    await expect(sidecar.stop()).resolves.toMatchObject({ state: 'error', message: /force-stop/ })
    expect(processes[0].killed).toBe(true)
    await expect(sidecar.start()).resolves.toMatchObject({
      state: 'error',
      message: /still stopping/
    })
  })

  it('reports unexpected exits as errors', async () => {
    const { adapter, processes } = fixture()
    const sidecar = createOpenKhodamSidecar(adapter)
    await sidecar.start()
    processes[0].exit(1)
    expect(sidecar.getStatus()).toMatchObject({ state: 'error', message: /code 1/ })
  })
})
