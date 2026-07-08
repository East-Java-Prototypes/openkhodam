import { expect, test, type Page } from '../fixtures/real-opencode'

const prompt = 'Say smoke test ready'

test.setTimeout(90_000)

test('sends a prompt through the real OpenCode sidecar to a local fake provider', async ({
  appWindow,
  realOpenCode
}) => {
  await waitForConnectedSidecar(appWindow)
  await openWorkspaceProject(appWindow, realOpenCode.workspaceDir, realOpenCode.workspaceName)

  const composer = appWindow.getByRole('form', { name: 'Chat prompt' })
  await expect(composer).toBeVisible()
  await expect(composer.getByLabel('OpenCode model')).toHaveValue(realOpenCode.modelLabel, {
    timeout: 45_000
  })

  await composer.getByLabel('Message OpenKhodam').fill(prompt)
  await expect(composer.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
  await composer.getByRole('button', { name: 'Send', exact: true }).click()

  const messages = appWindow.getByRole('region', { name: 'Messages' })
  await expect(messages.getByText(prompt, { exact: true })).toBeVisible()
  await expect(messages.getByText(realOpenCode.assistantResponse, { exact: true })).toBeVisible({
    timeout: 45_000
  })
  await expect
    .poll(
      () =>
        realOpenCode.fakeProvider
          .getChatCompletionRequests()
          .some((request) => request.stream && request.promptText.includes(prompt)),
      { message: 'the real sidecar should call the local fake provider with the UI prompt' }
    )
    .toBe(true)
})

async function waitForConnectedSidecar(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const status = await page.evaluate(() => window.api.getOpenCodeStatus())
        return status.state === 'connected' ? 'connected' : `${status.state}: ${status.message}`
      },
      { message: 'OpenCode sidecar should connect', timeout: 45_000 }
    )
    .toBe('connected')
}

async function openWorkspaceProject(
  page: Page,
  workspaceDir: string,
  workspaceName: string
): Promise<void> {
  if (await isNonGlobalProjectRoute(page)) return
  if (await openExistingWorkspaceProject(page, workspaceName)) return

  await page.evaluate(() => {
    window.location.hash = '#/'
  })
  if (await openExistingWorkspaceProject(page, workspaceName)) return

  const openProjectForm = page.getByRole('form', { name: 'Open project by directory' })
  const directoryInput = openProjectForm.getByLabel('Project directory')
  const openButton = openProjectForm.getByRole('button', { name: 'Open', exact: true })

  await expect(openProjectForm).toBeVisible({ timeout: 30_000 })
  await directoryInput.fill(workspaceDir)
  await expect(openButton).toBeEnabled()
  await openButton.click()
  await waitForNonGlobalProjectRoute(page)
}

async function openExistingWorkspaceProject(page: Page, workspaceName: string): Promise<boolean> {
  const namedProjectLink = page
    .getByRole('navigation', { name: 'Projects' })
    .getByRole('link', { name: workspaceName, exact: true })

  if (await namedProjectLink.isVisible().catch(() => false)) {
    await namedProjectLink.click()
    await waitForNonGlobalProjectRoute(page)
    return true
  }

  const projectLinks = page.locator('nav[aria-label="Projects"] a[href*="#/projects/"]')
  const nonGlobalProjectLinkIndex = await projectLinks.evaluateAll((links) =>
    links.findIndex((link) => {
      const href = link.getAttribute('href') ?? ''
      const label = link.getAttribute('aria-label') ?? link.textContent ?? ''
      return (
        /#\/projects\/(?!global(?:$|[/?#]))/.test(href) &&
        !label.trim().startsWith('Start new conversation')
      )
    })
  )

  if (nonGlobalProjectLinkIndex < 0) return false
  await projectLinks.nth(nonGlobalProjectLinkIndex).click()
  await waitForNonGlobalProjectRoute(page)
  return true
}

async function waitForNonGlobalProjectRoute(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.location.hash), {
      message: 'opening the temp workspace should route to its project',
      timeout: 30_000
    })
    .toMatch(/\/projects\/(?!global(?:$|[/?#]))/)
}

async function isNonGlobalProjectRoute(page: Page): Promise<boolean> {
  const hash = await page.evaluate(() => window.location.hash)
  return /\/projects\/(?!global(?:$|[/?#]))/.test(hash)
}
