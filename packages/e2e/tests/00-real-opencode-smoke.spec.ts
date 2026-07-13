import { expect, test, type Page } from '../fixtures/real-opencode'
import {
  getProjectDirectoryPickerCallCount,
  installProjectDirectoryPickerMock
} from '../fixtures/project-directory-picker'

const firstPrompt = 'Say smoke test ready'
const secondPrompt = 'Say smoke test still ready'

test.setTimeout(120_000)

test('sends a prompt through the real OpenCode sidecar to a local fake provider', async ({
  appWindow,
  electronApp,
  realOpenCode
}) => {
  await waitForConnectedSidecar(appWindow)
  await expectRendererOpenKhodamHealth(appWindow)
  await installProjectDirectoryPickerMock(electronApp, realOpenCode.workspaceDir)
  await openWorkspaceProject(appWindow, electronApp, realOpenCode.workspaceDir)
  await waitForOpenCodeProjectModelReadiness(appWindow, {
    workspaceDir: realOpenCode.workspaceDir,
    providerID: realOpenCode.providerID,
    modelID: realOpenCode.modelID,
    modelLabel: realOpenCode.modelLabel
  })

  const composer = appWindow.getByRole('form', { name: 'Chat prompt' })
  await expect(composer).toBeVisible()
  await expectReadyModelPicker(appWindow, {
    workspaceDir: realOpenCode.workspaceDir,
    providerID: realOpenCode.providerID,
    modelID: realOpenCode.modelID,
    modelLabel: realOpenCode.modelLabel
  })

  await sendPrompt(composer, firstPrompt)

  const messages = appWindow.getByRole('region', { name: 'Messages' })
  await expect(messages.getByText(firstPrompt, { exact: true })).toBeVisible()
  await expect(messages.getByText(realOpenCode.assistantResponse, { exact: true })).toBeVisible({
    timeout: 45_000
  })
  const sessionRoute = await waitForSessionRoute(appWindow)
  await expectFakeProviderPrompt(realOpenCode, firstPrompt)

  await appWindow.reload({ waitUntil: 'domcontentloaded' })
  await waitForConnectedSidecar(appWindow)
  await expect(appWindow).toHaveURL(sessionRoute)
  await expect(messages.getByText(firstPrompt, { exact: true })).toBeVisible({ timeout: 45_000 })
  await expect(messages.getByText(realOpenCode.assistantResponse, { exact: true })).toBeVisible({
    timeout: 45_000
  })
  await expectReadyModelPicker(appWindow, {
    workspaceDir: realOpenCode.workspaceDir,
    providerID: realOpenCode.providerID,
    modelID: realOpenCode.modelID,
    modelLabel: realOpenCode.modelLabel
  })

  await sendPrompt(composer, secondPrompt)
  await expect(appWindow).toHaveURL(sessionRoute)
  await expect(messages.getByText(secondPrompt, { exact: true })).toBeVisible()
  await expect(messages.getByText(realOpenCode.assistantResponse, { exact: true })).toHaveCount(2, {
    timeout: 45_000
  })
  await expectFakeProviderPrompt(realOpenCode, firstPrompt)
  await expectFakeProviderPrompt(realOpenCode, secondPrompt)
})

async function expectRendererOpenKhodamHealth(page: Page): Promise<void> {
  await expect(page.locator('[data-openkhodam-health]')).toHaveAttribute(
    'data-openkhodam-health',
    'ok',
    { timeout: 45_000 }
  )
}

type ModelReadinessContext = {
  workspaceDir: string
  providerID: string
  modelID: string
  modelLabel: string
}

type SidecarReadiness = {
  ready: boolean
  sidecarState: string
  sidecarMessage: string
  projectListed: boolean
  projectID: string | null
  projects: Array<{ id: string; worktree: string }>
  connectedProviders: string[]
  providerFound: boolean
  modelFound: boolean
  providerModelIDs: string[]
  defaultModelID: string | null
  errors: string[]
}

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
  electronApp: Parameters<typeof getProjectDirectoryPickerCallCount>[0],
  workspaceDir: string
): Promise<string> {
  const openProjectButton = page
    .getByRole('complementary', { name: 'Projects' })
    .getByRole('button', { name: 'Open project folder', exact: true })
  await expect(openProjectButton).toBeEnabled()
  await openProjectButton.click()
  await expect.poll(() => getProjectDirectoryPickerCallCount(electronApp)).toBe(1)

  const projectRouteID = await waitForNonGlobalProjectRoute(page)
  await expect(page.getByText('Project not found.').first()).toHaveCount(0)
  expect(projectRouteID, 'temp workspace should use a directory-derived project route').toMatch(
    /^dir-/
  )
  await expect
    .poll(() => page.evaluate(() => window.api.listOpenedProjectFolders()))
    .toContainEqual(
      expect.objectContaining({ directory: workspaceDir, lastOpenedAt: expect.any(Number) })
    )
  return projectRouteID
}

async function waitForNonGlobalProjectRoute(page: Page): Promise<string> {
  await expect
    .poll(() => page.evaluate(() => window.location.hash), {
      message: 'opening the temp workspace through the folder picker should route to its project',
      timeout: 45_000
    })
    .toMatch(/\/projects\/(?!global(?:$|[/?#]))/)

  const projectID = getProjectIDFromHash(await page.evaluate(() => window.location.hash))
  expect(projectID, 'temp workspace route should include a concrete project id').not.toBeNull()
  return projectID!
}

async function sendPrompt(composer: ReturnType<Page['getByRole']>, prompt: string): Promise<void> {
  await composer.getByLabel('Message OpenKhodam').fill(prompt)
  await expect(composer.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
  await composer.getByRole('button', { name: 'Send', exact: true }).click()
}

async function waitForSessionRoute(page: Page): Promise<string> {
  await expect
    .poll(() => page.url(), {
      message: 'starting a conversation should route to its created session',
      timeout: 45_000
    })
    .toMatch(/#\/projects\/[^/]+\/sessions\/[^/]+$/)
  return page.url()
}

async function expectFakeProviderPrompt(
  realOpenCode: {
    fakeProvider: {
      getChatCompletionRequests: () => Array<{ promptText: string; stream: boolean }>
    }
  },
  prompt: string
): Promise<void> {
  await expect
    .poll(
      () =>
        realOpenCode.fakeProvider
          .getChatCompletionRequests()
          .some((request) => request.stream && request.promptText.includes(prompt)),
      {
        message: `the real sidecar should call the local fake provider with ${JSON.stringify(prompt)}`
      }
    )
    .toBe(true)
}

async function waitForOpenCodeProjectModelReadiness(
  page: Page,
  context: ModelReadinessContext
): Promise<void> {
  await expect
    .poll(
      async () => {
        const readiness = await readSidecarReadiness(page, context)
        return readiness.ready ? 'ready' : formatSidecarReadiness(readiness)
      },
      {
        message: 'OpenCode sidecar should list the opened temp workspace and fake provider/model',
        timeout: 45_000
      }
    )
    .toBe('ready')
}

async function expectReadyModelPicker(page: Page, context: ModelReadinessContext): Promise<void> {
  const modelPicker = page.getByRole('form', { name: 'Chat prompt' }).getByLabel('OpenCode model')

  await expect
    .poll(
      async () => {
        try {
          const value = await modelPicker.inputValue({ timeout: 1_000 })
          if (value === context.modelLabel) return 'ready'

          return `model picker value=${JSON.stringify(value)}; ${formatSidecarReadiness(
            await readSidecarReadiness(page, context)
          )}`
        } catch (error) {
          return `model picker unavailable (${formatError(error)}); ${formatSidecarReadiness(
            await readSidecarReadiness(page, context)
          )}`
        }
      },
      {
        message: 'composer model picker should select the fake OpenCode provider/model',
        timeout: 45_000
      }
    )
    .toBe('ready')
}

async function readSidecarReadiness(
  page: Page,
  context: ModelReadinessContext
): Promise<SidecarReadiness> {
  return page.evaluate(async ({ workspaceDir, providerID, modelID }) => {
    const errors: string[] = []
    const status = await window.api.getOpenCodeStatus()
    const baseReadiness = {
      ready: false,
      sidecarState: status.state,
      sidecarMessage: status.message,
      projectListed: false,
      projectID: null,
      projects: [] as Array<{ id: string; worktree: string }>,
      connectedProviders: [] as string[],
      providerFound: false,
      modelFound: false,
      providerModelIDs: [] as string[],
      defaultModelID: null,
      errors
    }

    if (status.state !== 'connected') return baseReadiness

    const connection = await window.api.getOpenCodeConnection()
    const authorization = btoa(`${connection.username}:${connection.password}`)

    async function getOpenCodeJson(path: string, query: Record<string, string> = {}) {
      try {
        const url = new URL(path, connection.url)
        for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)

        const response = await fetch(url, { headers: { authorization: `Basic ${authorization}` } })
        const text = await response.text()
        if (!response.ok) {
          errors.push(`${path} failed: ${response.status} ${text}`)
          return null
        }

        return text ? JSON.parse(text) : null
      } catch (error) {
        errors.push(`${path} failed: ${error instanceof Error ? error.message : String(error)}`)
        return null
      }
    }

    const projectsJson = await getOpenCodeJson('/project')
    const providerJson = await getOpenCodeJson('/provider', { directory: workspaceDir })

    const projects = Array.isArray(projectsJson)
      ? projectsJson.filter(isRecord).map((project) => ({
          id: getString(project.id),
          worktree: getString(project.worktree)
        }))
      : []
    const matchingProject = projects.find((project) => project.worktree === workspaceDir) ?? null

    const providerData = isRecord(providerJson) ? providerJson : {}
    const connectedProviders = getStringArray(providerData.connected)
    const providers = Array.isArray(providerData.all) ? providerData.all.filter(isRecord) : []
    const provider = providers.find((item) => getString(item.id) === providerID) ?? null
    const providerModels = isRecord(provider?.models) ? provider.models : {}
    const providerModelIDs = Object.entries(providerModels)
      .map(([fallbackID, model]) =>
        isRecord(model) ? getString(model.id) || fallbackID : fallbackID
      )
      .filter((id) => id.length > 0)
    const defaultModels = isRecord(providerData.default) ? providerData.default : {}
    const readiness = {
      ...baseReadiness,
      projectListed: matchingProject !== null,
      projectID: matchingProject?.id ?? null,
      projects,
      connectedProviders,
      providerFound: provider !== null,
      modelFound: providerModelIDs.includes(modelID),
      providerModelIDs,
      defaultModelID: getString(defaultModels[providerID]) || null
    }

    readiness.ready =
      readiness.projectListed &&
      connectedProviders.includes(providerID) &&
      readiness.providerFound &&
      readiness.modelFound
    return readiness

    function isRecord(value: unknown): value is Record<string, unknown> {
      return typeof value === 'object' && value !== null
    }

    function getString(value: unknown): string {
      return typeof value === 'string' ? value : ''
    }

    function getStringArray(value: unknown): string[] {
      return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : []
    }
  }, context)
}

function getProjectIDFromHash(hash: string): string | null {
  const match = /#\/projects\/([^/?#]+)/.exec(hash)
  if (!match) return null
  return decodeURIComponent(match[1] ?? '')
}

function formatSidecarReadiness(readiness: SidecarReadiness): string {
  return [
    `sidecar=${readiness.sidecarState} (${readiness.sidecarMessage})`,
    `projectListed=${readiness.projectListed} projectID=${readiness.projectID ?? '<none>'}`,
    `projects=${formatProjects(readiness.projects)}`,
    `connectedProviders=${formatList(readiness.connectedProviders)}`,
    `providerFound=${readiness.providerFound}`,
    `modelFound=${readiness.modelFound}`,
    `providerModelIDs=${formatList(readiness.providerModelIDs)}`,
    `defaultModelID=${readiness.defaultModelID ?? '<none>'}`,
    `errors=${formatList(readiness.errors)}`
  ].join('; ')
}

function formatProjects(projects: SidecarReadiness['projects']): string {
  if (projects.length === 0) return '<none>'
  return projects.map((project) => `${project.id || '<no-id>'}@${project.worktree}`).join(', ')
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(', ') : '<none>'
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
