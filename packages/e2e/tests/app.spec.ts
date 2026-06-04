import { dirname } from 'node:path'

import { expect, test, type Locator, type Page } from '../fixtures/electron'

const repositoryDirectory = dirname(process.cwd())
const projectChatButton = (page: Page): Locator => page.getByRole('button', { name: /Open project/ })
const eventStatusBadge = (page: Page): Locator => page.getByText(/^(Live|Events paused)/).first()

async function waitForChatShell(page: Page): Promise<void> {
  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Project chats' })).toBeVisible()
  await expect(page.getByRole('form', { name: 'Open project by directory' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Project chats' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'No chat selected' })).toBeVisible()
  await expect(page.getByText('OpenCode', { exact: true })).toBeVisible()
  await expect(page.getByRole('form', { name: 'Chat prompt' })).toBeVisible()
  await expect(page.getByPlaceholder('Ask about this project...')).toBeVisible()
}

test('renders the built desktop chat shell', async ({ appWindow }) => {
  await waitForChatShell(appWindow)
  await expect(appWindow.getByText(/^(connected|starting|stopped|error)$/).first()).toBeVisible()
  await expect(eventStatusBadge(appWindow)).toBeVisible()
  await expect(appWindow.getByText('Select a project to view or start a chat.').or(appWindow.getByText('Waiting for the OpenCode sidecar connection.')).or(appWindow.getByText('No OpenCode projects found.')).first()).toBeVisible()
})

test('opens a project by directory from the final chat shell', async ({ appWindow }) => {
  await waitForChatShell(appWindow)

  const directoryInput = appWindow.getByLabel('Project directory')
  const openProjectForm = appWindow.getByRole('form', { name: 'Open project by directory' })
  const openButton = openProjectForm.getByRole('button', { name: 'Open', exact: true })

  await expect(openButton).toBeDisabled()
  await expect(appWindow.getByText('connected', { exact: true }).first()).toBeVisible()
  await directoryInput.fill(repositoryDirectory)
  await expect(openButton).toBeEnabled()

  await openButton.click()
  const openedProjectDetails = openProjectForm.getByRole('region', { name: 'Opened project details' })
  await expect(openedProjectDetails).toBeVisible()
  await expect(openedProjectDetails.getByText('Name', { exact: true })).toBeVisible()
  await expect(openedProjectDetails.getByText('Directory', { exact: true })).toBeVisible()
  await expect(openedProjectDetails.getByText('ID', { exact: true })).toBeVisible()
  await expect(openedProjectDetails.locator('dd').filter({ hasText: /\S/ })).toHaveCount(3)
})

test('opens a project by directory and starts a real conversation', async ({ appWindow }) => {
  await waitForChatShell(appWindow)

  const directoryInput = appWindow.getByLabel('Project directory')
  const openProjectForm = appWindow.getByRole('form', { name: 'Open project by directory' })
  const openButton = openProjectForm.getByRole('button', { name: 'Open', exact: true })

  await expect(appWindow.getByText('connected', { exact: true }).first()).toBeVisible()
  await directoryInput.fill(repositoryDirectory)
  await openButton.click()
  await expect(openProjectForm.getByRole('region', { name: 'Opened project details' })).toBeVisible()

  const promptInput = appWindow.getByPlaceholder('Ask about this project...')
  const sendButton = appWindow.getByRole('button', { name: 'Send' })
  const prompt = `E2E session creation check ${Date.now()}`

  await promptInput.fill(prompt)
  await expect(sendButton).toBeEnabled()
  await sendButton.click()

  await expect(appWindow.getByText('Session started. Messages will refresh shortly.')).toBeVisible()
  await expect(appWindow.locator('#active-chat-heading')).toBeVisible()
  await expect(appWindow.getByRole('article').filter({ hasText: prompt }).first()).toBeVisible()
})

test('shows the real OpenCode project chats surface', async ({ appWindow }) => {
  await waitForChatShell(appWindow)

  await expect(
    appWindow
      .getByText('No OpenCode projects found.')
      .or(appWindow.getByText('Waiting for the OpenCode sidecar connection.'))
      .or(projectChatButton(appWindow))
      .first()
  ).toBeVisible()
})

test('shows real project/session selection in the reused chat shell', async ({ appWindow }) => {
  await waitForChatShell(appWindow)

  const projectButtons = projectChatButton(appWindow)
  const terminalProjectState = appWindow
    .getByText('No OpenCode projects found.')
    .or(appWindow.getByText('Waiting for the OpenCode sidecar connection.'))
    .or(projectButtons)
    .first()
  await expect(terminalProjectState).toBeVisible()

  if ((await projectButtons.count()) === 0) {
    await expect(appWindow.getByRole('heading', { name: 'No chat selected' })).toBeVisible()
    return
  }

  await projectButtons.first().click()
  await expect(appWindow.getByText('Select a session, or send a prompt to start a new one.').or(appWindow.getByText('No sessions yet. Send a prompt to start one.')).or(appWindow.getByText(/^(Loading OpenCode data…|No messages found for this session\.)/)).first()).toBeVisible()

  const sessionButtons = appWindow.getByRole('navigation', { name: 'Project chats' }).getByRole('button').filter({ hasNotText: 'Open project' })
  const sessionCount = await sessionButtons.count()
  if (sessionCount === 0) return

  await sessionButtons.first().click()
  await expect(appWindow.getByRole('heading', { name: /.+/ }).and(appWindow.locator('#active-chat-heading'))).toBeVisible()
  await expect(appWindow.getByText(/^(No messages found for this session\.|Loading OpenCode data…)/).or(appWindow.getByRole('article').first()).first()).toBeVisible()
})

test('wires the real prompt composer readiness without sending prompts', async ({ appWindow }) => {
  await waitForChatShell(appWindow)

  const promptInput = appWindow.getByPlaceholder('Ask about this project...')
  const sendButton = appWindow.getByRole('button', { name: 'Send' })

  await expect(sendButton).toBeDisabled()
  await promptInput.fill('E2E readiness check only; do not send')
  await expect(sendButton).toBeDisabled()

  const projectButtons = projectChatButton(appWindow)
  await expect(appWindow.getByText('No OpenCode projects found.').or(appWindow.getByText('Waiting for the OpenCode sidecar connection.')).or(projectButtons).first()).toBeVisible()

  if ((await projectButtons.count()) === 0) {
    await expect(sendButton).toBeDisabled()
    return
  }

  await projectButtons.first().click()
  await expect(sendButton).toBeEnabled()
  await promptInput.fill('')
  await expect(sendButton).toBeDisabled()
})

test('shows the real live events status surface without fake SSE data', async ({ appWindow }) => {
  await waitForChatShell(appWindow)
  await expect(eventStatusBadge(appWindow)).toBeVisible()
  await expect(appWindow.getByText(/^(Live( · .*)?|Events paused)$/).first()).toBeVisible()
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
