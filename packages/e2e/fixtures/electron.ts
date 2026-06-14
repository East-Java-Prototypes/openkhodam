import {
  _electron as electron,
  test as base,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startFakeOpenCodeServer, type FakeOpenCodeServer } from './opencode-server'

const testDir = dirname(fileURLToPath(import.meta.url))

type Fixtures = {
  electronApp: ElectronApplication
  appWindow: Page
  fakeOpenCodeServer: FakeOpenCodeServer
}

export const test = base.extend<Fixtures>({
  fakeOpenCodeServer: async ({ browserName }, use) => {
    void browserName
    const server = await startFakeOpenCodeServer()
    await use(server)
    await server.close()
  },

  electronApp: async ({ browserName, fakeOpenCodeServer }, use) => {
    void browserName
    const app = await electron.launch({
      args: [join(testDir, '../../desktop/out/main/index.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        OPENCODE_USE_EXTERNAL_TEST_SERVER: '1',
        OPENCODE_EXTERNAL_TEST_SERVER_URL: fakeOpenCodeServer.url,
        OPENCODE_TEST_SERVER_INTENT: 'e2e',
        OPENCODE_TEST_SERVER_PASSWORD: 'opencode-test-password'
      }
    })

    await use(app)
    await app.close()
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow()
    await use(window)
  }
})

export { expect } from '@playwright/test'
