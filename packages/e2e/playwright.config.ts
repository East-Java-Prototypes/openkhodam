import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  workers: 1,
  reporter: process.env.CI ? [['list'], ['github']] : [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'on-first-retry'
  }
})
