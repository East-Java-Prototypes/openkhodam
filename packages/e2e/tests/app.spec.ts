import { expect, test } from '../fixtures/electron'

test('renders the built desktop app shell', async ({ appWindow }) => {
  await expect(appWindow.getByRole('link', { name: 'Home' })).toBeVisible()
  await expect(appWindow.getByRole('link', { name: 'Settings', exact: true })).toBeVisible()
  await expect(appWindow.getByRole('heading', { name: 'Project chats' })).toBeVisible()
  await expect(appWindow.getByText('Active chat')).toBeVisible()
  await expect(appWindow.getByRole('textbox', { name: 'Message OpenKhodam' })).toBeDisabled()
})

test('shows the real OpenCode sidecar settings surface', async ({ appWindow }) => {
  await appWindow.getByRole('link', { name: 'Settings', exact: true }).click()

  await expect(appWindow.getByRole('heading', { name: 'OpenCode Server' })).toBeVisible()
  await expect(appWindow.getByText(/^Status:/)).toBeVisible()
  await expect(appWindow.getByText(/^Message:/)).toBeVisible()
  await expect(appWindow.getByText(/^Endpoint:/)).toBeVisible()
  await expect(appWindow.getByText('Renderer Origin', { exact: true })).toBeVisible()
  await expect(appWindow.getByText('Renderer HTTP', { exact: true })).toBeVisible()
  await expect(appWindow.getByRole('button', { name: /^(Restart|Restarting)$/ })).toBeVisible()
})
