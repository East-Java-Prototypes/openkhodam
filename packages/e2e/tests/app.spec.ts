import { dirname } from 'node:path'

import { expect, test, type Locator, type Page } from '../fixtures/electron'

const repositoryDirectory = dirname(process.cwd())
const projectChatLink = (page: Page): Locator =>
  page.getByRole('navigation', { name: 'Project folders' }).getByRole('link')
const sessionChatLink = (page: Page): Locator =>
  page.getByRole('navigation', { name: 'Project sessions' }).getByRole('link')
const eventStatusBadge = (page: Page): Locator => page.getByText(/^(Live|Events paused)/).first()
const terminalProjectRouteState = (page: Page): Locator =>
  page.getByText('No sessions found for this project.').or(sessionChatLink(page))

async function expectOpenedProjectRouteResolved(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        if (await page.getByText('Project not found.').isVisible()) return 'project-not-found'
        if (await terminalProjectRouteState(page).first().isVisible()) return 'resolved'
        return 'pending'
      },
      { message: 'opened project route should resolve without Project not found' }
    )
    .toBe('resolved')
  await expect(page.getByText('Project not found.')).toHaveCount(0)
}

async function waitForChatShell(page: Page): Promise<void> {
  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Project folders' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Project sessions' })).toBeVisible()
  await expect(page.getByRole('form', { name: 'Open project by directory' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Project folders' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Project sessions' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'No chat selected' })).toBeVisible()
  await expect(page.getByText('OpenCode', { exact: true })).toBeVisible()
}

test('renders the built desktop chat shell', async ({ appWindow }) => {
  await waitForChatShell(appWindow)
  await expect(appWindow.getByText(/^(connected|starting|stopped|error)$/).first()).toBeVisible()
  await expect(eventStatusBadge(appWindow)).toBeVisible()
  await expect(appWindow.getByText('Select a project to view sessions.').first()).toBeVisible()
  await expect(
    appWindow
      .getByText('Select a project to view sessions.')
      .or(appWindow.getByText('Waiting for the OpenCode sidecar connection.'))
      .or(appWindow.getByText('No OpenCode projects found.'))
      .first()
  ).toBeVisible()
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
  await expect.poll(() => appWindow.evaluate(() => window.location.hash)).toMatch(/\/projects\//)
  await expect(appWindow.getByRole('heading', { name: 'Project sessions' })).toBeVisible()
  await expectOpenedProjectRouteResolved(appWindow)
})

test('opens a project by directory into the project route without composer', async ({
  appWindow
}) => {
  await waitForChatShell(appWindow)

  const directoryInput = appWindow.getByLabel('Project directory')
  const openProjectForm = appWindow.getByRole('form', { name: 'Open project by directory' })
  const openButton = openProjectForm.getByRole('button', { name: 'Open', exact: true })

  await expect(appWindow.getByText('connected', { exact: true }).first()).toBeVisible()
  await directoryInput.fill(repositoryDirectory)
  await openButton.click()
  await expect.poll(() => appWindow.evaluate(() => window.location.hash)).toMatch(/\/projects\//)
  await expect(appWindow.getByRole('heading', { name: 'Project sessions' })).toBeVisible()
  await expectOpenedProjectRouteResolved(appWindow)
  await expect(appWindow.getByRole('heading', { name: 'No chat selected' })).toBeVisible()
  await expect(appWindow.getByRole('form', { name: 'Chat prompt' })).toHaveCount(0)
})

test('shows the real OpenCode project chats surface', async ({ appWindow }) => {
  await waitForChatShell(appWindow)

  await expect(
    appWindow
      .getByText('No OpenCode projects found.')
      .or(appWindow.getByText('Waiting for the OpenCode sidecar connection.'))
      .or(projectChatLink(appWindow))
      .first()
  ).toBeVisible()
})

test('shows real project/session selection in the reused chat shell', async ({ appWindow }) => {
  await waitForChatShell(appWindow)

  const projectLinks = projectChatLink(appWindow)
  const terminalProjectState = appWindow
    .getByText('No OpenCode projects found.')
    .or(appWindow.getByText('Waiting for the OpenCode sidecar connection.'))
    .or(projectLinks)
    .first()
  await expect(terminalProjectState).toBeVisible()

  if ((await projectLinks.count()) === 0) {
    await expect(appWindow.getByRole('heading', { name: 'No chat selected' })).toBeVisible()
    return
  }

  await projectLinks.first().click()
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.toMatch(
    /\/projects\/[^/]+$/
  )
  await expect(
    appWindow
      .getByText('Select a session to view messages.')
      .or(appWindow.getByText('No sessions found for this project.'))
      .or(appWindow.getByText(/^(Loading OpenCode data…|No messages found for this session\.)/))
      .first()
  ).toBeVisible()
  const projectUrl = appWindow.url()
  await appWindow.reload()
  await expect(appWindow).toHaveURL(projectUrl)
  await expect(appWindow.getByRole('heading', { name: 'Project sessions' })).toBeVisible()

  const sessionLinks = sessionChatLink(appWindow)
  const sessionCount = await sessionLinks.count()
  if (sessionCount === 0) {
    await expect(appWindow.getByText('No sessions found for this project.')).toBeVisible()
    await expect(appWindow.getByRole('form', { name: 'Chat prompt' })).toHaveCount(0)
    return
  }

  await sessionLinks.first().click()
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.toMatch(
    /\/projects\/[^/]+\/sessions\/[^/]+$/
  )
  await expect(appWindow.locator('#active-chat-heading')).not.toHaveText('No chat selected')
  await expect(appWindow.getByRole('form', { name: 'Chat prompt' })).toBeVisible()
  await expect(
    appWindow
      .getByText(/^(No messages found for this session\.|Loading OpenCode data…)/)
      .or(appWindow.getByRole('article').first())
      .first()
  ).toBeVisible()
  await appWindow.goBack()
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.toMatch(
    /\/projects\/[^/]+$/
  )
  await expect(appWindow.getByRole('heading', { name: 'No chat selected' })).toBeVisible()
  await expect(appWindow.getByRole('form', { name: 'Chat prompt' })).toHaveCount(0)
  await appWindow.goForward()
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.toMatch(
    /\/projects\/[^/]+\/sessions\/[^/]+$/
  )
  await expect(appWindow.locator('#active-chat-heading')).not.toHaveText('No chat selected')
  await expect(appWindow.getByRole('form', { name: 'Chat prompt' })).toBeVisible()
})

test('does not mount the prompt composer on project-only routes', async ({ appWindow }) => {
  await waitForChatShell(appWindow)

  const projectLinks = projectChatLink(appWindow)
  await expect(
    appWindow
      .getByText('No OpenCode projects found.')
      .or(appWindow.getByText('Waiting for the OpenCode sidecar connection.'))
      .or(projectLinks)
      .first()
  ).toBeVisible()

  if ((await projectLinks.count()) === 0) {
    await expect(appWindow.getByRole('heading', { name: 'No chat selected' })).toBeVisible()
    return
  }

  await projectLinks.first().click()
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.toMatch(
    /\/projects\/[^/]+$/
  )
  await expect(appWindow.getByRole('form', { name: 'Chat prompt' })).toHaveCount(0)
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
