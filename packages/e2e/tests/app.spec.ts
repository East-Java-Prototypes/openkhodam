import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { ElectronApplication } from '@playwright/test'
import { expect, test, type Locator, type Page } from '../fixtures/electron'

const repositoryDirectory = dirname(process.cwd())
const desktopOutDirectory = join(repositoryDirectory, 'desktop', 'out')
const fakeProjectDirectory = process.cwd()
const projectArtifactsDirectory = join(fakeProjectDirectory, '.openkhodam')
const projectArtifactsFile = join(projectArtifactsDirectory, 'artifacts.json')
const googleWorkspaceNotConfiguredMessage =
  'Google OAuth client ID or client secret is not configured.'
const googleDriveMetadataReadonlyScope = 'https://www.googleapis.com/auth/drive.metadata.readonly'
const fixtureLinkedDocUrl = 'https://docs.google.com/document/d/fixture-linked-doc/edit'
const arbitraryLinkedDocUrl = 'https://example.test/document/d/arbitrary-linked-doc/edit'
const hiddenSubagentSessionTitle = 'Hidden subagent child chat'
const hiddenSubagentUserPrompt = 'Hidden subagent user prompt'
const hiddenSubagentAssistantResponse = 'Hidden subagent assistant response'
const projectSidebar = (page: Page): Locator =>
  page.getByRole('complementary', { name: 'Project folders' })
const collapsedProjectSidebarRail = (page: Page): Locator =>
  page.getByRole('complementary', { name: 'Collapsed project sidebar' })
const projectSidebarHeader = (page: Page): Locator =>
  projectSidebar(page).locator('[data-slot="sidebar-header"]')
const projectSidebarFooter = (page: Page): Locator =>
  projectSidebar(page).locator('[data-slot="sidebar-footer"]')
const projectHeartbeatStatus = (page: Page): Locator =>
  projectSidebarFooter(page).locator('[data-slot="sidebar-heartbeat"]')
const googleDocsDocumentsScope = 'https://www.googleapis.com/auth/documents'
const projectChatLink = (page: Page): Locator =>
  page.getByRole('navigation', { name: 'Project folders' }).getByRole('link')
const projectSettingsLink = (page: Page): Locator =>
  projectSidebar(page).getByRole('link', { name: 'Settings', exact: true })
const projectHomeLink = (page: Page): Locator =>
  projectSidebar(page).getByRole('link', { name: 'Home', exact: true })
const sessionChatLink = (page: Page): Locator =>
  page.getByRole('navigation', { name: 'Project sessions' }).getByRole('link')
const selectedProjectSessions = (page: Page): Locator =>
  page.getByRole('navigation', { name: 'Project sessions' })
const messageTranscript = (page: Page): Locator => page.getByRole('region', { name: 'Messages' })
const chatActionPane = (page: Page): Locator =>
  page.getByRole('complementary', { name: 'Action pane', exact: true })
const paneControls = (page: Page): Locator => page.getByRole('toolbar', { name: 'Pane controls' })
const terminalProjectRouteState = (page: Page): Locator =>
  page.getByText('No sessions found for this project.').or(sessionChatLink(page))
const resizeTestViewport = { width: 1200, height: 700 }

type ElementBox = NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>

async function setResizeTestViewport(electronApp: ElectronApplication, page: Page): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, size) => {
    const [applicationWindow] = BrowserWindow.getAllWindows()
    if (!applicationWindow) throw new Error('Application window should exist for resize tests.')

    applicationWindow.setContentSize(size.width, size.height)
  }, resizeTestViewport)

  await expect
    .poll(async () => page.evaluate(() => window.innerWidth), {
      message: 'resize tests should use a wide app viewport'
    })
    .toBeGreaterThanOrEqual(resizeTestViewport.width)
}

async function elementBox(locator: Locator, description: string): Promise<ElementBox> {
  const box = await locator.boundingBox()
  expect(box, `${description} should have a bounding box`).not.toBeNull()
  if (!box) throw new Error(`${description} should have a bounding box`)
  return box
}

async function expectFooterHeartbeat(page: Page, locator: Locator): Promise<void> {
  await expect(locator).toBeVisible()
  await expect(locator).toHaveAttribute('role', 'img')
  await expect(locator).toHaveAttribute(
    'aria-label',
    /OpenCode (connected|disconnected)\..*(Last heartbeat:|No heartbeat received\.|Waiting for the first heartbeat\.)/
  )
  await expect(locator).toHaveAttribute(
    'title',
    /OpenCode (connected|disconnected)\..*(Last heartbeat:|No heartbeat received\.|Waiting for the first heartbeat\.)/
  )
  await expect
    .poll(
      async () =>
        locator.evaluate((element) => {
          const state = element.getAttribute('data-state')
          const dotClass =
            element.querySelector('[data-slot="sidebar-heartbeat-dot"]')?.getAttribute('class') ??
            ''

          if (state === 'connected' && dotClass.includes('bg-emerald-500')) return 'connected'
          if (state === 'disconnected' && dotClass.includes('bg-destructive')) return 'disconnected'
          return `${state ?? 'missing'}:${dotClass}`
        }),
      { message: 'footer heartbeat dot should match its connected/disconnected state' }
    )
    .toMatch(/^(connected|disconnected)$/)

  await expect
    .poll(
      () =>
        locator.evaluate((element) => {
          const visibleTextNodes = Array.from(element.querySelectorAll<HTMLElement>('*'))
            .filter((child) => {
              const text = child.textContent?.replace(/\s+/g, ' ').trim()
              if (!text || child.classList.contains('sr-only')) return false

              const style = window.getComputedStyle(child)
              const rect = child.getBoundingClientRect()
              return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1
            })
            .map((child) => child.textContent?.replace(/\s+/g, ' ').trim() ?? '')

          return visibleTextNodes
        }),
      { message: 'footer heartbeat should not visibly print a time/status label' }
    )
    .toEqual([])

  const heartbeatBox = await elementBox(locator, 'project footer heartbeat')
  expect(
    heartbeatBox.width,
    'footer heartbeat should remain a compact dot indicator'
  ).toBeLessThanOrEqual(32)
  await expect
    .poll(
      () =>
        locator.evaluate((element) => {
          const style = window.getComputedStyle(element)
          return [
            style.borderTopWidth,
            style.borderRightWidth,
            style.borderBottomWidth,
            style.borderLeftWidth
          ]
        }),
      { message: 'footer heartbeat trigger should not render a visible border' }
    )
    .toEqual(['0px', '0px', '0px', '0px'])

  const tooltipText = await locator.getAttribute('aria-label')
  expect(tooltipText, 'footer heartbeat should expose details for the tooltip').not.toBeNull()
  if (!tooltipText) throw new Error('Footer heartbeat should expose details for the tooltip.')

  const tooltip = page.getByRole('tooltip')
  await locator.hover()
  await expect(tooltip).toContainText(tooltipText)
  await page.mouse.move(0, 0)
  await expect(tooltip).toBeHidden()
  await locator.focus()
  await expect(tooltip).toContainText(tooltipText)
}

async function remToPixels(page: Page, rem: number): Promise<number> {
  return page.evaluate((value) => {
    const rootFontSize = Number.parseFloat(
      window.getComputedStyle(document.documentElement).fontSize
    )
    return value * rootFontSize
  }, rem)
}

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
  await expect(paneControls(page)).toBeVisible()
  await expect(projectHomeLink(page)).toBeVisible()
  await expect(projectSettingsLink(page)).toBeVisible()
  await expect(projectHeartbeatStatus(page)).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Project sessions' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Project folders' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Project sessions' })).toHaveCount(0)
  await expect(page.getByRole('form', { name: 'Open project by directory' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Project folders' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Project sessions' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'No chat selected' })).toBeVisible()
  await expect(page.getByText('OpenCode', { exact: true })).toHaveCount(0)
}

async function appRegion(locator: Locator): Promise<string> {
  return locator.evaluate((element) =>
    getComputedStyle(element).getPropertyValue('-webkit-app-region')
  )
}

async function expectSplitCornerPaneControls(
  titlebar: Locator,
  projectSidebarButton: Locator,
  actionPaneButton: Locator
): Promise<void> {
  const platform = await titlebar.evaluate(() => window.api.platform)
  const titlebarBox = await elementBox(titlebar, 'pane controls titlebar')
  const projectButtonBox = await elementBox(projectSidebarButton, 'project sidebar titlebar toggle')
  const actionButtonBox = await elementBox(actionPaneButton, 'action pane titlebar toggle')
  const leftSideEnd = titlebarBox.x + titlebarBox.width * 0.35
  const rightSideStart = titlebarBox.x + titlebarBox.width * 0.65
  const actionRightGap =
    titlebarBox.x + titlebarBox.width - (actionButtonBox.x + actionButtonBox.width)

  expect(
    projectButtonBox.x + projectButtonBox.width,
    'project sidebar toggle should sit in the left titlebar corner'
  ).toBeLessThan(leftSideEnd)
  expect(
    actionButtonBox.x,
    'action pane toggle should sit in the right titlebar corner'
  ).toBeGreaterThan(rightSideStart)
  expect(
    actionButtonBox.x + actionButtonBox.width,
    'action pane toggle should stay inside the titlebar'
  ).toBeLessThanOrEqual(titlebarBox.x + titlebarBox.width + 1)
  if (platform === 'darwin') {
    expect(actionRightGap, 'macOS action pane toggle should sit near the right edge').toBeLessThan(
      24
    )
  }
}

async function seedSessionLinkedDocs(sessionId: string): Promise<() => Promise<void>> {
  const previousArtifacts = await readOptionalFile(projectArtifactsFile)
  await mkdir(projectArtifactsDirectory, { recursive: true })
  await writeFile(
    projectArtifactsFile,
    `${JSON.stringify(
      {
        version: 1,
        sessions: {
          [sessionId]: [
            {
              id: 'fixture-linked-doc',
              title: 'Fixture linked Google Doc',
              url: fixtureLinkedDocUrl,
              listed: true,
              firstSeenAt: 1_800_000_000_000,
              lastSeenAt: 1_800_000_005_000,
              firstMessageId: 'message-1',
              lastMessageId: 'message-2'
            },
            {
              id: 'fixture-linked-doc-without-url',
              title: 'Fixture linked Google Doc without URL',
              url: null,
              listed: true,
              firstSeenAt: 1_800_000_006_000,
              lastSeenAt: 1_800_000_006_000,
              firstMessageId: 'message-2',
              lastMessageId: 'message-2'
            },
            {
              id: 'arbitrary-linked-doc-url',
              title: 'Arbitrary linked Google Doc URL',
              url: arbitraryLinkedDocUrl,
              listed: true,
              firstSeenAt: 1_800_000_007_000,
              lastSeenAt: 1_800_000_007_000,
              firstMessageId: 'message-2',
              lastMessageId: 'message-2'
            },
            {
              id: 'hidden-unlisted-doc',
              title: 'Hidden unlisted Google Doc',
              url: 'https://docs.google.com/document/d/hidden-unlisted-doc/edit',
              listed: false,
              firstSeenAt: 1_800_000_010_000,
              lastSeenAt: 1_800_000_010_000,
              firstMessageId: 'message-3',
              lastMessageId: 'message-3'
            }
          ]
        }
      },
      null,
      2
    )}\n`,
    'utf8'
  )

  return async () => {
    if (previousArtifacts === null) {
      await rm(projectArtifactsFile, { force: true })
      return
    }

    await writeFile(projectArtifactsFile, previousArtifacts, 'utf8')
  }
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return null
    throw error
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
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

async function waitForScrollTopToSettle(locator: Locator): Promise<void> {
  await expect
    .poll(
      async () => {
        const before = await locator.evaluate((element) => Math.round(element.scrollTop))
        await new Promise((resolve) => setTimeout(resolve, 900))
        const after = await locator.evaluate((element) => Math.round(element.scrollTop))
        return Math.abs(after - before)
      },
      { message: 'scroll position should settle after disclosure anchoring' }
    )
    .toBe(0)
}

async function installGoogleWorkspaceOAuthCapture(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(
    ({ shell }, scopes: string[]) => {
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
              scope: scopes.join(' '),
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
    },
    ['openid', 'email', 'profile', googleDriveMetadataReadonlyScope, googleDocsDocumentsScope]
  )
}

test('renders the built desktop chat shell', async ({ appWindow }) => {
  await waitForChatShell(appWindow)
  await expect(
    projectSidebarHeader(appWindow).getByText(/^(connected|starting|stopped|error)$/)
  ).toHaveCount(0)
  await expect(
    projectSidebarHeader(appWindow).getByText(/^(Live( · .*)?|Events paused)$/)
  ).toHaveCount(0)
  await expectFooterHeartbeat(appWindow, projectHeartbeatStatus(appWindow))
  const footerBox = await elementBox(projectSidebarFooter(appWindow), 'project sidebar footer')
  const heartbeatBox = await elementBox(
    projectHeartbeatStatus(appWindow),
    'project footer heartbeat'
  )
  const homeBox = await elementBox(projectHomeLink(appWindow), 'project home footer link')
  const settingsBox = await elementBox(
    projectSettingsLink(appWindow),
    'project settings footer link'
  )
  expect(heartbeatBox.x).toBeLessThan(homeBox.x)
  expect(homeBox.x).toBeLessThan(settingsBox.x)
  expect(heartbeatBox.x + heartbeatBox.width).toBeLessThanOrEqual(footerBox.x + footerBox.width + 1)
  await expect(chatActionPane(appWindow)).toBeVisible()
  await expect(chatActionPane(appWindow).getByText('No linked Google Docs yet.')).toBeVisible()
  await expect(appWindow.getByText('Select a project to view sessions.').first()).toBeVisible()
  await expect(
    appWindow
      .getByText('Select a project to view sessions.')
      .or(appWindow.getByText('Waiting for the OpenCode sidecar connection.'))
      .or(appWindow.getByText('No OpenCode projects found.'))
      .first()
  ).toBeVisible()
})

test('resizes and collapses/restores the project sidebar', async ({ appWindow, electronApp }) => {
  await setResizeTestViewport(electronApp, appWindow)
  await waitForChatShell(appWindow)

  const sidebar = appWindow.getByRole('complementary', { name: 'Project folders' })
  const resizeHandle = appWindow.getByRole('separator', { name: 'Resize project sidebar' })
  const titlebar = paneControls(appWindow)
  const collapseSidebarButton = titlebar.getByRole('button', { name: 'Collapse project sidebar' })
  const collapseActionPaneButton = titlebar.getByRole('button', { name: 'Collapse action pane' })
  const initialSidebarBox = await elementBox(sidebar, 'expanded project sidebar')
  const handleBox = await elementBox(resizeHandle, 'project sidebar resize handle')
  const formerSidebarMaxWidth = await remToPixels(appWindow, 32)

  await expect(collapseSidebarButton).toBeVisible()
  await expectSplitCornerPaneControls(titlebar, collapseSidebarButton, collapseActionPaneButton)
  await expect.poll(() => appRegion(titlebar)).toBe('drag')
  await expect.poll(() => appRegion(collapseSidebarButton)).toBe('no-drag')

  await appWindow.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await appWindow.mouse.down()
  await appWindow.mouse.move(
    handleBox.x + handleBox.width / 2 + 280,
    handleBox.y + handleBox.height / 2,
    { steps: 10 }
  )
  await appWindow.mouse.up()

  await expect
    .poll(async () => Math.round((await sidebar.boundingBox())?.width ?? 0), {
      message: 'project sidebar should resize beyond the former 32rem cap'
    })
    .toBeGreaterThan(Math.round(formerSidebarMaxWidth) + 20)
  await expect(appWindow.getByRole('heading', { name: 'No chat selected' })).toBeVisible()

  await collapseSidebarButton.click()
  const collapsedRail = appWindow.getByRole('complementary', {
    name: 'Collapsed project sidebar'
  })
  await expect(collapsedRail).toBeVisible()
  await expect(sidebar).toHaveCount(0)
  await expect(titlebar.getByRole('button', { name: 'Restore project sidebar' })).toBeVisible()
  await expect(collapsedRail.getByRole('button', { name: 'Restore project sidebar' })).toBeVisible()
  expect((await elementBox(collapsedRail, 'collapsed project sidebar rail')).width).toBeLessThan(
    initialSidebarBox.width
  )
  await expect(appWindow.getByRole('heading', { name: 'No chat selected' })).toBeVisible()

  await titlebar.getByRole('button', { name: 'Restore project sidebar' }).click()
  await expect(sidebar).toBeVisible()
  await expect(projectHomeLink(appWindow)).toBeVisible()
  await expect(projectSettingsLink(appWindow)).toBeVisible()
  await expect(appWindow.getByRole('form', { name: 'Open project by directory' })).toBeVisible()
  await expect(resizeHandle).toBeVisible()
})

test('toggles active project sessions without collapsing the project sidebar', async ({
  appWindow
}) => {
  await waitForChatShell(appWindow)

  const fakeProjectLink = projectChatLink(appWindow).filter({ hasText: 'Fake Project' })
  await expect(fakeProjectLink).toBeVisible()

  await fakeProjectLink.click()
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.toMatch(
    /\/projects\/[^/?]+$/
  )
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.not.toContain(
    'showActiveProjectSessions'
  )
  await expectOpenedProjectRouteResolved(appWindow)
  await expect(projectSidebar(appWindow)).toBeVisible()
  await expect(collapsedProjectSidebarRail(appWindow)).toHaveCount(0)
  await expect(selectedProjectSessions(appWindow)).toBeVisible()
  await expect(
    sessionChatLink(appWindow).filter({ hasText: 'Seeded deterministic chat' })
  ).toBeVisible()

  await projectChatLink(appWindow).filter({ hasText: 'Fake Project' }).click()
  await expect
    .poll(() => appWindow.evaluate(() => window.location.hash))
    .toMatch(/\/projects\/[^/?]+\?showActiveProjectSessions=false$/)
  await expect(projectSidebar(appWindow)).toBeVisible()
  await expect(collapsedProjectSidebarRail(appWindow)).toHaveCount(0)
  await expect(selectedProjectSessions(appWindow)).toHaveCount(0)

  await projectChatLink(appWindow).filter({ hasText: 'Fake Project' }).click()
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.toMatch(
    /\/projects\/[^/?]+$/
  )
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.not.toContain(
    'showActiveProjectSessions'
  )
  await expect(projectSidebar(appWindow)).toBeVisible()
  await expect(collapsedProjectSidebarRail(appWindow)).toHaveCount(0)
  await expect(selectedProjectSessions(appWindow)).toBeVisible()
  await expect(
    sessionChatLink(appWindow).filter({ hasText: 'Seeded deterministic chat' })
  ).toBeVisible()

  await sessionChatLink(appWindow).filter({ hasText: 'Seeded deterministic chat' }).click()
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.toMatch(
    /\/projects\/fake-project\/sessions\/seeded-session$/
  )
  await expect(appWindow.getByRole('heading', { name: 'Seeded deterministic chat' })).toBeVisible()

  await projectChatLink(appWindow).filter({ hasText: 'Fake Project' }).click()
  await expect
    .poll(() => appWindow.evaluate(() => window.location.hash))
    .toMatch(/\/projects\/fake-project\/sessions\/seeded-session\?showActiveProjectSessions=false$/)
  await expect(projectSidebar(appWindow)).toBeVisible()
  await expect(collapsedProjectSidebarRail(appWindow)).toHaveCount(0)
  await expect(selectedProjectSessions(appWindow)).toHaveCount(0)
  await expect(appWindow.getByRole('heading', { name: 'Seeded deterministic chat' })).toBeVisible()

  await projectChatLink(appWindow).filter({ hasText: 'Fake Project' }).click()
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.toMatch(
    /\/projects\/fake-project\/sessions\/seeded-session$/
  )
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.not.toContain(
    'showActiveProjectSessions'
  )
  await expect(selectedProjectSessions(appWindow)).toBeVisible()
  await expect(appWindow.getByRole('heading', { name: 'Seeded deterministic chat' })).toBeVisible()

  await appWindow.evaluate(() => {
    window.location.hash = '#/projects/other-project?showActiveProjectSessions=false'
  })
  await expect
    .poll(() => appWindow.evaluate(() => window.location.hash))
    .toMatch(/\/projects\/other-project\?showActiveProjectSessions=false$/)
  await expect(projectSidebar(appWindow)).toBeVisible()
  await expect(collapsedProjectSidebarRail(appWindow)).toHaveCount(0)

  await projectChatLink(appWindow).filter({ hasText: 'Fake Project' }).click()
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.toMatch(
    /\/projects\/fake-project$/
  )
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.not.toContain(
    'showActiveProjectSessions'
  )
  await expect(selectedProjectSessions(appWindow)).toBeVisible()
})

test('resizes and collapses/restores the chat action pane', async ({ appWindow, electronApp }) => {
  const restoreProjectArtifacts = await seedSessionLinkedDocs('structured-session')

  try {
    await setResizeTestViewport(electronApp, appWindow)
    await openStructuredFixtureChat(appWindow)

    const actionPane = chatActionPane(appWindow)
    const resizeHandle = appWindow.getByRole('separator', { name: 'Resize action pane' })
    const titlebar = paneControls(appWindow)
    const collapseSidebarButton = titlebar.getByRole('button', { name: 'Collapse project sidebar' })
    const collapseActionPaneButton = titlebar.getByRole('button', { name: 'Collapse action pane' })
    const initialActionPaneBox = await elementBox(actionPane, 'expanded action pane')
    const handleBox = await elementBox(resizeHandle, 'action pane resize handle')
    const formerActionPaneMaxWidth = await remToPixels(appWindow, 30)

    await expect(collapseActionPaneButton).toBeVisible()
    await expectSplitCornerPaneControls(titlebar, collapseSidebarButton, collapseActionPaneButton)
    await expect.poll(() => appRegion(titlebar)).toBe('drag')
    await expect.poll(() => appRegion(collapseActionPaneButton)).toBe('no-drag')
    await expect(actionPane.getByRole('heading', { name: 'Linked Google Docs' })).toHaveCount(0)
    const linkedDocToggle = actionPane.getByRole('button', {
      name: 'Toggle linked Google Doc Fixture linked Google Doc',
      exact: true
    })
    const linkedDocPreviewToggle = actionPane.getByRole('button', {
      name: 'Toggle linked Google Doc preview Fixture linked Google Doc',
      exact: true
    })
    const linkedDocOpenLink = actionPane.getByRole('link', {
      name: 'Open linked Google Doc Fixture linked Google Doc in Google Docs'
    })
    await expect(linkedDocToggle).toBeVisible()
    await expect(linkedDocPreviewToggle).toBeVisible()
    await expect(actionPane.getByText('Doc ID: fixture-linked-doc')).toHaveCount(0)
    await expect(linkedDocOpenLink).toBeVisible()
    await expect(linkedDocOpenLink).toHaveAttribute('href', fixtureLinkedDocUrl)
    await expect(linkedDocOpenLink).toHaveAttribute('target', '_blank')
    await expect(
      actionPane.getByRole('region', {
        name: 'Google Docs browser preview for Fixture linked Google Doc'
      })
    ).toHaveCount(0)
    await linkedDocPreviewToggle.click()
    const browserPreview = actionPane.getByRole('region', {
      name: 'Google Docs browser preview for Fixture linked Google Doc'
    })
    await expect(browserPreview).toBeVisible()
    await expect(browserPreview.locator('webview')).toHaveAttribute('src', fixtureLinkedDocUrl)
    await expect
      .poll(
        async () =>
          browserPreview
            .locator('webview')
            .evaluate(
              (element) => typeof (element as { getWebContentsId?: unknown }).getWebContentsId
            ),
        { message: 'linked Google Doc preview should be an Electron webview' }
      )
      .toBe('function')
    await expect(actionPane.getByText('Preview', { exact: true })).toHaveCount(0)
    await expect(actionPane.getByText('Browser preview', { exact: true })).toHaveCount(0)
    await expect(actionPane.getByText('Preview placeholder')).toHaveCount(0)
    await expect(actionPane.getByText('Title', { exact: true })).toHaveCount(0)
    await expect(actionPane.getByText('Doc ID', { exact: true })).toHaveCount(0)
    await expect(actionPane.getByText('Google Docs URL', { exact: true })).toHaveCount(0)
    await expect(actionPane.getByText('First linked', { exact: true })).toHaveCount(0)
    await expect(actionPane.getByText('Last linked', { exact: true })).toHaveCount(0)
    await linkedDocToggle.click()
    await expect(browserPreview).toHaveCount(0)
    const noUrlLinkedDocToggle = actionPane.getByRole('button', {
      name: 'Toggle linked Google Doc Fixture linked Google Doc without URL'
    })
    await expect(noUrlLinkedDocToggle).toBeVisible()
    await expect(
      actionPane.getByRole('link', {
        name: 'Open linked Google Doc Fixture linked Google Doc without URL in Google Docs'
      })
    ).toHaveCount(0)
    await noUrlLinkedDocToggle.click()
    const noUrlBrowserPreview = actionPane.getByRole('region', {
      name: 'Google Docs browser preview for Fixture linked Google Doc without URL'
    })
    await expect(noUrlBrowserPreview).toBeVisible()
    await expect(noUrlBrowserPreview.locator('webview')).toHaveCount(0)
    await expect(
      noUrlBrowserPreview
        .getByText('No Google Docs URL was stored, so no browser preview can be loaded.')
        .first()
    ).toBeVisible()
    await noUrlLinkedDocToggle.click()
    await expect(noUrlBrowserPreview).toHaveCount(0)
    const arbitraryUrlLinkedDocToggle = actionPane.getByRole('button', {
      name: 'Toggle linked Google Doc Arbitrary linked Google Doc URL'
    })
    const arbitraryUrlOpenLink = actionPane.getByRole('link', {
      name: 'Open linked Google Doc Arbitrary linked Google Doc URL in Google Docs'
    })
    await expect(arbitraryUrlLinkedDocToggle).toBeVisible()
    await expect(arbitraryUrlOpenLink).toHaveAttribute('href', arbitraryLinkedDocUrl)
    await expect(arbitraryUrlOpenLink).toHaveAttribute('target', '_blank')
    await arbitraryUrlLinkedDocToggle.scrollIntoViewIfNeeded()
    await arbitraryUrlLinkedDocToggle.click()
    const arbitraryUrlBrowserPreview = actionPane.getByRole('region', {
      name: 'Google Docs browser preview for Arbitrary linked Google Doc URL'
    })
    await expect(arbitraryUrlBrowserPreview).toBeVisible()
    await expect(arbitraryUrlBrowserPreview.locator('webview')).toHaveAttribute(
      'src',
      arbitraryLinkedDocUrl
    )
    await expect(
      actionPane.getByRole('button', { name: 'Select linked Google Doc Fixture linked Google Doc' })
    ).toHaveCount(0)
    await expect(actionPane.getByText('Hidden unlisted Google Doc')).toHaveCount(0)
    await expect(actionPane.getByRole('button', { name: 'Select artifact read' })).toHaveCount(0)
    await expect(actionPane.getByRole('button', { name: 'Select artifact plan' })).toHaveCount(0)
    await expect(actionPane.getByRole('button', { name: 'Select artifact bash' })).toHaveCount(0)
    await expect(actionPane.getByText('V1 fixture tool output', { exact: true })).toHaveCount(0)
    await expect(actionPane.getByText('V2 fixture tool output', { exact: true })).toHaveCount(0)

    await appWindow.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2
    )
    await appWindow.mouse.down()
    await appWindow.mouse.move(
      handleBox.x + handleBox.width / 2 - 300,
      handleBox.y + handleBox.height / 2,
      { steps: 10 }
    )
    await appWindow.mouse.up()

    await expect
      .poll(async () => Math.round((await actionPane.boundingBox())?.width ?? 0), {
        message: 'action pane should resize beyond the former 30rem cap'
      })
      .toBeGreaterThan(Math.round(formerActionPaneMaxWidth) + 20)
    await expect(appWindow.getByRole('form', { name: 'Chat prompt' })).toBeVisible()

    await collapseActionPaneButton.click()
    const collapsedRail = appWindow.getByRole('complementary', { name: 'Collapsed action pane' })
    await expect(collapsedRail).toBeVisible()
    await expect(actionPane).toHaveCount(0)
    await expect(titlebar.getByRole('button', { name: 'Restore action pane' })).toBeVisible()
    await expect(collapsedRail.getByRole('button', { name: 'Restore action pane' })).toBeVisible()
    expect((await elementBox(collapsedRail, 'collapsed action pane rail')).width).toBeLessThan(
      initialActionPaneBox.width
    )
    await expect(appWindow.getByRole('form', { name: 'Chat prompt' })).toBeVisible()

    await titlebar.getByRole('button', { name: 'Restore action pane' }).click()
    await expect(actionPane).toBeVisible()
    await expect(resizeHandle).toBeVisible()
    const restoredLinkedDocToggle = actionPane.getByRole('button', {
      name: 'Toggle linked Google Doc Fixture linked Google Doc',
      exact: true
    })
    const restoredLinkedDocPreviewToggle = actionPane.getByRole('button', {
      name: 'Toggle linked Google Doc preview Fixture linked Google Doc',
      exact: true
    })
    const restoredLinkedDocOpenLink = actionPane.getByRole('link', {
      name: 'Open linked Google Doc Fixture linked Google Doc in Google Docs'
    })
    await expect(restoredLinkedDocToggle).toBeVisible()
    await expect(restoredLinkedDocPreviewToggle).toBeVisible()
    await expect(restoredLinkedDocOpenLink).toBeVisible()
    await expect(restoredLinkedDocOpenLink).toHaveAttribute('href', fixtureLinkedDocUrl)
    await expect(
      actionPane.getByRole('region', {
        name: 'Google Docs browser preview for Fixture linked Google Doc'
      })
    ).toHaveCount(0)
    await restoredLinkedDocPreviewToggle.click()
    await expect(
      actionPane.getByRole('button', { name: 'Select linked Google Doc Fixture linked Google Doc' })
    ).toHaveCount(0)
    const restoredBrowserPreview = actionPane.getByRole('region', {
      name: 'Google Docs browser preview for Fixture linked Google Doc'
    })
    await expect(restoredBrowserPreview).toBeVisible()
    await expect(restoredBrowserPreview.locator('webview')).toHaveAttribute(
      'src',
      fixtureLinkedDocUrl
    )
    await expect(actionPane.getByText('Preview', { exact: true })).toHaveCount(0)
    await expect(actionPane.getByText('Browser preview', { exact: true })).toHaveCount(0)
    await expect(actionPane.getByText('Preview placeholder')).toHaveCount(0)
  } finally {
    await restoreProjectArtifacts()
  }
})

test('opens a project by directory from the final chat shell', async ({ appWindow }) => {
  await waitForChatShell(appWindow)

  const directoryInput = appWindow.getByLabel('Project directory')
  const openProjectForm = appWindow.getByRole('form', { name: 'Open project by directory' })
  const openButton = openProjectForm.getByRole('button', { name: 'Open', exact: true })

  await expect(openButton).toBeDisabled()
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

  await directoryInput.fill(repositoryDirectory)
  await expect(openButton).toBeEnabled()
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
  const transcript = messageTranscript(appWindow)
  await expect(transcript).toBeVisible()
  await expect(transcript.getByRole('log')).toBeVisible()
  await expect(transcript.locator('[data-slot="message-scroller-item"]')).toHaveCount(2)
  await expect(appWindow.getByRole('article', { name: /user message at/ })).toBeVisible()
  await expect(appWindow.getByRole('article', { name: /assistant message at/ })).toBeVisible()
  await expect(appWindow.getByText('Seeded user prompt')).toBeVisible()
  await expect(appWindow.getByText('Seeded assistant response')).toBeVisible()
})

test('filters parented subagent sessions from normal chat rendering', async ({ appWindow }) => {
  await waitForChatShell(appWindow)
  await projectChatLink(appWindow).filter({ hasText: 'Fake Project' }).click()
  await expectOpenedProjectRouteResolved(appWindow)

  await expect(
    sessionChatLink(appWindow).filter({ hasText: 'Seeded deterministic chat' })
  ).toBeVisible()
  await expect(
    selectedProjectSessions(appWindow).getByText(hiddenSubagentSessionTitle)
  ).toHaveCount(0)

  await sessionChatLink(appWindow).filter({ hasText: 'Seeded deterministic chat' }).click()
  await expect(appWindow.getByRole('heading', { name: 'Seeded deterministic chat' })).toBeVisible()
  await expect(appWindow.getByText('Seeded user prompt')).toBeVisible()
  await expect(appWindow.getByText('Seeded assistant response')).toBeVisible()

  await appWindow.evaluate(() => {
    window.location.hash = '#/projects/fake-project/sessions/child-subagent-session'
  })
  await expect
    .poll(() => appWindow.evaluate(() => window.location.hash))
    .toMatch(/\/projects\/fake-project\/sessions\/child-subagent-session$/)
  await expect(appWindow.getByText('Session not found.')).toBeVisible()
  await expect(appWindow.getByRole('heading', { name: 'No chat selected' })).toBeVisible()
  await expect(appWindow.getByRole('button', { name: 'Send' })).toBeDisabled()
  await expect(appWindow.getByText(hiddenSubagentSessionTitle)).toHaveCount(0)
  await expect(appWindow.getByText(hiddenSubagentUserPrompt)).toHaveCount(0)
  await expect(appWindow.getByText(hiddenSubagentAssistantResponse)).toHaveCount(0)
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

  const transcript = messageTranscript(appWindow)
  const tool = appWindow.locator('[aria-label="Tool plan"]')
  const toggle = tool.getByRole('button', { name: 'Toggle details for tool plan' })

  await expect(transcript).toBeVisible()
  await expect(transcript.getByRole('log')).toBeVisible()
  await expect(toggle).toBeVisible()
  await toggle.click()
  await expect(tool).toContainText('Long tool output line 80')
  await expect(toggle).toBeVisible()
  await expect
    .poll(() => transcript.evaluate((element) => element.scrollHeight > element.clientHeight))
    .toBe(true)
  await waitForScrollTopToSettle(transcript)

  await transcript.evaluate((element) => {
    element.scrollTop = 0
  })
  await expect.poll(() => transcript.evaluate((element) => Math.round(element.scrollTop))).toBe(0)

  await transcript.focus()
  await transcript.press('End')
  await expect
    .poll(() => transcript.evaluate((element) => Math.round(element.scrollTop)))
    .toBeGreaterThan(0)
  const endScrollTop = await transcript.evaluate((element) => Math.round(element.scrollTop))

  await transcript.press('Home')
  await expect
    .poll(() => transcript.evaluate((element) => Math.round(element.scrollTop)))
    .toBeLessThan(endScrollTop)
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

test('sends the chat composer with CommandOrControl+Enter while Enter stays multiline', async ({
  appWindow
}) => {
  await openSeededDeterministicChat(appWindow)

  const promptInput = appWindow.getByLabel('Message OpenKhodam')
  const sendButton = appWindow.getByRole('button', { name: 'Send' })
  await expect(sendButton).toBeDisabled()

  await promptInput.press('ControlOrMeta+Enter')
  await expect(promptInput).toHaveValue('')
  await expect(appWindow.getByRole('article')).toHaveCount(2)

  await promptInput.fill('Line one')
  await promptInput.press('Enter')
  await expect(promptInput).toHaveValue('Line one\n')
  await promptInput.pressSequentially('Line two')
  await expect(promptInput).toHaveValue('Line one\nLine two')
  await expect(appWindow.getByRole('article')).toHaveCount(2)

  const shortcutPrompt = 'Shortcut lifecycle prompt'
  await promptInput.fill(shortcutPrompt)
  await expect(sendButton).toBeEnabled()
  await promptInput.press('ControlOrMeta+Enter')

  await expect(appWindow.getByText(shortcutPrompt, { exact: true })).toBeVisible()
  await expect(
    appWindow.locator('[data-pending="true"]').filter({ hasText: shortcutPrompt })
  ).toBeVisible()
  await expect(appWindow.getByText(`Fake response for: ${shortcutPrompt}`)).toBeVisible()
  await expect(
    appWindow.locator('[data-pending="true"]').filter({ hasText: shortcutPrompt })
  ).toHaveCount(0)
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

test('shows the real live events footer heartbeat without fake SSE data', async ({ appWindow }) => {
  await waitForChatShell(appWindow)
  await expect(
    projectSidebarHeader(appWindow).getByText(/^(Live( · .*)?|Events paused)$/)
  ).toHaveCount(0)
  await expectFooterHeartbeat(appWindow, projectHeartbeatStatus(appWindow))
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
    plugin: [
      join(desktopOutDirectory, 'opencode-plugins', 'openkhodam-poc.mjs'),
      join(desktopOutDirectory, 'opencode-plugins', 'google-workspace.mjs')
    ]
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
  await expect(chatActionPane(appWindow)).toHaveCount(0)
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
  await expect(appWindow.getByText('OpenCode', { exact: true })).toHaveCount(0)
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
    expect(authUrl.searchParams.get('scope')?.split(' ').sort()).toEqual(
      [
        'email',
        googleDocsDocumentsScope,
        googleDriveMetadataReadonlyScope,
        'openid',
        'profile'
      ].sort()
    )

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
      scopes: [
        'email',
        googleDocsDocumentsScope,
        googleDriveMetadataReadonlyScope,
        'openid',
        'profile'
      ],
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
