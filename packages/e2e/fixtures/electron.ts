import {
  _electron as electron,
  test as base,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { startFakeOpenCodeServer, type FakeOpenCodeServer } from './opencode-server'

const testDir = dirname(fileURLToPath(import.meta.url))

type Fixtures = {
  electronApp: ElectronApplication
  appWindow: Page
  fakeOpenCodeServer: FakeOpenCodeServer
}

type Options = {
  googleWorkspaceClientId: string | undefined
  googleWorkspaceClientSecret: string | undefined
}

export const test = base.extend<Fixtures & Options>({
  googleWorkspaceClientId: [undefined, { option: true }],
  googleWorkspaceClientSecret: [undefined, { option: true }],

  fakeOpenCodeServer: async ({ browserName }, use) => {
    void browserName
    const server = await startFakeOpenCodeServer()
    await use(server)
    await server.close()
  },

  electronApp: async (
    { browserName, fakeOpenCodeServer, googleWorkspaceClientId, googleWorkspaceClientSecret },
    use
  ) => {
    void browserName
    const configHome = await mkdtemp(join(tmpdir(), 'openkhodam-e2e-config-'))
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'test',
      OPENCODE_USE_EXTERNAL_TEST_SERVER: '1',
      OPENCODE_EXTERNAL_TEST_SERVER_URL: fakeOpenCodeServer.url,
      XDG_CONFIG_HOME: configHome,
      OPENCODE_TEST_SERVER_INTENT: 'e2e',
      OPENCODE_TEST_SERVER_PASSWORD: 'opencode-test-password'
    }

    delete env.OPENKHODAM_GOOGLE_OAUTH_CLIENT_ID
    delete env.OPENKHODAM_GOOGLE_OAUTH_CLIENT_SECRET

    if (googleWorkspaceClientId) {
      env.OPENKHODAM_GOOGLE_OAUTH_CLIENT_ID = googleWorkspaceClientId
    }

    if (googleWorkspaceClientSecret) {
      env.OPENKHODAM_GOOGLE_OAUTH_CLIENT_SECRET = googleWorkspaceClientSecret
    }

    const app = await electron.launch({
      args: [join(testDir, '../../desktop/out/main/index.js')],
      env
    })

    await use(app)
    await app.close()
    await rm(configHome, { recursive: true, force: true })
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow()
    await use(window)
  }
})

export { expect } from '@playwright/test'
