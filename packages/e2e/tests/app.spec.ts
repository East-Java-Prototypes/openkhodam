import { expect, test } from '../fixtures/electron'

test('renders the built desktop app shell', async ({ appWindow }) => {
  await expect(appWindow.getByRole('link', { name: 'Home' })).toBeVisible()
  await expect(appWindow.getByRole('link', { name: 'Settings', exact: true })).toBeVisible()
  await expect(appWindow.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
  await expect(appWindow.getByRole('heading', { name: 'OpenCode sidecar' })).toBeVisible()
  await expect(appWindow.getByRole('heading', { name: 'Prompt' })).toBeVisible()
  await expect(appWindow.getByRole('heading', { name: 'OpenCode projects' })).toBeVisible()
  await expect(appWindow.getByRole('heading', { name: 'Project sessions' })).toBeVisible()
  await expect(appWindow.getByRole('heading', { name: 'Selected session' })).toBeVisible()
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
})

test('shows the real OpenCode sessions and messages surface', async ({ appWindow }) => {
  await expect(appWindow.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
  await expect(appWindow.getByText(/^Status:\s*connected/)).toBeVisible()
  await expect(appWindow.getByRole('heading', { name: 'OpenCode projects' })).toBeVisible()

  const projectTerminalState = appWindow
    .getByText(/^(Project load error:|No projects found\.)/)
    .or(appWindow.getByRole('button', { name: /^(Select|Selected:)/ }))
    .first()
  await expect(projectTerminalState).toBeVisible()

  await expect(appWindow.getByRole('heading', { name: 'Project sessions' })).toBeVisible()
  await expect(appWindow.getByRole('heading', { name: 'Selected session' })).toBeVisible()

  const projectButtons = appWindow.getByRole('button', { name: /^(Select|Selected:)/ })
  const projectCount = await projectButtons.count()

  if (projectCount === 0) {
    await expect(
      appWindow.getByText(/^(Project load error:|No projects found\.)/).or(appWindow.getByText('Select a project to load sessions.')).first()
    ).toBeVisible()
    await expect(appWindow.getByText('Select a session to load details and messages.')).toBeVisible()
    return
  }

  await projectButtons.first().click()

  await expect(appWindow.getByText(/^Selected directory:/)).toBeVisible()
  await expect(
    appWindow
      .getByText(/^(Session load error:|No root sessions found for this project\.)/)
      .or(appWindow.getByRole('button', { name: /^(Select|Selected:)/ }).nth(projectCount))
      .first()
  ).toBeVisible()

  const sessionButtons = appWindow.getByRole('button', { name: /^(Select|Selected:)/ })
  const totalButtonCount = await sessionButtons.count()

  if (totalButtonCount <= projectCount) {
    await expect(appWindow.getByText('Select a session to load details and messages.')).toBeVisible()
    return
  }

  await sessionButtons.nth(projectCount).click()

  await expect(appWindow.getByRole('button', { name: /^Selected:/ }).nth(1)).toBeVisible()
  await expect(
    appWindow
      .getByText(/^Session detail error:/)
      .or(appWindow.getByText('Title', { exact: true }))
      .first()
  ).toBeVisible()
  await expect(
    appWindow
      .getByText(/^(Message load error:|No messages found for this session\.)/)
      .or(appWindow.getByRole('listitem').filter({ has: appWindow.locator('article') }).first())
      .first()
  ).toBeVisible()
})

test('wires the real prompt composer readiness without sending prompts', async ({ appWindow }) => {
  await expect(appWindow.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
  await expect(appWindow.getByText(/^Status:\s*connected/)).toBeVisible()

  const promptInput = appWindow.getByLabel('Prompt')
  const sendButton = appWindow.getByRole('button', { name: 'Send to selected session' })
  const startButton = appWindow.getByRole('button', { name: 'Start new session' })

  await expect(promptInput).toBeVisible()
  await expect(sendButton).toBeDisabled()
  await expect(startButton).toBeDisabled()

  await promptInput.fill('E2E readiness check only; do not send')
  await expect(sendButton).toBeDisabled()
  await expect(startButton).toBeDisabled()

  const projectTerminalState = appWindow
    .getByText(/^(Project load error:|No projects found\.)/)
    .or(appWindow.getByRole('button', { name: /^(Select|Selected:)/ }))
    .first()
  await expect(projectTerminalState).toBeVisible()

  const projectButtons = appWindow.getByRole('button', { name: /^(Select|Selected:)/ })
  const projectCount = await projectButtons.count()

  if (projectCount === 0) {
    await expect(appWindow.getByText('Select a project before starting or continuing a chat.')).toBeVisible()
    await expect(sendButton).toBeDisabled()
    await expect(startButton).toBeDisabled()
    return
  }

  await projectButtons.first().click()
  await expect(appWindow.getByText(/^Selected directory:/)).toBeVisible()
  await expect(startButton).toBeEnabled()
  await expect(sendButton).toBeDisabled()

  await promptInput.fill('')
  await expect(startButton).toBeDisabled()
  await expect(sendButton).toBeDisabled()

  await promptInput.fill('E2E readiness check only; do not send')
  await expect(startButton).toBeEnabled()

  await expect(
    appWindow
      .getByText(/^(Session load error:|No root sessions found for this project\.)/)
      .or(appWindow.getByRole('button', { name: /^(Select|Selected:)/ }).nth(projectCount))
      .first()
  ).toBeVisible()

  const totalButtonCount = await projectButtons.count()
  if (totalButtonCount <= projectCount) {
    await expect(sendButton).toBeDisabled()
    return
  }

  await projectButtons.nth(projectCount).click()
  await expect(sendButton).toBeEnabled()

  await promptInput.fill('')
  await expect(sendButton).toBeDisabled()
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
