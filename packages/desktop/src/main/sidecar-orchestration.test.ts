import { describe, expect, it } from 'vitest'
import { createQuitCleanup, startSidecars } from './sidecar-orchestration'

describe('sidecar orchestration', () => {
  it('starts OpenCode after an OpenKhodam startup error', async () => {
    const calls: string[] = []
    await startSidecars(
      { start: async () => (calls.push('openkhodam'), Promise.reject(new Error('failed'))) },
      { start: async () => void calls.push('opencode') }
    )
    expect(calls).toEqual(['openkhodam', 'opencode'])
  })

  it('stops both sidecars and exits exactly once across failures and repeated quit events', async () => {
    const calls: string[] = []
    let resolveExit!: () => void
    const exited = new Promise<void>((resolve) => {
      resolveExit = resolve
    })
    const quit = createQuitCleanup(
      { stop: async () => (calls.push('opencode'), Promise.reject(new Error('failed'))) },
      { stop: async () => void calls.push('openkhodam') },
      () => {
        calls.push('exit')
        resolveExit()
      }
    )
    quit()
    quit()
    await exited
    expect(calls).toEqual(['opencode', 'openkhodam', 'exit'])
  })

  it('ignores every reentrant quit while cleanup is pending', async () => {
    const calls: string[] = []
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    let resolveExit!: () => void
    const exited = new Promise<void>((resolve) => {
      resolveExit = resolve
    })
    const quit = createQuitCleanup(
      { stop: async () => (calls.push('opencode'), pending) },
      { stop: async () => void calls.push('openkhodam') },
      () => {
        calls.push('exit')
        resolveExit()
      }
    )
    quit()
    quit()
    await Promise.resolve()
    expect(calls).toEqual(['opencode'])
    release()
    quit()
    await exited
    expect(calls).toEqual(['opencode', 'openkhodam', 'exit'])
  })
})
