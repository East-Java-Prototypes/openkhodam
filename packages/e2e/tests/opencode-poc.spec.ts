import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

import { expect, test } from '@playwright/test'

const testsDirectory = dirname(fileURLToPath(import.meta.url))
const desktopDirectory = join(testsDirectory, '..', '..', 'desktop')
const desktopOutDirectory = join(desktopDirectory, 'out')
const builtPluginPath = join(desktopOutDirectory, 'opencode-plugins', 'openkhodam-poc.mjs')
const sourcePluginPath = join(
  desktopDirectory,
  'src',
  'main',
  'opencode-plugins',
  'openkhodam-poc.ts'
)
const toolName = 'openkhodam_plugin_ping'

type OpenKhodamPocPlugin = {
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
}

test('resolves the bundled and packaged OpenKhodam plugin paths', () => {
  expect(sourcePluginPath).toBe(
    join(desktopDirectory, 'src', 'main', 'opencode-plugins', 'openkhodam-poc.ts')
  )
  expect(builtPluginPath).toBe(join(desktopOutDirectory, 'opencode-plugins', 'openkhodam-poc.mjs'))

  const resourcesPath = join('/Applications', 'OpenKhodam.app', 'Contents', 'Resources')
  const packagedPluginPath = join(resourcesPath, 'opencode-plugins', 'openkhodam-poc.mjs')
  expect(packagedPluginPath).toBe(
    '/Applications/OpenKhodam.app/Contents/Resources/opencode-plugins/openkhodam-poc.mjs'
  )
  expect(packagedPluginPath).not.toContain('app.asar')
})

test('keeps the packaged plugin copy target aligned with the runtime path', async () => {
  const builderConfig = await readFile(join(desktopDirectory, 'electron-builder.yml'), 'utf8')

  expect(builderConfig).toContain('from: out/opencode-plugins/openkhodam-poc.mjs')
  expect(builderConfig).toContain('to: opencode-plugins/openkhodam-poc.mjs')
})

test('loads the ESM bundled plugin with the OpenCode loader-compatible module shape', async () => {
  const pluginModule = (await import(pathToFileURL(builtPluginPath).href)) as Record<
    string,
    unknown
  >

  expect(Object.keys(pluginModule)).toEqual(['OpenKhodamPoc'])
  expect(typeof pluginModule.OpenKhodamPoc).toBe('function')

  const plugin = await (pluginModule.OpenKhodamPoc as () => Promise<OpenKhodamPocPlugin>)()

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
    await plugin.tool.openkhodam_plugin_ping.execute({ payload: { message: 'hello' } }, pingContext)
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
    tool: toolName
  })

  const pong = JSON.parse(
    await plugin.tool.openkhodam_plugin_ping.execute({ payload: {} }, pingContext)
  ) as { message: string }
  expect(pong.message).toBe('pong')
})

test('registers the ping tool from the ESM artifact through the real OpenCode loader', async () => {
  test.setTimeout(90_000)

  await expectOpenCodeLoadsPlugin(builtPluginPath)
})

test('registers the ping tool from the TS source through the real OpenCode loader', async () => {
  test.setTimeout(90_000)

  await expectOpenCodeLoadsPlugin(sourcePluginPath)
})

async function expectOpenCodeLoadsPlugin(pluginPath: string): Promise<void> {
  const userDataPath = await mkdtemp(join(tmpdir(), 'openkhodam-opencode-loader-'))
  const runtimeConfigPath = join(userDataPath, 'opencode-sidecar', 'runtime-opencode-config.json')

  await mkdir(dirname(runtimeConfigPath), { recursive: true })
  await writeFile(
    runtimeConfigPath,
    `${JSON.stringify(
      {
        $schema: 'https://opencode.ai/config.json',
        plugin: [pluginPath]
      },
      null,
      2
    )}\n`,
    'utf8'
  )

  const server = await startOpenCodeServe(createOpenCodeSmokeEnv(userDataPath, runtimeConfigPath))

  try {
    const response = await fetch(`${server.url}/experimental/tool/ids`)
    const body = await response.text()

    expect(response.status, `${body}\n${server.logs()}`).toBe(200)
    expect(JSON.parse(body) as string[]).toContain(toolName)
    expect(server.logs()).not.toMatch(/failed to load plugin/i)
  } finally {
    await server.stop()
    await rm(userDataPath, { recursive: true, force: true })
  }
}

function createOpenCodeSmokeEnv(
  userDataPath: string,
  runtimeConfigPath: string
): NodeJS.ProcessEnv {
  const profileDir = join(userDataPath, 'opencode-sidecar')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: userDataPath,
    OPENCODE_AUTH_CONTENT: '{}',
    OPENCODE_CLIENT: 'openkhodam-desktop',
    OPENCODE_CONFIG: runtimeConfigPath,
    OPENCODE_CONFIG_DIR: join(profileDir, 'config'),
    OPENCODE_DISABLE_AUTOCOMPACT: '1',
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_MODELS_FETCH: '1',
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    XDG_CACHE_HOME: join(profileDir, 'cache'),
    XDG_CONFIG_HOME: join(profileDir, 'config'),
    XDG_DATA_HOME: join(profileDir, 'data'),
    XDG_STATE_HOME: join(profileDir, 'state')
  }

  delete env.OPENCODE_CONFIG_CONTENT
  delete env.OPENCODE_PURE

  return env
}

async function startOpenCodeServe(env: NodeJS.ProcessEnv): Promise<{
  logs: () => string
  stop: () => Promise<void>
  url: string
}> {
  const child = spawn(
    'pnpm',
    ['exec', 'opencode', 'serve', '--hostname', '127.0.0.1', '--port', '0', '--print-logs'],
    {
      cwd: desktopDirectory,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )

  let logs = ''

  const url = await new Promise<string>((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      fail(new Error(`opencode serve did not start within 30s.\n${logs}`))
    }, 30_000)

    function finish(value: string): void {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(value)
    }

    function fail(error: Error): void {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      child.kill()
      reject(error)
    }

    function append(chunk: Buffer): void {
      logs += chunk.toString()
      const match = /opencode server listening on (https?:\/\/[^\s]+)/.exec(logs)
      if (match?.[1]) finish(match[1])
    }

    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.once('error', fail)
    child.once('exit', (code) => {
      fail(new Error(`opencode serve exited before becoming ready: ${code ?? 'unknown'}.\n${logs}`))
    })
  })

  return {
    logs: () => logs,
    stop: () => stopProcess(child),
    url
  }
}

async function stopProcess(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null) return

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 5_000)

    child.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })

    child.kill()
  })
}
