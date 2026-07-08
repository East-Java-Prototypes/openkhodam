import {
  _electron as electron,
  test as base,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import {
  fakeAssistantResponse,
  fakeProviderID,
  fakeProviderModelID,
  fakeProviderModelName,
  fakeProviderName,
  startFakeProvider,
  type FakeProviderServer
} from './fake-provider'

const testDir = dirname(fileURLToPath(import.meta.url))
const appEntryPoint = join(testDir, '../../desktop/out/main/index.js')
const execFileAsync = promisify(execFile)

type RealOpenCodeFixtures = {
  realOpenCode: RealOpenCodeContext
  electronApp: ElectronApplication
  appWindow: Page
}

export type RealOpenCodeContext = {
  assistantResponse: string
  fakeProvider: FakeProviderServer
  modelID: string
  modelLabel: string
  profileDir: string
  providerID: string
  tempRoot: string
  workspaceDir: string
  workspaceName: string
}

export const test = base.extend<RealOpenCodeFixtures>({
  realOpenCode: async ({ browserName }, use) => {
    void browserName
    const tempRoot = await mkdtemp(join(tmpdir(), 'openkhodam-real-opencode-'))
    const profileDir = join(tempRoot, 'profile')
    const workspaceDir = join(tempRoot, 'workspace')
    let fakeProvider: FakeProviderServer | null = null

    try {
      fakeProvider = await startFakeProvider()
      await mkdir(workspaceDir, { recursive: true })
      await mkdir(profileDir, { recursive: true })
      await writeFile(join(workspaceDir, 'README.md'), '# OpenKhodam real sidecar smoke workspace\n')
      await execFileAsync('git', ['init', '--quiet'], { cwd: workspaceDir })
      await writeFile(
        join(workspaceDir, 'opencode.json'),
        `${JSON.stringify(createOpenCodeConfig(fakeProvider.url), null, 2)}\n`,
        'utf8'
      )

      await use({
        assistantResponse: fakeAssistantResponse,
        fakeProvider,
        modelID: fakeProviderModelID,
        modelLabel: `${fakeProviderName} · ${fakeProviderModelName}`,
        profileDir,
        providerID: fakeProviderID,
        tempRoot,
        workspaceDir,
        workspaceName: 'workspace'
      })
    } finally {
      await fakeProvider?.close()
      await rm(tempRoot, { recursive: true, force: true })
    }
  },

  electronApp: async ({ realOpenCode }, use) => {
    const app = await electron.launch({
      args: [...headlessLinuxArgs(), appEntryPoint],
      cwd: realOpenCode.workspaceDir,
      env: createElectronEnv(realOpenCode)
    })

    try {
      await use(app)
    } finally {
      await app.close()
    }
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow()
    await use(window)
  }
})

function createOpenCodeConfig(fakeProviderUrl: string): unknown {
  return {
    $schema: 'https://opencode.ai/config.json',
    enabled_providers: [fakeProviderID],
    model: `${fakeProviderID}/${fakeProviderModelID}`,
    small_model: `${fakeProviderID}/${fakeProviderModelID}`,
    provider: {
      [fakeProviderID]: {
        name: fakeProviderName,
        npm: '@ai-sdk/openai-compatible',
        options: {
          apiKey: 'openkhodam-e2e-fake-key',
          baseURL: fakeProviderUrl,
          timeout: 15_000
        },
        models: {
          [fakeProviderModelID]: {
            name: fakeProviderModelName,
            attachment: false,
            reasoning: false,
            temperature: true,
            tool_call: false,
            limit: { context: 4096, output: 1024 }
          }
        }
      }
    }
  }
}

function createElectronEnv(realOpenCode: RealOpenCodeContext): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  clearOpenCodeEnv(env)
  clearExternalProviderEnv(env)

  return {
    ...env,
    HOME: realOpenCode.profileDir,
    NODE_ENV: 'test',
    OPENCODE_AUTH_CONTENT: '{}',
    OPENCODE_CONFIG_CONTENT: JSON.stringify(createOpenCodeConfig(realOpenCode.fakeProvider.url)),
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_MODELS_FETCH: '1',
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_TEST_SERVER_INTENT: 'e2e',
    XDG_CACHE_HOME: join(realOpenCode.profileDir, 'cache'),
    XDG_CONFIG_HOME: join(realOpenCode.profileDir, 'config'),
    XDG_DATA_HOME: join(realOpenCode.profileDir, 'data'),
    XDG_STATE_HOME: join(realOpenCode.profileDir, 'state')
  }
}

function clearOpenCodeEnv(env: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(env)) {
    if (key.startsWith('OPENCODE_')) delete env[key]
  }
}

function clearExternalProviderEnv(env: NodeJS.ProcessEnv): void {
  delete env.OPENAI_API_KEY
  delete env.ANTHROPIC_API_KEY
  delete env.GOOGLE_GENERATIVE_AI_API_KEY
  delete env.GOOGLE_VERTEX_PROJECT
  delete env.GROQ_API_KEY
  delete env.OPENROUTER_API_KEY
  delete env.XAI_API_KEY
  delete env.CEREBRAS_API_KEY
  delete env.TOGETHER_API_KEY
  delete env.OPENKHODAM_GOOGLE_OAUTH_CLIENT_ID
  delete env.OPENKHODAM_GOOGLE_OAUTH_CLIENT_SECRET
}

function headlessLinuxArgs(): string[] {
  if (process.platform !== 'linux' || process.env.DISPLAY) return []
  return ['--disable-gpu', '--ozone-platform=headless']
}

export { expect } from '@playwright/test'
