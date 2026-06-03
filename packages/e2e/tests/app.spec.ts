import { expect, test } from '../fixtures/electron'

const repositoryDirectory = process.cwd()

test('renders the built desktop app shell', async ({ appWindow }) => {
  await expect(appWindow.getByRole('link', { name: 'Home' })).toBeVisible()
  await expect(appWindow.getByRole('link', { name: 'Settings', exact: true })).toBeVisible()
  await expect(appWindow.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
  await expect(appWindow.getByRole('heading', { name: 'OpenCode sidecar' })).toBeVisible()
  await expect(appWindow.getByRole('heading', { name: 'OpenCode projects' })).toBeVisible()
  await expect(appWindow.getByRole('heading', { name: 'Open project by directory' })).toBeVisible()
})

test('shows the real OpenCode projects surface', async ({ appWindow }) => {
  await expect(appWindow.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
  await expect(appWindow.getByRole('heading', { name: 'OpenCode sidecar' })).toBeVisible()
  await expect(appWindow.getByText(/^Status:\s*connected/)).toBeVisible()

  await expect(appWindow.getByRole('heading', { name: 'OpenCode projects' })).toBeVisible()
  await expect(
    appWindow
      .getByText(/^(Project load error:|No projects found\.)/)
      .or(appWindow.getByRole('button', { name: /^(Select|Selected:)/ }))
      .first()
  ).toBeVisible()

  await appWindow.getByLabel('Project directory').fill(repositoryDirectory)
  await appWindow.getByRole('button', { name: 'Open project' }).click()

  await expect(appWindow.getByText(`Opening directory: ${repositoryDirectory}`)).toBeVisible()
  await expect(
    appWindow
      .getByRole('heading', { name: 'Opened project details' })
      .or(appWindow.getByText(/^Project open error:/))
  ).toBeVisible()
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
