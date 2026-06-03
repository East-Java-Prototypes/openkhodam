import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = dirname(fileURLToPath(import.meta.url))

type Fixtures = {
  electronApp: ElectronApplication
  appWindow: Page
}

export const test = base.extend<Fixtures>({
  electronApp: async ({ browserName }, use) => {
    void browserName
    const app = await electron.launch({
      args: [join(testDir, '../../desktop/out/main/index.js')],
      env: process.env
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
