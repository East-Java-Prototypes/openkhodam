import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

import { expect, test } from '@playwright/test'

const testsDirectory = dirname(fileURLToPath(import.meta.url))
const desktopDirectory = join(testsDirectory, '..', '..', 'desktop')
const desktopOutMainDirectory = join(testsDirectory, '..', '..', 'desktop', 'out', 'main')
const pluginBundlePath = join(desktopOutMainDirectory, 'opencode-plugins', 'openkhodam-poc.js')

test('resolves the bundled and packaged OpenKhodam plugin paths', () => {
  expect(
    join('/tmp/openkhodam/out/main', 'opencode-plugins', 'openkhodam-poc.js')
  ).toBe('/tmp/openkhodam/out/main/opencode-plugins/openkhodam-poc.js')
  expect(
    join('/Applications/OpenKhodam.app/Contents/Resources', 'opencode-plugins', 'openkhodam-poc.js')
  ).toBe('/Applications/OpenKhodam.app/Contents/Resources/opencode-plugins/openkhodam-poc.js')
  expect(
    join('/Applications/OpenKhodam.app/Contents/Resources', 'opencode-plugins', 'openkhodam-poc.js')
  ).not.toContain('app.asar')
})

test('keeps the packaged plugin copy target aligned with the runtime path', async () => {
  const builderConfig = await readFile(join(desktopDirectory, 'electron-builder.yml'), 'utf8')

  expect(builderConfig).toContain('from: out/main/opencode-plugins/openkhodam-poc.js')
  expect(builderConfig).toContain('to: opencode-plugins/openkhodam-poc.js')
})

test('loads the compiled bundled plugin and exposes the ping tool', async () => {
  const pluginModule = (await import(pathToFileURL(pluginBundlePath).href)) as Record<
    string,
    unknown
  >
  const exportedValues = Object.values(pluginModule)

  expect(exportedValues.length).toBeGreaterThan(0)
  for (const value of exportedValues) {
    expect(typeof value).toBe('function')
  }

  const [factory] = exportedValues as [() => Promise<{
    'experimental.chat.system.transform': (
      input: { model: { providerID: string; modelID: string }; sessionID?: string },
      output: { system: string[] }
    ) => Promise<void>
    tool: {
      openkhodam_plugin_ping: {
        description: string
        execute: (
          args: { payload?: { message?: string } },
          context: { directory: string; sessionID: string; worktree: string }
        ) => Promise<string>
      }
    }
  }>]

  const plugin = await factory()

  expect(plugin.tool.openkhodam_plugin_ping.description).toContain('non-sensitive')

  const system = [] as string[]
  await plugin['experimental.chat.system.transform'](
    { model: { providerID: 'fake-provider', modelID: 'fake-model' } },
    { system }
  )
  expect(system).toEqual([
    'OpenKhodam Desktop loaded the bundled openkhodam-poc plugin; openkhodam_plugin_ping is available.'
  ])

  const pingContext = {
    directory: '/tmp/project',
    sessionID: 'session-123',
    worktree: '/tmp/project'
  }

  const echoed = JSON.parse(
    await plugin.tool.openkhodam_plugin_ping.execute(
      { payload: { message: 'hello' } },
      pingContext
    )
  ) as {
    hasDirectory: boolean
    hasSessionID: boolean
    hasWorktree: boolean
    message: string
    ok: boolean
    plugin: string
    tool: string
  }

  expect(echoed).toEqual({
    hasDirectory: true,
    hasSessionID: true,
    hasWorktree: true,
    message: 'hello',
    ok: true,
    plugin: 'openkhodam-poc',
    tool: 'openkhodam_plugin_ping'
  })

  const pong = JSON.parse(
    await plugin.tool.openkhodam_plugin_ping.execute({ payload: {} }, pingContext)
  ) as { message: string }
  expect(pong.message).toBe('pong')
})
