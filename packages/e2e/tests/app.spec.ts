import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { ElectronApplication } from '@playwright/test'
import { expect, test, type Locator, type Page } from '../fixtures/electron'

const repositoryDirectory = dirname(process.cwd())
const desktopOutDirectory = join(repositoryDirectory, 'desktop', 'out')
const googleWorkspaceNotConfiguredMessage =
  'Google OAuth client ID or client secret is not configured.'
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
const selectedProjectSessions = (page: Page): Locator =>
  page.getByRole('navigation', { name: 'Project sessions' })
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
  await expect(page.getByRole('complementary', { name: 'Project sessions' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Project folders' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Project sessions' })).toHaveCount(0)
  await expect(page.getByRole('form', { name: 'Open project by directory' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Project folders' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Project sessions' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'No chat selected' })).toBeVisible()
  await expect(page.getByText('OpenCode', { exact: true })).toBeVisible()
}

async function openSeededDeterministicChat(page: Page): Promise<void> {
  await waitForChatShell(page)
  await expect(projectChatLink(page).filter({ hasText: 'Fake Project' })).toBeVisible()
  await projectChatLink(page).filter({ hasText: 'Fake Project' }).click()
  await expect(page.evaluate(() => window.location.hash)).resolves.toMatch(/\/projects\/[^/]+$/)
  await expectOpenedProjectRouteResolved(page)

  await sessionChatLink(page).filter({ hasText: 'Seeded deterministic chat' }).click()
  await expect(page.evaluate(() => window.location.hash)).resolves.toMatch(
    /\/projects\/[^/]+\/sessions\/[^/]+$/
  )
  await expect(page.getByRole('heading', { name: 'Seeded deterministic chat' })).toBeVisible()
  await expect(page.getByRole('form', { name: 'Chat prompt' })).toBeVisible()
  await expect(page.getByLabel('OpenCode model')).toHaveValue(
    'Connected Fake Provider · Connected Fake Model'
  )
}

async function openStructuredFixtureChat(page: Page): Promise<void> {
  await waitForChatShell(page)
  await expect(projectChatLink(page).filter({ hasText: 'Fake Project' })).toBeVisible()
  await projectChatLink(page).filter({ hasText: 'Fake Project' }).click()
  await expectOpenedProjectRouteResolved(page)
  await sessionChatLink(page).filter({ hasText: 'Structured fixture chat' }).click()
  await expect(page.getByRole('heading', { name: 'Structured fixture chat' })).toBeVisible()
}

async function sendPrompt(page: Page, prompt: string): Promise<void> {
  await page.getByLabel('Message OpenKhodam').fill(prompt)
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled()
  await page.getByRole('button', { name: 'Send' }).click()
}

async function articleTexts(page: Page): Promise<string[]> {
  return page
    .getByRole('article')
    .evaluateAll((articles) =>
      articles.map((article) => article.textContent?.replace(/\s+/g, ' ').trim() ?? '')
    )
}

async function waitForMainProcessValue(
  getter: () => Promise<string | null>,
  timeoutMs = 10_000
): Promise<string> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const value = await getter()
    if (value !== null) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  throw new Error('Timed out waiting for the Electron main process capture.')
}

async function installGoogleWorkspaceOAuthCapture(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ shell }) => {
    const globalObject = globalThis as any

    const capture =
      globalObject.__googleWorkspaceOAuthCapture ??
      (globalObject.__googleWorkspaceOAuthCapture = {
        authUrl: null,
        tokenBody: null,
        userInfoAuthorization: null
      })

    shell.openExternal = async (url: string) => {
      capture.authUrl = String(url)
      return undefined
    }

    const originalFetch = globalObject.fetch.bind(globalObject)
    globalObject.fetch = async (input: any, init: any) => {
      const url = String(input)

      if (url === 'https://oauth2.googleapis.com/token') {
        const body = init?.body
        capture.tokenBody =
          body instanceof URLSearchParams ? body.toString() : (body?.toString() ?? null)
        return new Response(
          JSON.stringify({
            access_token: 'fake-access-token',
            expires_in: 3600,
            scope: 'openid email profile',
            token_type: 'Bearer'
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }

      if (url === 'https://openidconnect.googleapis.com/v1/userinfo') {
        capture.userInfoAuthorization = init?.headers?.authorization ?? null
        return new Response(JSON.stringify({ email: 'fake@example.com', name: 'Fake User' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }

      return originalFetch(input, init)
    }
  })
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
  await expect(selectedProjectSessions(appWindow)).toBeVisible()
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
  await expect(selectedProjectSessions(appWindow)).toBeVisible()
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
  await expect(selectedProjectSessions(appWindow)).toBeVisible()
  await expect(
    appWindow
      .getByText('No sessions found for this project.')
      .or(sessionChatLink(appWindow))
      .first()
  ).toBeVisible()

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
  await openSeededDeterministicChat(appWindow)
  await expect(appWindow.getByText('Seeded user prompt')).toBeVisible()
  await expect(appWindow.getByText('Seeded assistant response')).toBeVisible()
})

test('renders structured v1 and v2 message parts', async ({ appWindow }) => {
  await openStructuredFixtureChat(appWindow)
  await expect(appWindow.getByText('Inspecting project files.')).toBeVisible()
  await expect(appWindow.getByText('Need file context before responding.')).toBeVisible()
  await expect(appWindow.getByText('Hidden v1 step start marker')).toHaveCount(0)
  await expect(appWindow.getByText('Hidden v1 step finish marker')).toHaveCount(0)
  await expect(appWindow.getByText('Hidden v2 step start marker')).toHaveCount(0)
  await expect(appWindow.getByText('Hidden v2 step finish marker')).toHaveCount(0)
  const readTool = appWindow.locator('[aria-label="Tool read"]')
  await expect(readTool).toContainText('read')
  await expect(readTool).toContainText('completed')
  await expect(readTool).not.toContainText('Input')
  await readTool.getByRole('button', { name: 'Toggle details for tool read' }).click()
  await expect(readTool).toContainText('Input')
  await expect(readTool).toContainText('V1 fixture tool output')
  await readTool.getByRole('button', { name: 'Toggle details for tool read' }).click()
  await expect(readTool).not.toContainText('V1 fixture tool output')
  await expect(appWindow.getByText('Unsupported part: future-part')).toBeVisible()
  await expect(appWindow.getByText('Running the v2 shell check.')).toBeVisible()
  const bashTool = appWindow.locator('[aria-label="Tool bash"]')
  await expect(bashTool).toContainText('bash')
  await expect(bashTool).toContainText('error')
  await expect(bashTool).toContainText('Output')
  await expect(bashTool).toContainText('V2 fixture tool output')
  await expect(bashTool).toContainText('Error')
  await expect(bashTool).toContainText('V2 fixture tool error')
  await bashTool.getByRole('button', { name: 'Toggle details for tool bash' }).click()
  await expect(bashTool).not.toContainText('V2 fixture tool output')
  await expect(bashTool).toContainText('bash')
  await expect(appWindow.getByText('Unsupported part: future-content')).toBeVisible()
})

test('keeps a long collapsed tool disclosure anchored when opening it', async ({ appWindow }) => {
  await openStructuredFixtureChat(appWindow)

  const tool = appWindow.locator('[aria-label="Tool plan"]')
  const toggle = tool.getByRole('button', { name: 'Toggle details for tool plan' })

  await expect(toggle).toBeVisible()
  // TODO: add a reliable scroll-stability test for exact trigger-position anchoring.
  await toggle.click()
  await expect(tool).toContainText('Long tool output line 80')
  await expect(toggle).toBeVisible()
})

test('shows only connected OpenCode models in the composer picker', async ({ appWindow }) => {
  await waitForChatShell(appWindow)
  await projectChatLink(appWindow).filter({ hasText: 'Fake Project' }).click()

  const modelPicker = appWindow.getByLabel('OpenCode model')
  await expect(modelPicker).toBeVisible()
  await expect(modelPicker).toHaveValue('Connected Fake Provider · Connected Fake Model')
  await modelPicker.click()
  await expect(appWindow.getByText('Connected Alternate Model')).toBeVisible()
  await expect(appWindow.getByText('Disconnected Hidden Model')).toHaveCount(0)
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
  await openSeededDeterministicChat(appWindow)

  await sendPrompt(appWindow, 'Delayed lifecycle prompt')
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

test('keeps a newly sent prompt at the bottom of seeded chat history', async ({ appWindow }) => {
  await openSeededDeterministicChat(appWindow)

  const prompt = 'Order-sensitive prompt'
  await sendPrompt(appWindow, prompt)
  await expect(appWindow.locator('[data-pending="true"]').filter({ hasText: prompt })).toBeVisible()
  await expect(appWindow.getByText(`Fake response for: ${prompt}`)).toBeVisible()
  await expect(appWindow.locator('[data-pending="true"]').filter({ hasText: prompt })).toHaveCount(
    0
  )

  await expect
    .poll(async () => articleTexts(appWindow))
    .toEqual([
      expect.stringContaining('Seeded user prompt'),
      expect.stringContaining('Seeded assistant response'),
      expect.stringContaining(prompt),
      expect.stringContaining(`Fake response for: ${prompt}`)
    ])
})

test('keeps repeated identical prompts visible until each projection arrives', async ({
  appWindow
}) => {
  await openSeededDeterministicChat(appWindow)

  const repeatedPrompt = 'Repeat me exactly'
  await sendPrompt(appWindow, repeatedPrompt)
  await expect(
    appWindow.locator('[data-pending="true"]').filter({ hasText: repeatedPrompt })
  ).toBeVisible()
  await expect(appWindow.getByText(`Fake response for: ${repeatedPrompt}`)).toBeVisible()
  await expect(
    appWindow.locator('[data-pending="true"]').filter({ hasText: repeatedPrompt })
  ).toHaveCount(0)

  await sendPrompt(appWindow, repeatedPrompt)
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
  await openSeededDeterministicChat(appWindow)

  const firstPrompt = 'First concurrent prompt'
  const secondPrompt = 'Second concurrent prompt'
  await sendPrompt(appWindow, firstPrompt)
  await expect(
    appWindow.locator('[data-pending="true"]').filter({ hasText: firstPrompt })
  ).toBeVisible()

  await sendPrompt(appWindow, secondPrompt)
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

test('shows the real OpenCode sidecar settings surface', async ({ appWindow, electronApp }) => {
  await waitForChatShell(appWindow)

  const userDataPath = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const runtimeConfigPath = join(userDataPath, 'opencode-sidecar', 'runtime-opencode-config.json')
  const runtimeConfig = JSON.parse(await readFile(runtimeConfigPath, 'utf8')) as {
    $schema: string
    plugin: string[]
  }
  expect(runtimeConfig).toEqual({
    $schema: 'https://opencode.ai/config.json',
    plugin: [join(desktopOutDirectory, 'opencode-plugins', 'openkhodam-poc.mjs')]
  })

  await projectSettingsLink(appWindow).click()

  await expect(appWindow.evaluate(() => window.location.hash)).resolves.toMatch(/\/settings$/)
  await expect(projectHomeLink(appWindow)).toBeVisible()
  await expect(projectSettingsLink(appWindow)).toBeVisible()
  await expect(appWindow.getByRole('heading', { name: 'Project folders' })).toBeVisible()
  await expect(appWindow.getByRole('heading', { name: 'Project sessions' })).toHaveCount(0)
  await expect(appWindow.getByRole('form', { name: 'Open project by directory' })).toBeVisible()
  await expect(appWindow.getByRole('navigation', { name: 'Project folders' })).toBeVisible()
  await expect(appWindow.getByRole('navigation', { name: 'Project sessions' })).toHaveCount(0)
  await expect(appWindow.getByRole('heading', { name: 'OpenCode Server' })).toBeVisible()
  await expect(appWindow.getByText(/^Status:/)).toBeVisible()
  await expect(appWindow.getByText(/^Message:/)).toBeVisible()
  await expect(appWindow.getByText(/^Endpoint:/)).toBeVisible()
  await expect(appWindow.getByText('Renderer Origin', { exact: true })).toBeVisible()
  await expect(appWindow.getByText('Renderer HTTP', { exact: true })).toBeVisible()
  await expect(appWindow.getByRole('button', { name: /^(Restart|Restarting)$/ })).toBeVisible()
  await expect(appWindow.getByRole('heading', { name: 'Google Workspace' })).toBeVisible()
  await expect(
    appWindow.getByText(googleWorkspaceNotConfiguredMessage, { exact: true })
  ).toBeVisible()
  await expect(appWindow.getByRole('button', { name: 'Connect', exact: true })).toBeDisabled()
  await expect(appWindow.getByText(/access[_ ]?token|refresh[_ ]?token/i)).toHaveCount(0)

  await projectHomeLink(appWindow).click()
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.toMatch(/#\/$/)
  await expect(appWindow.getByRole('heading', { name: 'No chat selected' })).toBeVisible()
  await expect(appWindow.getByText('OpenCode', { exact: true })).toBeVisible()
})

test.describe('Google Workspace settings gating', () => {
  test.use({ googleWorkspaceClientId: 'fake-client-id' })

  test('disables Connect when the client secret is missing', async ({ appWindow }) => {
    await waitForChatShell(appWindow)
    await projectSettingsLink(appWindow).click()

    await expect(appWindow.getByRole('heading', { name: 'Google Workspace' })).toBeVisible()
    await expect(
      appWindow.getByText(googleWorkspaceNotConfiguredMessage, { exact: true })
    ).toBeVisible()
    await expect(appWindow.getByRole('button', { name: 'Connect', exact: true })).toBeDisabled()
    await expect(appWindow.getByText(/access[_ ]?token|refresh[_ ]?token/i)).toHaveCount(0)
  })
})

test.describe('Google Workspace connect cancellation', () => {
  test.use({
    googleWorkspaceClientId: 'fake-client-id',
    googleWorkspaceClientSecret: 'fake-client-secret'
  })

  test('cancels a pending Google Workspace connect attempt', async ({ appWindow, electronApp }) => {
    await waitForChatShell(appWindow)
    await projectSettingsLink(appWindow).click()

    await electronApp.evaluate(({ shell }) => {
      shell.openExternal = async () => undefined
    })

    await expect(appWindow.getByRole('heading', { name: 'Google Workspace' })).toBeVisible()
    await expect(appWindow.getByRole('button', { name: 'Connect', exact: true })).toBeEnabled()

    await appWindow.getByRole('button', { name: 'Connect', exact: true }).click()
    await expect(appWindow.getByRole('button', { name: 'Connecting', exact: true })).toBeVisible()
    await expect(appWindow.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
    await expect(appWindow.getByRole('status')).toHaveText(
      'Waiting for the Google Workspace sign-in to finish.'
    )

    await appWindow.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(appWindow.getByRole('button', { name: 'Connect', exact: true })).toBeEnabled()
    await expect(appWindow.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)
    await expect(appWindow.getByRole('status')).toHaveCount(0)
    await expect(
      appWindow.getByText('Google Workspace is disconnected.', { exact: true })
    ).toBeVisible()
    await expect(appWindow.getByRole('alert')).toHaveCount(0)
  })

  test('sends the Google Workspace client secret during token exchange', async ({
    appWindow,
    electronApp
  }) => {
    await installGoogleWorkspaceOAuthCapture(electronApp)
    await waitForChatShell(appWindow)
    await projectSettingsLink(appWindow).click()

    await expect(appWindow.getByRole('heading', { name: 'Google Workspace' })).toBeVisible()
    await expect(appWindow.getByRole('button', { name: 'Connect', exact: true })).toBeEnabled()

    await appWindow.getByRole('button', { name: 'Connect', exact: true }).click()
    await expect(appWindow.getByRole('button', { name: 'Connecting', exact: true })).toBeVisible()

    const authUrl = new URL(
      await waitForMainProcessValue(async () =>
        electronApp.evaluate(
          () => (globalThis as any).__googleWorkspaceOAuthCapture?.authUrl ?? null
        )
      )
    )
    const redirectUri = authUrl.searchParams.get('redirect_uri')
    const state = authUrl.searchParams.get('state')

    expect(redirectUri).not.toBeNull()
    expect(state).not.toBeNull()

    await fetch(`${redirectUri}?code=test-auth-code&state=${state}`)

    const tokenBody = await waitForMainProcessValue(async () =>
      electronApp.evaluate(
        () => (globalThis as any).__googleWorkspaceOAuthCapture?.tokenBody ?? null
      )
    )
    const tokenParams = new URLSearchParams(tokenBody)

    expect(tokenParams.get('client_id')).toBe('fake-client-id')
    expect(tokenParams.get('client_secret')).toBe('fake-client-secret')
    expect(tokenParams.get('code')).toBe('test-auth-code')
    expect(tokenParams.get('code_verifier')).not.toBeNull()
    expect(tokenParams.get('code_verifier')).not.toBe('')
    expect(tokenParams.get('grant_type')).toBe('authorization_code')
    expect(tokenParams.get('redirect_uri')).toBe(redirectUri)

    const userInfoAuthorization = await waitForMainProcessValue(async () =>
      electronApp.evaluate(
        () => (globalThis as any).__googleWorkspaceOAuthCapture?.userInfoAuthorization ?? null
      )
    )

    expect(userInfoAuthorization).toBe('Bearer fake-access-token')
    await expect(appWindow.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible()
    await expect(
      appWindow.getByText('Connected as fake@example.com.', { exact: true })
    ).toBeVisible()

    const status = await appWindow.evaluate(() => window.api.getGoogleWorkspaceStatus())
    expect(status).toMatchObject({
      state: 'connected',
      account: { email: 'fake@example.com', name: 'Fake User' },
      scopes: ['email', 'openid', 'profile'],
      message: 'Connected as fake@example.com.'
    })
    expect(status).not.toHaveProperty('accessToken')
    expect(status).not.toHaveProperty('refreshToken')
    expect(status).not.toHaveProperty('clientSecret')

    const apiKeys = await appWindow.evaluate(() => Object.keys(window.api))
    expect(apiKeys).not.toContain('clientSecret')
    expect(apiKeys).not.toContain('accessToken')
    expect(apiKeys).not.toContain('refreshToken')
  })

  test('surfaces a Google Workspace OAuth timeout', async ({ appWindow, electronApp }) => {
    await electronApp.evaluate(() => {
      const globalObject = globalThis as any
      const originalSetTimeout = globalObject.setTimeout.bind(globalObject)
      globalObject.setTimeout = ((handler: any, timeout?: number, ...args: any[]) =>
        originalSetTimeout(
          handler,
          typeof timeout === 'number' ? Math.min(timeout, 50) : timeout,
          ...args
        )) as typeof setTimeout
    })

    await waitForChatShell(appWindow)
    await projectSettingsLink(appWindow).click()

    await electronApp.evaluate(({ shell }) => {
      shell.openExternal = async () => undefined
    })

    await expect(appWindow.getByRole('heading', { name: 'Google Workspace' })).toBeVisible()
    await expect(appWindow.getByRole('button', { name: 'Connect', exact: true })).toBeEnabled()
    await appWindow.getByRole('button', { name: 'Connect', exact: true }).click()
    await expect(appWindow.getByRole('button', { name: 'Connecting', exact: true })).toBeVisible()
    await expect(appWindow.getByRole('alert')).toContainText(
      'Google OAuth connection timed out. Please try again.'
    )
    await expect(appWindow.getByRole('button', { name: 'Connect', exact: true })).toBeEnabled()
    await expect(appWindow.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)
    await expect(appWindow.getByRole('status')).toHaveCount(0)
    await expect(
      appWindow.getByText('Google Workspace is disconnected.', { exact: true })
    ).toBeVisible()
  })
})
