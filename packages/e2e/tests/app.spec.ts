import { expect, test } from '../fixtures/electron'

test('renders the initial desktop UI', async ({ appWindow }) => {
  await expect(appWindow.getByRole('heading', { name: 'Project chats' })).toBeVisible()
  await expect(appWindow.getByText('Active chat')).toBeVisible()
  await expect(appWindow.getByText('Mock data')).toBeVisible()
})
