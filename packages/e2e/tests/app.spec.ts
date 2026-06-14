import { dirname } from 'node:path'

import { expect, test, type Locator, type Page } from '../fixtures/electron'

const repositoryDirectory = dirname(process.cwd())
const projectChatLink = (page: Page): Locator =>
  page.getByRole('navigation', { name: 'Project folders' }).getByRole('link')
const projectSettingsLink = (page: Page): Locator =>
  page
    .getByRole('complementary', { name: 'Project folders' })
    .getByRole('link', { name: 'Settings', exact: true })
const projectHomeLink = (page: Page): Locator =>
  page
    .getByRole('complementary', { name: 'Project folders' })
    .getByRole('link', { name: 'Home', exact: true })
const sessionChatLink = (page: Page): Locator =>
  page.getByRole('navigation', { name: 'Project sessions' }).getByRole('link')
const eventStatusBadge = (page: Page): Locator => page.getByText(/^(Live|Events paused)/).first()
const terminalProjectRouteState = (page: Page): Locator =>
  page.getByText('No sessions found for this project.').or(sessionChatLink(page))

async function expectOpenedProjectRouteResolved(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        if (await page.getByText('Project not found.').first().isVisible())
          return 'project-not-found'
        if (await terminalProjectRouteState(page).first().isVisible()) return 'resolved'
        return 'pending'
      },
      { message: 'opened project route should resolve without Project not found' }
    )
    .toBe('resolved')
  await expect(page.getByText('Project not found.').first()).toHaveCount(0)
}

async function waitForChatShell(page: Page): Promise<void> {
  await expect(projectHomeLink(page)).toBeVisible()
  await expect(projectSettingsLink(page)).toBeVisible()
  await expect(
    page
      .getByRole('complementary', { name: 'Project sessions' })
      .getByRole('link', { name: 'Settings', exact: true })
  ).toHaveCount(0)
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

test('opens a project by directory into the project route with start composer', async ({
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
  await expect(appWindow.getByRole('form', { name: 'Chat prompt' })).toBeVisible()
  await expect(appWindow.getByText('Start a new conversation in this project.')).toBeVisible()
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
      .getByText('Start a new conversation in this project.')
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
    await expect(appWindow.getByRole('form', { name: 'Chat prompt' })).toBeVisible()
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
  await expect(appWindow.getByRole('form', { name: 'Chat prompt' })).toBeVisible()
  await appWindow.goForward()
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.toMatch(
    /\/projects\/[^/]+\/sessions\/[^/]+$/
  )
  await expect(appWindow.locator('#active-chat-heading')).not.toHaveText('No chat selected')
  await expect(appWindow.getByRole('form', { name: 'Chat prompt' })).toBeVisible()
})

test('renders seeded stable chat messages', async ({ appWindow }) => {
  await waitForChatShell(appWindow)

  await expect(projectChatLink(appWindow).filter({ hasText: 'Fake Project' })).toBeVisible()
  await projectChatLink(appWindow).filter({ hasText: 'Fake Project' }).click()
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.toMatch(
    /\/projects\/[^/]+$/
  )
  await sessionChatLink(appWindow).filter({ hasText: 'Seeded deterministic chat' }).click()
  await expect(appWindow.getByRole('heading', { name: 'Seeded deterministic chat' })).toBeVisible()
  await expect(appWindow.getByText('Seeded user prompt')).toBeVisible()
  await expect(appWindow.getByText('Seeded assistant response')).toBeVisible()
})

test('starts a new stable chat from the project route', async ({ appWindow }) => {
  await waitForChatShell(appWindow)

  const projectLinks = projectChatLink(appWindow)
  await expect(projectLinks.first()).toBeVisible()
  await projectLinks.first().click()
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.toMatch(
    /\/projects\/[^/]+$/
  )

  await appWindow.getByLabel('Message OpenKhodam').fill('Create a deterministic test chat')
  await expect(appWindow.getByRole('button', { name: 'Send' })).toBeEnabled()
  await appWindow.getByRole('button', { name: 'Send' }).click()
  await expect
    .poll(() => appWindow.evaluate(() => window.location.hash))
    .toMatch(/\/projects\/[^/]+\/sessions\/new-session-2$/)
  await expect(
    sessionChatLink(appWindow).filter({ hasText: 'New deterministic chat' })
  ).toBeVisible()
  await expect(appWindow.getByRole('heading', { name: 'New deterministic chat' })).toBeVisible()
  await expect(
    appWindow.getByText('Create a deterministic test chat', { exact: true })
  ).toBeVisible()
  await expect(
    appWindow
      .locator('[data-pending="true"]')
      .filter({ hasText: 'Create a deterministic test chat' })
  ).toBeVisible()
  await expect(
    appWindow.getByText('Fake response for: Create a deterministic test chat')
  ).toBeVisible()
  await expect(
    appWindow
      .locator('[data-pending="true"]')
      .filter({ hasText: 'Create a deterministic test chat' })
  ).toHaveCount(0)
})

test('shows optimistic prompt before delayed stable message projection', async ({ appWindow }) => {
  await waitForChatShell(appWindow)
  await projectChatLink(appWindow).first().click()
  await sessionChatLink(appWindow).filter({ hasText: 'Seeded deterministic chat' }).click()

  await appWindow.getByLabel('Message OpenKhodam').fill('Delayed lifecycle prompt')
  await appWindow.getByRole('button', { name: 'Send' }).click()
  await expect(appWindow.getByText('Delayed lifecycle prompt', { exact: true })).toBeVisible()
  await expect(
    appWindow.locator('[data-pending="true"]').filter({ hasText: 'Delayed lifecycle prompt' })
  ).toBeVisible()
  await expect(appWindow.getByText('Fake response for: Delayed lifecycle prompt')).toBeVisible()
  await expect(
    appWindow.locator('[data-pending="true"]').filter({ hasText: 'Delayed lifecycle prompt' })
  ).toHaveCount(0)
  await expect(appWindow.getByText('Delayed lifecycle prompt', { exact: true })).toHaveCount(1)
})

test('keeps repeated identical prompts visible until each projection arrives', async ({
  appWindow
}) => {
  await waitForChatShell(appWindow)
  await projectChatLink(appWindow).first().click()
  await sessionChatLink(appWindow).filter({ hasText: 'Seeded deterministic chat' }).click()

  const repeatedPrompt = 'Repeat me exactly'
  await appWindow.getByLabel('Message OpenKhodam').fill(repeatedPrompt)
  await appWindow.getByRole('button', { name: 'Send' }).click()
  await expect(
    appWindow.locator('[data-pending="true"]').filter({ hasText: repeatedPrompt })
  ).toBeVisible()
  await expect(appWindow.getByText(`Fake response for: ${repeatedPrompt}`)).toBeVisible()
  await expect(
    appWindow.locator('[data-pending="true"]').filter({ hasText: repeatedPrompt })
  ).toHaveCount(0)

  await appWindow.getByLabel('Message OpenKhodam').fill(repeatedPrompt)
  await appWindow.getByRole('button', { name: 'Send' }).click()
  await expect(
    appWindow.locator('[data-pending="true"]').filter({ hasText: repeatedPrompt })
  ).toBeVisible()
  await expect(appWindow.getByText(repeatedPrompt, { exact: true })).toHaveCount(2)
  await expect(appWindow.getByText(`Fake response for: ${repeatedPrompt}`)).toHaveCount(2)
  await expect(
    appWindow.locator('[data-pending="true"]').filter({ hasText: repeatedPrompt })
  ).toHaveCount(0)
})

test('keeps two prompts pending before the first stable projection arrives', async ({
  appWindow
}) => {
  await waitForChatShell(appWindow)
  await projectChatLink(appWindow).first().click()
  await sessionChatLink(appWindow).filter({ hasText: 'Seeded deterministic chat' }).click()

  const firstPrompt = 'First concurrent prompt'
  const secondPrompt = 'Second concurrent prompt'
  await appWindow.getByLabel('Message OpenKhodam').fill(firstPrompt)
  await appWindow.getByRole('button', { name: 'Send' }).click()
  await expect(
    appWindow.locator('[data-pending="true"]').filter({ hasText: firstPrompt })
  ).toBeVisible()

  await appWindow.getByLabel('Message OpenKhodam').fill(secondPrompt)
  await appWindow.getByRole('button', { name: 'Send' }).click()
  await expect(
    appWindow.locator('[data-pending="true"]').filter({ hasText: firstPrompt })
  ).toBeVisible()
  await expect(
    appWindow.locator('[data-pending="true"]').filter({ hasText: secondPrompt })
  ).toBeVisible()

  await expect(appWindow.getByText(`Fake response for: ${firstPrompt}`)).toBeVisible()
  await expect(
    appWindow.locator('[data-pending="true"]').filter({ hasText: firstPrompt })
  ).toHaveCount(0)
  await expect(
    appWindow.locator('[data-pending="true"]').filter({ hasText: secondPrompt })
  ).toHaveCount(0)
  await expect(appWindow.getByText(`Fake response for: ${secondPrompt}`)).toBeVisible()
})

test('shows the real live events status surface without fake SSE data', async ({ appWindow }) => {
  await waitForChatShell(appWindow)
  await expect(eventStatusBadge(appWindow)).toBeVisible()
  await expect(appWindow.getByText(/^(Live( · .*)?|Events paused)$/).first()).toBeVisible()
})

test('shows the real OpenCode sidecar settings surface', async ({ appWindow }) => {
  await waitForChatShell(appWindow)
  await projectSettingsLink(appWindow).click()

  await expect(appWindow.evaluate(() => window.location.hash)).resolves.toMatch(/\/settings$/)
  await expect(projectHomeLink(appWindow)).toBeVisible()
  await expect(projectSettingsLink(appWindow)).toBeVisible()
  await expect(appWindow.getByRole('heading', { name: 'Project folders' })).toBeVisible()
  await expect(appWindow.getByRole('heading', { name: 'Project sessions' })).toBeVisible()
  await expect(appWindow.getByRole('form', { name: 'Open project by directory' })).toBeVisible()
  await expect(appWindow.getByRole('navigation', { name: 'Project folders' })).toBeVisible()
  await expect(appWindow.getByRole('navigation', { name: 'Project sessions' })).toBeVisible()
  await expect(appWindow.getByRole('heading', { name: 'OpenCode Server' })).toBeVisible()
  await expect(appWindow.getByText(/^Status:/)).toBeVisible()
  await expect(appWindow.getByText(/^Message:/)).toBeVisible()
  await expect(appWindow.getByText(/^Endpoint:/)).toBeVisible()
  await expect(appWindow.getByText('Renderer Origin', { exact: true })).toBeVisible()
  await expect(appWindow.getByText('Renderer HTTP', { exact: true })).toBeVisible()
  await expect(appWindow.getByRole('button', { name: /^(Restart|Restarting)$/ })).toBeVisible()

  await projectHomeLink(appWindow).click()
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.toMatch(/#\/$/)
  await expect(appWindow.getByRole('heading', { name: 'No chat selected' })).toBeVisible()
  await expect(appWindow.getByText('OpenCode', { exact: true })).toBeVisible()
})
