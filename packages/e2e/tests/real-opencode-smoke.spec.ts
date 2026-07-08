import { expect, test, type Page } from '../fixtures/real-opencode'

const prompt = 'Say smoke test ready'

test.setTimeout(90_000)

test('sends a prompt through the real OpenCode sidecar to a local fake provider', async ({
  appWindow,
  realOpenCode
}) => {
  await waitForConnectedSidecar(appWindow)
  await openWorkspaceProject(appWindow, realOpenCode.workspaceName)

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

async function openWorkspaceProject(page: Page, workspaceName: string): Promise<void> {
  const projectLink = page
    .getByRole('navigation', { name: 'Projects' })
    .getByRole('link', { name: workspaceName, exact: true })

  await expect(projectLink).toBeVisible({ timeout: 45_000 })
  await projectLink.click()
  await expect
    .poll(() => page.evaluate(() => window.location.hash), {
      message: 'opening the temp workspace should route to its project',
      timeout: 30_000
    })
    .toMatch(/\/projects\//)
}
