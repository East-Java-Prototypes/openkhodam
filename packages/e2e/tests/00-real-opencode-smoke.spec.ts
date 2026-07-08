import { expect, test, type Page } from '../fixtures/real-opencode'

const prompt = 'Say smoke test ready'

test.setTimeout(90_000)

test('sends a prompt through the real OpenCode sidecar to a local fake provider', async ({
  appWindow,
  realOpenCode
}) => {
  await waitForConnectedSidecar(appWindow)
  await openWorkspaceProject(appWindow, realOpenCode.workspaceDir)

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

async function openWorkspaceProject(page: Page, workspaceDir: string): Promise<void> {
  if (await isNonGlobalProjectRoute(page)) return

  const project = await openWorkspaceThroughOpenCode(page, workspaceDir)
  const projectID = typeof project.id === 'string' ? project.id : ''
  expect(projectID, 'OpenCode should return a concrete temp workspace project id').not.toBe('')
  expect(projectID, 'temp workspace should not resolve to the global project').not.toBe('global')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForConnectedSidecar(page)

  await page.evaluate((id) => {
    window.location.hash = `#/projects/${encodeURIComponent(id)}`
  }, projectID)
  await waitForNonGlobalProjectRoute(page)
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

async function openWorkspaceThroughOpenCode(
  page: Page,
  workspaceDir: string
): Promise<{ id?: unknown; worktree?: unknown }> {
  return page.evaluate(async (directory) => {
    const connection = await window.api.getOpenCodeConnection()
    const authorization = btoa(`${connection.username}:${connection.password}`)
    const response = await fetch(
      `${connection.url}/project/current?directory=${encodeURIComponent(directory)}`,
      { headers: { authorization: `Basic ${authorization}` } }
    )

    if (!response.ok) {
      throw new Error(
        `OpenCode project/current failed: ${response.status} ${await response.text()}`
      )
    }

    return (await response.json()) as { id?: unknown; worktree?: unknown }
  }, workspaceDir)
}
