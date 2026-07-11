import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import type { ElectronApplication } from '@playwright/test'
import { expect, test, type Locator, type Page } from '../fixtures/electron'
import {
  getProjectDirectoryPickerCallCount,
  installProjectDirectoryPickerMock
} from '../fixtures/project-directory-picker'

const repositoryDirectory = dirname(process.cwd())
const desktopOutDirectory = join(repositoryDirectory, 'desktop', 'out')
const fakeProjectDirectory = process.cwd()
const projectArtifactsDirectory = join(fakeProjectDirectory, '.openkhodam')
const projectArtifactsFile = join(projectArtifactsDirectory, 'artifacts.json')
const googleWorkspaceNotConfiguredMessage =
  'Google OAuth client ID or client secret is not configured.'
const emptyOpenedProjectsMessage = 'No opened project folders yet.'
const googleDriveMetadataReadonlyScope = 'https://www.googleapis.com/auth/drive.metadata.readonly'
const googleSheetsSpreadsheetsScope = 'https://www.googleapis.com/auth/spreadsheets'
const fixtureLinkedDocUrl = 'https://docs.google.com/document/d/fixture-linked-doc/edit'
const arbitraryLinkedDocUrl = 'https://example.test/document/d/arbitrary-linked-doc/edit'
const hiddenSubagentSessionTitle = 'Hidden subagent child chat'
const hiddenSubagentUserPrompt = 'Hidden subagent user prompt'
const hiddenSubagentAssistantResponse = 'Hidden subagent assistant response'
const unsupportedSlashCommands = [
  '/redo',
  '/new',
  '/compact',
  '/fork',
  '/share',
  '/terminal',
  '/mcp'
]
const removedComposerHelperCopy = [
  'Send to the selected session.',
  'Select a connected OpenCode model before sending.',
  'Start a new conversation in this project.'
]
const projectSidebar = (page: Page): Locator =>
  page.getByRole('complementary', { name: 'Projects' })
const collapsedProjectSidebarRail = (page: Page): Locator =>
  page.getByRole('complementary', { name: 'Collapsed project sidebar' })
const projectSidebarHeader = (page: Page): Locator =>
  projectSidebar(page).locator('[data-slot="sidebar-header"]')
const projectSidebarFooter = (page: Page): Locator =>
  projectSidebar(page).locator('[data-slot="sidebar-footer"]')
const projectHeartbeatStatus = (page: Page): Locator =>
  projectSidebarFooter(page).locator('[data-slot="sidebar-heartbeat"]')
const googleDocsDocumentsScope = 'https://www.googleapis.com/auth/documents'
const fixtureLinkedSheetUrl = 'https://docs.google.com/spreadsheets/d/fixture-linked-sheet/edit'
const projectChatLink = (page: Page): Locator =>
  page.getByRole('navigation', { name: 'Projects' }).getByRole('link')
const projectNewConversationLink = (page: Page, projectName: string): Locator =>
  page
    .getByRole('navigation', { name: 'Projects' })
    .getByRole('link', { name: `Start new conversation in ${projectName}`, exact: true })
const projectSettingsLink = (page: Page): Locator =>
  projectSidebar(page).getByRole('link', { name: 'Settings', exact: true })
const projectHomeLink = (page: Page): Locator =>
  projectSidebar(page).getByRole('link', { name: 'Home', exact: true })
const openProjectFolderButton = (page: Page): Locator =>
  projectSidebar(page).getByRole('button', { name: 'Open project folder', exact: true })
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
type MessageSurfaceBubbleStyles = {
  hasVisibleBorder: boolean
  hasBackground: boolean
  hasShadow: boolean
  hasPadding: boolean
  backgroundColor: string
  borderStyles: string[]
  borderWidths: string[]
  boxShadow: string
  padding: string[]
}

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

async function messageSurfaceBubbleStyles(locator: Locator): Promise<MessageSurfaceBubbleStyles> {
  return locator.evaluate((surface) => {
    const style = window.getComputedStyle(surface)
    const borderStyles = [
      style.borderTopStyle,
      style.borderRightStyle,
      style.borderBottomStyle,
      style.borderLeftStyle
    ]
    const borderWidths = [
      style.borderTopWidth,
      style.borderRightWidth,
      style.borderBottomWidth,
      style.borderLeftWidth
    ]
    const padding = [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]
    const transparentBackgrounds = new Set(['rgba(0, 0, 0, 0)', 'transparent'])

    return {
      hasVisibleBorder: borderWidths.some((width, index) => {
        const borderStyle = borderStyles[index]
        return Number.parseFloat(width) > 0 && borderStyle !== 'none' && borderStyle !== 'hidden'
      }),
      hasBackground: !transparentBackgrounds.has(style.backgroundColor),
      hasShadow: style.boxShadow !== '' && style.boxShadow !== 'none',
      hasPadding: padding.some((value) => Number.parseFloat(value) > 0),
      backgroundColor: style.backgroundColor,
      borderStyles,
      borderWidths,
      boxShadow: style.boxShadow,
      padding
    }
  })
}

async function expectPlainAssistantSurface(locator: Locator, description: string): Promise<void> {
  await expect(locator, `${description} should be visible`).toBeVisible()
  const styles = await messageSurfaceBubbleStyles(locator)

  expect(styles, `${description} should not render an outer chat bubble`).toMatchObject({
    hasVisibleBorder: false,
    hasBackground: false,
    hasShadow: false,
    hasPadding: false
  })
}

async function expectUserBubbleSurface(locator: Locator, description: string): Promise<void> {
  await expect(locator, `${description} should be visible`).toBeVisible()
  const styles = await messageSurfaceBubbleStyles(locator)

  expect(styles, `${description} should keep user chat bubble styling`).toMatchObject({
    hasVisibleBorder: true,
    hasBackground: true,
    hasShadow: true,
    hasPadding: true
  })
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
  await expect(page.getByRole('heading', { name: 'Project sessions' })).toHaveCount(0)
  await expect(openProjectFolderButton(page)).toBeVisible()
  await expect(openProjectFolderButton(page)).toHaveAttribute('title', 'Open project folder')
  await expect(page.getByRole('form', { name: 'Open project by directory' })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Projects' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Project sessions' })).toHaveCount(0)
  await expect(chatActionPane(page)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'No chat selected' })).toBeVisible()
  await expect(page.getByText('OpenCode', { exact: true })).toHaveCount(0)
}

async function expectFreshProjectSidebarWithoutRawOpenCodeProjects(page: Page): Promise<void> {
  await expect(projectChatLink(page).filter({ hasText: 'Fake Project' })).toHaveCount(0)
  await expect(
    page.getByRole('navigation', { name: 'Projects' }).getByText(fakeProjectDirectory, {
      exact: true
    })
  ).toHaveCount(0)
  await expect(projectChatLink(page).filter({ hasText: 'Global' })).toHaveCount(0)
  await expect(page.getByText(emptyOpenedProjectsMessage)).toBeVisible()
}

async function recordOpenedProjectFolder(page: Page, directory: string): Promise<void> {
  await page.evaluate((projectDirectory) => {
    return window.api.recordOpenedProjectFolder({ directory: projectDirectory })
  }, directory)
}

async function seedOpenedFakeProject(page: Page): Promise<void> {
  await waitForChatShell(page)
  if ((await projectChatLink(page).filter({ hasText: 'Fake Project' }).count()) > 0) return

  await recordOpenedProjectFolder(page, fakeProjectDirectory)
  await page.reload()
  await waitForChatShell(page)
  await expect(projectChatLink(page).filter({ hasText: 'Fake Project' })).toBeVisible()
}

async function expectChatComposerWithoutHelperCopy(page: Page): Promise<void> {
  const chatPrompt = page.getByRole('form', { name: 'Chat prompt' })

  await expect(chatPrompt).toBeVisible()
  await expect(page.getByLabel('OpenCode model')).toBeVisible()
  await expect(page.getByLabel('Message OpenKhodam')).toBeVisible()
  await expect(chatPrompt.getByRole('button', { name: 'Send', exact: true })).toBeVisible()
  for (const helperCopy of removedComposerHelperCopy) {
    await expect(page.getByText(helperCopy)).toBeHidden()
  }
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
              id: 'fixture-linked-sheet',
              title: 'Fixture linked Google Sheet',
              type: 'google.sheet.spreadsheet',
              url: fixtureLinkedSheetUrl,
              listed: true,
              firstSeenAt: 1_800_000_005_500,
              lastSeenAt: 1_800_000_005_500,
              firstMessageId: 'message-2',
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
            },
            {
              id: 'hidden-unlisted-sheet',
              title: 'Hidden unlisted Google Sheet',
              type: 'google.sheet.spreadsheet',
              url: 'https://docs.google.com/spreadsheets/d/hidden-unlisted-sheet/edit',
              listed: false,
              firstSeenAt: 1_800_000_011_000,
              lastSeenAt: 1_800_000_011_000,
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
  await seedOpenedFakeProject(page)
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
  await seedOpenedFakeProject(page)
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

async function fakeSessionMessageTexts(
  fakeOpenCodeServer: { url: string },
  sessionID: string
): Promise<string[]> {
  const response = await fetch(`${fakeOpenCodeServer.url}/session/${sessionID}/message`)
  expect(response.ok).toBe(true)
  const messages = (await response.json()) as unknown[]
  return messages.flatMap((message) => fakeMessageTextParts(message))
}

function fakeMessageTextParts(message: unknown): string[] {
  if (!isRecord(message) || !Array.isArray(message.parts)) return []
  return message.parts.flatMap((part) => {
    if (!isRecord(part)) return []
    return typeof part.text === 'string' ? [part.text] : []
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function expectSlashCommandPopoverShowsOnlyUndo(page: Page): Promise<Locator> {
  const popover = page.getByRole('dialog', { name: 'Slash commands' })

  await expect(popover).toBeVisible()
  await expect(popover.getByText('/undo', { exact: true })).toBeVisible()
  await expect(popover.getByText('Undo last prompt', { exact: true })).toBeVisible()
  await expect(
    popover.getByText('Revert the last prompt and restore it to the composer.', { exact: true })
  ).toBeVisible()
  const composer = page
    .getByLabel('Message OpenKhodam')
    .locator('xpath=ancestor::*[@data-slot="input-group"]')
  await expect
    .poll(
      async () => {
        const [popoverBox, composerBox] = await Promise.all([
          popover.boundingBox(),
          composer.boundingBox()
        ])
        if (!popoverBox || !composerBox) return Number.POSITIVE_INFINITY
        return Math.abs(popoverBox.width - composerBox.width)
      },
      { message: 'slash command popover width should settle to the composer width' }
    )
    .toBeLessThanOrEqual(1)
  for (const command of unsupportedSlashCommands) {
    await expect(popover.getByText(command, { exact: true })).toHaveCount(0)
  }

  return popover
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
    [
      'openid',
      'email',
      'profile',
      googleDriveMetadataReadonlyScope,
      googleDocsDocumentsScope,
      googleSheetsSpreadsheetsScope
    ]
  )
}

async function installProviderOAuthCapture(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ shell }) => {
    const globalObject = globalThis as any
    globalObject.__providerOAuthCapture = { authUrl: null }
    shell.openExternal = async (url: string) => {
      globalObject.__providerOAuthCapture.authUrl = String(url)
      return undefined
    }
  })
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
  await expect(
    chatActionPane(appWindow).getByText('No linked Google Workspace artifacts yet.')
  ).toBeVisible()
  await expect(
    chatActionPane(appWindow).getByText(/Google Docs and Sheets linked to this chat/)
  ).toBeVisible()
  const transcript = messageTranscript(appWindow)
  await expect(transcript).toBeVisible()
  await expect(transcript.getByText('Select a project to view sessions.')).toHaveCount(0)
  await expect(transcript.getByText('Select a session to view messages.')).toHaveCount(0)
  await expect(
    appWindow
      .getByText('Waiting for the OpenCode sidecar connection.')
      .or(appWindow.getByText(emptyOpenedProjectsMessage))
      .or(projectChatLink(appWindow))
      .first()
  ).toBeVisible()
})

test('renders basename project labels and opens the project new-conversation shell from the plus affordance', async ({
  appWindow
}) => {
  const fallbackProjectName = basename(fakeProjectDirectory)
  await appWindow.route('**/project', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue()
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'fallback-project',
          worktree: fakeProjectDirectory,
          time: { created: Date.now(), updated: Date.now() },
          sandboxes: []
        }
      ])
    })
  })

  await recordOpenedProjectFolder(appWindow, fakeProjectDirectory)
  await appWindow.reload()
  await waitForChatShell(appWindow)

  const projectNavigation = appWindow.getByRole('navigation', { name: 'Projects' })
  const fallbackProjectLink = projectNavigation.getByRole('link', {
    name: fallbackProjectName,
    exact: true
  })
  const newConversationLink = projectNewConversationLink(appWindow, fallbackProjectName)

  await expect(fallbackProjectLink).toBeVisible()
  await expect(projectNavigation.getByText(fakeProjectDirectory, { exact: true })).toHaveCount(0)
  await expect(newConversationLink).toBeVisible()
  await expect(newConversationLink).toHaveText('+')
  const newConversationBox = await elementBox(
    newConversationLink,
    'project new-conversation affordance'
  )
  const fallbackProjectBox = await elementBox(fallbackProjectLink, 'project row link')
  expect(newConversationBox.width).toBeGreaterThanOrEqual(40)
  expect(newConversationBox.height).toBeGreaterThanOrEqual(40)
  expect(newConversationBox.x).toBeGreaterThanOrEqual(
    fallbackProjectBox.x + fallbackProjectBox.width
  )

  await fallbackProjectLink.click()
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.toMatch(
    /\/projects\/dir-[^/]+$/
  )
  await expectOpenedProjectRouteResolved(appWindow)
  await sessionChatLink(appWindow).filter({ hasText: 'Seeded deterministic chat' }).click()
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.toMatch(
    /\/projects\/dir-[^/]+\/sessions\/seeded-session$/
  )
  await expect(chatActionPane(appWindow)).toBeVisible()
  await expect(appWindow.getByRole('heading', { name: 'Seeded deterministic chat' })).toBeVisible()

  await newConversationLink.click()
  await expect
    .poll(() => appWindow.evaluate(() => window.location.hash))
    .toMatch(/\/projects\/dir-[^/]+$/)
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.not.toContain(
    'showActiveProjectSessions'
  )
  await expect(appWindow.getByRole('heading', { name: 'No chat selected' })).toBeVisible()
  await expectChatComposerWithoutHelperCopy(appWindow)
  await expect(selectedProjectSessions(appWindow)).toBeVisible()
})

test('resizes and collapses/restores the project sidebar', async ({ appWindow, electronApp }) => {
  await setResizeTestViewport(electronApp, appWindow)
  await waitForChatShell(appWindow)

  const sidebar = appWindow.getByRole('complementary', { name: 'Projects' })
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
  await expect(openProjectFolderButton(appWindow)).toBeVisible()
  await expect(appWindow.getByRole('form', { name: 'Open project by directory' })).toHaveCount(0)
  await expect(resizeHandle).toBeVisible()
})

test('toggles active project sessions without collapsing the project sidebar', async ({
  appWindow
}) => {
  await seedOpenedFakeProject(appWindow)

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
    /\/projects\/[^/]+\/sessions\/seeded-session$/
  )
  await expect(appWindow.getByRole('heading', { name: 'Seeded deterministic chat' })).toBeVisible()

  await projectChatLink(appWindow).filter({ hasText: 'Fake Project' }).click()
  await expect
    .poll(() => appWindow.evaluate(() => window.location.hash))
    .toMatch(/\/projects\/[^/]+\/sessions\/seeded-session\?showActiveProjectSessions=false$/)
  await expect(projectSidebar(appWindow)).toBeVisible()
  await expect(collapsedProjectSidebarRail(appWindow)).toHaveCount(0)
  await expect(selectedProjectSessions(appWindow)).toHaveCount(0)
  await expect(appWindow.getByRole('heading', { name: 'Seeded deterministic chat' })).toBeVisible()

  await projectChatLink(appWindow).filter({ hasText: 'Fake Project' }).click()
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.toMatch(
    /\/projects\/[^/]+\/sessions\/seeded-session$/
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
    /\/projects\/[^/]+$/
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
    await seedOpenedFakeProject(appWindow)
    await expect(projectChatLink(appWindow).filter({ hasText: 'Fake Project' })).toBeVisible()
    await projectChatLink(appWindow).filter({ hasText: 'Fake Project' }).click()
    await expectOpenedProjectRouteResolved(appWindow)
    await sessionChatLink(appWindow).filter({ hasText: 'Structured fixture chat' }).click()

    const actionPane = chatActionPane(appWindow)
    const titlebar = paneControls(appWindow)
    const collapseSidebarButton = titlebar.getByRole('button', { name: 'Collapse project sidebar' })
    const collapseActionPaneButton = titlebar.getByRole('button', { name: 'Collapse action pane' })
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
    const chatPanel = appWindow.locator('[id="chat-center-panel"]')
    const resizeHandle = appWindow.getByRole('separator', { name: 'Resize action pane' })
    const initialActionPaneBox = await elementBox(actionPane, 'expanded action pane')
    const initialChatBox = await elementBox(chatPanel, 'chat panel')
    const workspaceBox = await elementBox(
      appWindow.locator('[id="active-pane-panel"]'),
      'active workspace'
    )

    await expect(collapseActionPaneButton).toBeVisible()
    await expectSplitCornerPaneControls(titlebar, collapseSidebarButton, collapseActionPaneButton)
    await expect.poll(() => appRegion(titlebar)).toBe('drag')
    await expect.poll(() => appRegion(collapseActionPaneButton)).toBe('no-drag')
    expect(initialChatBox.width + initialActionPaneBox.width).toBeLessThanOrEqual(
      workspaceBox.width + 8
    )
    expect(Math.round(initialActionPaneBox.height)).toBe(Math.round(workspaceBox.height))
    await expect(appWindow.getByRole('heading', { name: 'Structured fixture chat' })).toBeVisible()
    await expect(resizeHandle).toBeVisible()
    await expect(
      appWindow.getByRole('complementary', { name: 'Collapsed action pane' })
    ).toHaveCount(0)
    await expect(actionPane.getByRole('heading', { name: 'Linked Google Docs' })).toHaveCount(0)
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
    const artifactList = actionPane.getByRole('region', {
      name: 'Linked Google Workspace artifacts'
    })
    const artifactItem = actionPane.locator(
      '[data-slot="collapsible"][aria-label="Linked Google Doc Fixture linked Google Doc"]'
    )
    const artifactListBox = await elementBox(artifactList, 'artifact list')
    const artifactItemBox = await elementBox(artifactItem, 'document artifact item')
    expect(Math.round(artifactItemBox.width)).toBe(Math.round(artifactListBox.width))
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
    const linkedSheetToggle = actionPane.getByRole('button', {
      name: 'Toggle linked Google Sheet Fixture linked Google Sheet',
      exact: true
    })
    const linkedSheetPreviewToggle = actionPane.getByRole('button', {
      name: 'Toggle linked Google Sheet preview Fixture linked Google Sheet',
      exact: true
    })
    const linkedSheetOpenLink = actionPane.getByRole('link', {
      name: 'Open linked Google Sheet Fixture linked Google Sheet in Google Sheets'
    })
    await expect(linkedSheetToggle).toBeVisible()
    await expect(linkedSheetPreviewToggle).toBeVisible()
    await expect(linkedSheetOpenLink).toBeVisible()
    await expect(linkedSheetOpenLink).toHaveAttribute('href', fixtureLinkedSheetUrl)
    await expect(linkedSheetOpenLink).toHaveAttribute('target', '_blank')
    await expect(
      actionPane.getByRole('region', {
        name: 'Google Sheets browser preview for Fixture linked Google Sheet'
      })
    ).toHaveCount(0)
    await linkedSheetPreviewToggle.click()
    const sheetBrowserPreview = actionPane.getByRole('region', {
      name: 'Google Sheets browser preview for Fixture linked Google Sheet'
    })
    await expect(sheetBrowserPreview).toBeVisible()
    await expect(sheetBrowserPreview.locator('webview')).toHaveAttribute(
      'src',
      fixtureLinkedSheetUrl
    )
    const browserPreviewBox = await elementBox(browserPreview, 'document browser preview')
    const sheetBrowserPreviewBox = await elementBox(sheetBrowserPreview, 'sheet browser preview')
    const documentWebviewBox = await elementBox(
      browserPreview.locator('webview'),
      'document webview'
    )
    const sheetWebviewBox = await elementBox(
      sheetBrowserPreview.locator('webview'),
      'sheet webview'
    )
    expect(Math.abs(browserPreviewBox.height - sheetBrowserPreviewBox.height)).toBeLessThanOrEqual(
      2
    )
    expect(Math.round(documentWebviewBox.width)).toBe(Math.round(browserPreviewBox.width))
    expect(Math.round(documentWebviewBox.height)).toBe(Math.round(browserPreviewBox.height))
    expect(Math.round(sheetWebviewBox.width)).toBe(Math.round(sheetBrowserPreviewBox.width))
    expect(Math.round(sheetWebviewBox.height)).toBe(Math.round(sheetBrowserPreviewBox.height))
    const resizeHandleBox = await elementBox(resizeHandle, 'action pane resize handle')
    await appWindow.mouse.move(
      resizeHandleBox.x + resizeHandleBox.width / 2,
      resizeHandleBox.y + resizeHandleBox.height / 2
    )
    await appWindow.mouse.down()
    await appWindow.mouse.move(
      resizeHandleBox.x + resizeHandleBox.width / 2 - 200,
      resizeHandleBox.y + resizeHandleBox.height / 2,
      { steps: 10 }
    )
    await appWindow.mouse.up()
    await expect
      .poll(async () => Math.round((await actionPane.boundingBox())?.width ?? 0))
      .toBeGreaterThan(Math.round(initialActionPaneBox.width) + 100)
    const resizedActionPaneBox = await elementBox(actionPane, 'resized action pane')
    await expect(appWindow.getByRole('heading', { name: 'Structured fixture chat' })).toBeVisible()
    await expect(appWindow.getByRole('form', { name: 'Chat prompt' })).toBeVisible()
    await expect(actionPane.getByText('Sheet ID', { exact: true })).toHaveCount(0)
    await expect(actionPane.getByText('Google Sheets URL', { exact: true })).toHaveCount(0)
    await linkedSheetToggle.click()
    await expect(sheetBrowserPreview).toHaveCount(0)
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
    await expect(actionPane.getByText('Hidden unlisted Google Sheet')).toHaveCount(0)
    await expect(actionPane.getByRole('button', { name: 'Select artifact read' })).toHaveCount(0)
    await expect(actionPane.getByRole('button', { name: 'Select artifact plan' })).toHaveCount(0)
    await expect(actionPane.getByRole('button', { name: 'Select artifact bash' })).toHaveCount(0)
    await expect(actionPane.getByText('V1 fixture tool output', { exact: true })).toHaveCount(0)
    await expect(actionPane.getByText('V2 fixture tool output', { exact: true })).toHaveCount(0)

    await collapseActionPaneButton.click()
    await expect(actionPane).toHaveCount(0)
    await expect(titlebar.getByRole('button', { name: 'Restore action pane' })).toBeVisible()
    const collapsedRail = appWindow.getByRole('complementary', { name: 'Collapsed action pane' })
    await expect(collapsedRail).toBeVisible()
    await expect(collapsedRail.getByRole('button', { name: 'Restore action pane' })).toBeVisible()
    await expect(resizeHandle).toBeVisible()
    await expect(appWindow.getByRole('heading', { name: 'Structured fixture chat' })).toBeVisible()
    await expect(appWindow.getByRole('form', { name: 'Chat prompt' })).toBeVisible()

    await titlebar.getByRole('button', { name: 'Restore action pane' }).click()
    await expect(actionPane).toBeVisible()
    const restoredActionPaneBox = await elementBox(actionPane, 'restored action pane')
    expect(Math.round(restoredActionPaneBox.height)).toBe(Math.round(workspaceBox.height))
    expect(Math.abs(restoredActionPaneBox.width - resizedActionPaneBox.width)).toBeLessThanOrEqual(
      4
    )
    await expect(appWindow.getByRole('heading', { name: 'Structured fixture chat' })).toBeVisible()
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

test('opens a project by native folder picker from the final chat shell, persists it, and removes it', async ({
  appWindow,
  electronApp
}) => {
  await waitForChatShell(appWindow)
  await expectFreshProjectSidebarWithoutRawOpenCodeProjects(appWindow)
  await installProjectDirectoryPickerMock(electronApp, fakeProjectDirectory)

  const openButton = openProjectFolderButton(appWindow)
  await expect(openButton).toBeEnabled()
  await expect(appWindow.getByRole('form', { name: 'Open project by directory' })).toHaveCount(0)

  await openButton.click()
  await expect.poll(() => getProjectDirectoryPickerCallCount(electronApp)).toBe(1)
  await expect
    .poll(() => appWindow.evaluate(() => window.location.hash))
    .toMatch(/\/projects\/dir-/)
  await expect(selectedProjectSessions(appWindow)).toBeVisible()
  await expectOpenedProjectRouteResolved(appWindow)

  await expect
    .poll(() =>
      appWindow.evaluate(() => window.api.listOpenedProjectFolders().then((folders) => folders))
    )
    .toEqual([
      expect.objectContaining({
        directory: fakeProjectDirectory,
        lastOpenedAt: expect.any(Number)
      })
    ])
  await expect(projectChatLink(appWindow).filter({ hasText: 'Fake Project' })).toBeVisible()

  const projectUrl = appWindow.url()
  await appWindow.reload()
  await expect(appWindow).toHaveURL(projectUrl)
  await expect(projectChatLink(appWindow).filter({ hasText: 'Fake Project' })).toBeVisible()
  await expect(selectedProjectSessions(appWindow)).toBeVisible()

  await appWindow
    .getByRole('navigation', { name: 'Projects' })
    .getByRole('button', { name: 'Remove Fake Project from Projects', exact: true })
    .click()
  await expect.poll(() => appWindow.evaluate(() => window.location.hash)).toMatch(/#\/$/)
  await expect(projectChatLink(appWindow).filter({ hasText: 'Fake Project' })).toHaveCount(0)
  await expect
    .poll(() => appWindow.evaluate(() => window.api.listOpenedProjectFolders()))
    .toEqual([])
  await expect(appWindow.getByText(emptyOpenedProjectsMessage)).toBeVisible()
})

test('opens a project folder picker cancellation without changing Projects', async ({
  appWindow,
  electronApp
}) => {
  await waitForChatShell(appWindow)
  await expectFreshProjectSidebarWithoutRawOpenCodeProjects(appWindow)
  await installProjectDirectoryPickerMock(electronApp, null)

  const initialHash = await appWindow.evaluate(() => window.location.hash)
  const openButton = openProjectFolderButton(appWindow)
  await expect(openButton).toBeEnabled()

  await openButton.click()
  await expect.poll(() => getProjectDirectoryPickerCallCount(electronApp)).toBe(1)
  await expect.poll(() => appWindow.evaluate(() => window.location.hash)).toBe(initialHash)
  await expect
    .poll(() => appWindow.evaluate(() => window.api.listOpenedProjectFolders()))
    .toEqual([])
  await expect(selectedProjectSessions(appWindow)).toHaveCount(0)
  await expect(projectChatLink(appWindow).filter({ hasText: 'Fake Project' })).toHaveCount(0)
  await expect(appWindow.getByText(emptyOpenedProjectsMessage)).toBeVisible()
})

test('opens a project by native folder picker into a directory-derived project route with start composer', async ({
  appWindow,
  electronApp
}) => {
  await waitForChatShell(appWindow)
  await expectFreshProjectSidebarWithoutRawOpenCodeProjects(appWindow)
  await installProjectDirectoryPickerMock(electronApp, repositoryDirectory)

  const openButton = openProjectFolderButton(appWindow)
  await expect(openButton).toBeEnabled()
  await openButton.click()
  await expect.poll(() => getProjectDirectoryPickerCallCount(electronApp)).toBe(1)
  await expect
    .poll(() => appWindow.evaluate(() => window.location.hash))
    .toMatch(/\/projects\/dir-/)
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.not.toContain(
    '/projects/global'
  )
  await expect(selectedProjectSessions(appWindow)).toBeVisible()
  await expectOpenedProjectRouteResolved(appWindow)
  await expect(appWindow.getByRole('heading', { name: 'No chat selected' })).toBeVisible()
  await expectChatComposerWithoutHelperCopy(appWindow)
})

test('keeps raw OpenCode projects out of a fresh opened-projects sidebar', async ({
  appWindow
}) => {
  await waitForChatShell(appWindow)
  await expectFreshProjectSidebarWithoutRawOpenCodeProjects(appWindow)
})

test('keeps a selected empty session transcript quiet', async ({
  appWindow,
  fakeOpenCodeServer
}) => {
  const createResponse = await fetch(`${fakeOpenCodeServer.url}/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ directory: fakeProjectDirectory })
  })
  expect(createResponse.ok).toBe(true)
  const emptySession = (await createResponse.json()) as { id: string; title: string }

  await seedOpenedFakeProject(appWindow)
  await projectChatLink(appWindow).filter({ hasText: 'Fake Project' }).click()
  await expectOpenedProjectRouteResolved(appWindow)
  await sessionChatLink(appWindow).filter({ hasText: emptySession.title }).click()
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.toMatch(
    new RegExp(`/projects/[^/]+/sessions/${emptySession.id}$`)
  )
  await expect(appWindow.getByRole('heading', { name: emptySession.title })).toBeVisible()
  await expect(appWindow.getByRole('form', { name: 'Chat prompt' })).toBeVisible()

  const transcript = messageTranscript(appWindow)
  await expect(transcript).toBeVisible()
  await expect(transcript.getByText('No messages found for this session.')).toHaveCount(0)
  await expect(transcript.getByRole('article')).toHaveCount(0)
})

test('shows real project/session selection in the reused chat shell', async ({ appWindow }) => {
  await seedOpenedFakeProject(appWindow)

  const projectLinks = projectChatLink(appWindow)
  const terminalProjectState = appWindow
    .getByText(emptyOpenedProjectsMessage)
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
  await expect(appWindow.getByRole('heading', { name: 'No chat selected' })).toBeVisible()
  await expect(appWindow.getByRole('form', { name: 'Chat prompt' })).toBeVisible()
  await expectChatComposerWithoutHelperCopy(appWindow)
  await expect(
    messageTranscript(appWindow).getByText('Start a new conversation for this project.')
  ).toHaveCount(0)
  await expect(
    messageTranscript(appWindow).getByText('No sessions found for this project.')
  ).toHaveCount(0)
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
    await expectChatComposerWithoutHelperCopy(appWindow)
    return
  }

  await sessionLinks.first().click()
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.toMatch(
    /\/projects\/[^/]+\/sessions\/[^/]+$/
  )
  await expect(appWindow.locator('#active-chat-heading')).not.toHaveText('No chat selected')
  await expectChatComposerWithoutHelperCopy(appWindow)
  await expect(messageTranscript(appWindow)).toBeVisible()
  await expect(
    messageTranscript(appWindow).getByText('No messages found for this session.')
  ).toHaveCount(0)
  await appWindow.goBack()
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.toMatch(
    /\/projects\/[^/]+$/
  )
  await expect(appWindow.getByRole('heading', { name: 'No chat selected' })).toBeVisible()
  await expectChatComposerWithoutHelperCopy(appWindow)
  await appWindow.goForward()
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.toMatch(
    /\/projects\/[^/]+\/sessions\/[^/]+$/
  )
  await expect(appWindow.locator('#active-chat-heading')).not.toHaveText('No chat selected')
  await expectChatComposerWithoutHelperCopy(appWindow)
})

test('renders seeded stable chat messages', async ({ appWindow }) => {
  await openSeededDeterministicChat(appWindow)
  const transcript = messageTranscript(appWindow)
  await expect(transcript).toBeVisible()
  await expect(transcript.getByRole('log')).toBeVisible()
  await expect(transcript.locator('[data-slot="message-scroller-item"]')).toHaveCount(2)
  const userArticle = appWindow.getByRole('article', { name: /user message at/ })
  const assistantArticle = appWindow.getByRole('article', { name: /assistant message at/ })
  await expect(userArticle).toBeVisible()
  await expect(assistantArticle).toBeVisible()
  await expectUserBubbleSurface(
    userArticle.locator('[data-slot="message-surface"]').first(),
    'seeded user message surface'
  )
  await expectPlainAssistantSurface(
    assistantArticle.locator('[data-slot="message-surface"]').first(),
    'seeded assistant message surface'
  )
  await expect(appWindow.getByText('Seeded user prompt')).toBeVisible()
  await expect(appWindow.getByText('Seeded assistant response')).toBeVisible()
})

test('filters parented subagent sessions from normal chat rendering', async ({ appWindow }) => {
  await seedOpenedFakeProject(appWindow)
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

  const projectHash = await appWindow.evaluate(() => window.location.hash)
  const projectRoute = projectHash.match(/#(\/projects\/[^/]+)/)?.[1]
  if (!projectRoute) throw new Error(`Expected project route in hash: ${projectHash}`)
  await appWindow.evaluate((route) => {
    window.location.hash = `#${route}/sessions/child-subagent-session`
  }, projectRoute)
  await expect
    .poll(() => appWindow.evaluate(() => window.location.hash))
    .toMatch(/\/projects\/[^/]+\/sessions\/child-subagent-session$/)
  await expect(appWindow.getByText('Session not found.')).toBeVisible()
  await expect(appWindow.getByRole('heading', { name: 'No chat selected' })).toBeVisible()
  await expect(appWindow.getByRole('button', { name: 'Send' })).toBeDisabled()
  await expect(appWindow.getByText(hiddenSubagentSessionTitle)).toHaveCount(0)
  await expect(appWindow.getByText(hiddenSubagentUserPrompt)).toHaveCount(0)
  await expect(appWindow.getByText(hiddenSubagentAssistantResponse)).toHaveCount(0)
})

test('renders structured v1 and v2 message parts', async ({ appWindow }) => {
  await openStructuredFixtureChat(appWindow)
  const transcript = messageTranscript(appWindow)
  await expect(transcript.locator('[data-slot="message-scroller-item"]')).toHaveCount(4)
  await expect(appWindow.getByText('Structured fixture user prompt')).toBeVisible()
  await expect(appWindow.getByText('Inspecting project files.')).toBeVisible()
  await expect(appWindow.getByText('Need **file context** before responding.')).toBeVisible()
  await expect(appWindow.getByText('Reasoning updated.')).toHaveCount(0)
  await expect(appWindow.getByText('Hidden v1 step start marker')).toHaveCount(0)
  await expect(appWindow.getByText('Hidden v1 step finish marker')).toHaveCount(0)
  await expect(appWindow.getByText('Hidden v2 step start marker')).toHaveCount(0)
  await expect(appWindow.getByText('Hidden v2 step finish marker')).toHaveCount(0)
  await expect(appWindow.getByText('Hidden patch fixture marker')).toHaveCount(0)
  await expect(appWindow.getByText('Unsupported part: patch')).toHaveCount(0)
  await expect(appWindow.getByText('No text content.')).toHaveCount(0)
  const structuredV1Article = transcript
    .getByRole('article', { name: /assistant message at/ })
    .filter({ hasText: 'Inspecting project files.' })
  await expect
    .poll(
      () =>
        structuredV1Article.locator('[data-slot="message-surface"]').evaluate((surface) => {
          const partList = surface.firstElementChild
          return partList ? Array.from(partList.children).length : 0
        }),
      { message: 'empty reasoning parts should not render visible part rows' }
    )
    .toBe(4)
  const readTool = appWindow.locator('[aria-label="Tool read"]')
  await expect(readTool).toHaveAttribute('data-slot', 'tool-card')
  await expect(readTool).toHaveAttribute('data-status', 'completed')
  await expect(readTool).toHaveAttribute('data-tone', 'completed')
  await expect(readTool.locator('[data-slot="tool-title"]')).toHaveText('read')
  await expect(readTool.locator('[data-slot="tool-status-badge"]')).toHaveText('completed')
  await expect(readTool.locator('[data-slot="tool-detail-affordance"]')).toHaveText('Show details')
  await expect(readTool).not.toContainText('Input')
  await readTool.getByRole('button', { name: 'Toggle details for tool read' }).click()
  await expect(readTool.locator('[data-slot="tool-detail-affordance"]')).toHaveText('Hide details')
  await expect(readTool.locator('[data-slot="tool-detail-label"]')).toHaveText(['Input', 'Output'])
  await expect(
    readTool.locator('[data-slot="tool-detail-text"]').filter({ hasText: 'V1 fixture tool output' })
  ).toBeVisible()
  await readTool.getByRole('button', { name: 'Toggle details for tool read' }).click()
  await expect(readTool.locator('[data-slot="tool-detail-affordance"]')).toHaveText('Show details')
  await expect(readTool).not.toContainText('V1 fixture tool output')
  await expect(appWindow.getByText('Unsupported part: future-part')).toBeVisible()
  await expect(appWindow.getByText('Running the v2 shell check.')).toBeVisible()
  const bashTool = appWindow.locator('[aria-label="Tool bash"]')
  await expect(bashTool).toHaveAttribute('data-slot', 'tool-card')
  await expect(bashTool).toHaveAttribute('data-status', 'error')
  await expect(bashTool).toHaveAttribute('data-tone', 'error')
  await expect(bashTool.locator('[data-slot="tool-title"]')).toHaveText('bash')
  await expect(bashTool.locator('[data-slot="tool-status-badge"]')).toHaveText('error')
  await expect(bashTool.locator('[data-slot="tool-detail-affordance"]')).toHaveText('Hide details')
  await expect(bashTool.locator('[data-slot="tool-detail-label"]')).toHaveText([
    'Input',
    'Output',
    'Error'
  ])
  await expect(bashTool).toContainText('V2 fixture tool output')
  await expect(bashTool).toContainText('V2 fixture tool error')
  await bashTool.getByRole('button', { name: 'Toggle details for tool bash' }).click()
  await expect(bashTool.locator('[data-slot="tool-detail-affordance"]')).toHaveText('Show details')
  await expect(bashTool).not.toContainText('V2 fixture tool output')
  await expect(bashTool.locator('[data-slot="tool-title"]')).toHaveText('bash')
  await expect(appWindow.getByText('Unsupported part: future-content')).toBeVisible()
})

test('renders assistant markdown without changing user, reasoning, or tool text', async ({
  appWindow
}) => {
  await openStructuredFixtureChat(appWindow)
  const transcript = messageTranscript(appWindow)
  const markdownArticle = transcript
    .getByRole('article', { name: /assistant message at/ })
    .filter({ hasText: 'Assistant markdown fixture' })
  const userArticle = transcript
    .getByRole('article', { name: /user message at/ })
    .filter({ hasText: 'literal user markdown' })

  await expect(
    markdownArticle.locator('strong').filter({ hasText: 'bold assistant phrase' })
  ).toBeVisible()
  await expect(markdownArticle.locator('ul').first().locator('li')).toHaveText([
    'first list item',
    'second list item'
  ])
  const fixtureDocsLink = markdownArticle.getByRole('link', { name: 'fixture docs' })
  await expect(fixtureDocsLink).toHaveAttribute('href', 'https://example.test/markdown')
  await expect(fixtureDocsLink).toHaveAttribute('target', '_blank')
  await expect(fixtureDocsLink).toHaveAttribute('rel', 'noopener noreferrer')
  await expect(markdownArticle.locator('code').filter({ hasText: 'inlineToken' })).toBeVisible()
  await expect(markdownArticle.locator('pre code')).toContainText('pnpm test:e2e')
  await expect(markdownArticle).not.toContainText('**bold assistant phrase**')
  await expect(markdownArticle).not.toContainText('```')
  await expect(
    markdownArticle.getByRole('heading', { name: 'Supported assistant heading', level: 2 })
  ).toBeVisible()

  const markdownTable = markdownArticle.locator('table').filter({ hasText: 'alpha' })
  await expect(markdownTable).toBeVisible()
  await expect(markdownTable.locator('thead th')).toHaveText(['supported', 'table', 'wide content'])
  await expect(markdownTable.locator('tbody tr').first().locator('td')).toHaveText([
    'alpha',
    'beta',
    'exceptionally-long-unbroken-table-value-for-overflow-handling-0123456789-abcdefghijklmnopqrstuvwxyz'
  ])
  const tableContainer = markdownArticle.locator('[data-slot="markdown-table-container"]').first()
  await expect(tableContainer).toBeVisible()
  const tableOverflow = await tableContainer.evaluate((container) => ({
    clientWidth: container.clientWidth,
    overflowX: window.getComputedStyle(container).overflowX,
    scrollWidth: container.scrollWidth
  }))
  expect(tableOverflow.overflowX).toMatch(/auto|scroll/)
  expect(tableOverflow.scrollWidth).toBeGreaterThan(tableOverflow.clientWidth)
  const messageSurface = markdownArticle.locator('[data-slot="message-surface"]').first()
  const tableContainerBox = await elementBox(tableContainer, 'assistant markdown table container')
  const messageSurfaceBox = await elementBox(messageSurface, 'assistant markdown message surface')
  expect(tableContainerBox.width).toBeLessThanOrEqual(messageSurfaceBox.width)
  await expect(
    markdownArticle.locator(
      'img, blockquote, input[type="checkbox"], [data-raw-html-fixture="blocked"]'
    )
  ).toHaveCount(0)
  await expect(markdownArticle).not.toContainText('unsupported raw html block')

  await expect(userArticle).toContainText('**literal user markdown**')
  await expect(userArticle.locator('strong')).toHaveCount(0)

  const reasoning = markdownArticle.locator('p').filter({
    hasText: 'Need **file context** before responding.'
  })
  await expect(reasoning).toBeVisible()
  await expect(reasoning.locator('strong')).toHaveCount(0)

  const readTool = appWindow.locator('[aria-label="Tool read"]')
  await readTool.getByRole('button', { name: 'Toggle details for tool read' }).click()
  await expect(readTool).toContainText('**literal tool markdown**')
  await expect(readTool.locator('strong')).toHaveCount(0)
})

test('shows one assistant header for repeated assistant/tool messages in a turn', async ({
  appWindow
}) => {
  await openStructuredFixtureChat(appWindow)
  const transcript = messageTranscript(appWindow)

  await expect(transcript.getByRole('article', { name: /user message at/ })).toHaveCount(1)
  await expect(transcript.getByRole('article', { name: /assistant message at/ })).toHaveCount(3)
  await expect(transcript.locator('[data-slot="message-header"]')).toHaveText(['user', 'assistant'])
})

test('keeps a long collapsed tool disclosure anchored when opening it', async ({ appWindow }) => {
  await openStructuredFixtureChat(appWindow)

  const transcript = messageTranscript(appWindow)
  const tool = appWindow.locator('[aria-label="Tool plan"]')
  const toggle = tool.getByRole('button', { name: 'Toggle details for tool plan' })

  await expect(transcript).toBeVisible()
  await expect(transcript.getByRole('log')).toBeVisible()
  await expect(tool).toHaveAttribute('data-slot', 'tool-card')
  await expect(tool).toHaveAttribute('data-tone', 'completed')
  await expect(tool.locator('[data-slot="tool-status-badge"]')).toHaveText('completed')
  await expect(tool.locator('[data-slot="tool-detail-affordance"]')).toHaveText('Show details')
  await expect(toggle).toBeVisible()
  await toggle.click()
  await expect(tool.locator('[data-slot="tool-detail-affordance"]')).toHaveText('Hide details')
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

test('persists connected OpenCode model selection per project', async ({
  appWindow,
  electronApp
}) => {
  const userDataPath = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const appConfigPath = join(userDataPath, 'openkhodam-config.json')
  const expectedProjectDirectory = await realpath(fakeProjectDirectory)

  await seedOpenedFakeProject(appWindow)
  await projectChatLink(appWindow).filter({ hasText: 'Fake Project' }).click()
  await expectOpenedProjectRouteResolved(appWindow)

  const modelPicker = appWindow.getByLabel('OpenCode model')
  await expect(modelPicker).toBeVisible()
  await expect(modelPicker).toHaveValue('Connected Fake Provider · Connected Fake Model')
  await modelPicker.click()
  await expect(appWindow.getByText('Connected Alternate Model')).toBeVisible()
  await expect(appWindow.getByText('Disconnected Hidden Model')).toHaveCount(0)
  await appWindow.getByText('Connected Alternate Model').click()
  await expect(modelPicker).toHaveValue('Connected Fake Provider · Connected Alternate Model')
  await expect
    .poll(async () => {
      const rawConfig = await readOptionalFile(appConfigPath)
      if (!rawConfig) return null

      const config = JSON.parse(rawConfig) as {
        preferences?: {
          openCode?: {
            modelSelectionsByDirectory?: Record<string, { providerID: string; modelID: string }>
          }
        }
      }
      return (
        config.preferences?.openCode?.modelSelectionsByDirectory?.[expectedProjectDirectory] ?? null
      )
    })
    .toEqual({ providerID: 'fake-provider', modelID: 'fake-alt-model' })

  await appWindow.reload()
  await expectOpenedProjectRouteResolved(appWindow)
  await expect(modelPicker).toBeVisible()
  await expect(modelPicker).toHaveValue('Connected Fake Provider · Connected Alternate Model')

  await writeFile(
    appConfigPath,
    `${JSON.stringify(
      {
        version: 1,
        projects: {
          openedFolders: [{ directory: expectedProjectDirectory, lastOpenedAt: 1 }]
        },
        preferences: {
          openCode: {
            modelSelectionsByDirectory: {
              [expectedProjectDirectory]: { providerID: 'fake-provider', modelID: 'stale-model' }
            }
          }
        },
        integrations: {
          googleWorkspace: {
            account: null,
            scopes: [],
            token: null,
            updatedAt: null
          }
        }
      },
      null,
      2
    )}\n`,
    'utf8'
  )
  await appWindow.reload()
  await expectOpenedProjectRouteResolved(appWindow)
  await expect(modelPicker).toHaveValue('Connected Fake Provider · Connected Fake Model')

  await appWindow.getByLabel('Message OpenKhodam').fill('Fallback stale model prompt')
  await expect(appWindow.getByRole('button', { name: 'Send' })).toBeEnabled()
  await appWindow.getByRole('button', { name: 'Send' }).click()
  await expect(appWindow.getByText('Fake response for: Fallback stale model prompt')).toBeVisible()
})

test('renders prompt input full-width with agent model and effort controls in the footer', async ({
  appWindow
}) => {
  await openSeededDeterministicChat(appWindow)

  const composer = appWindow.getByRole('form', { name: 'Chat prompt' })
  const promptInput = composer.getByLabel('Message OpenKhodam')
  const agentPicker = composer.getByLabel('OpenCode agent')
  const modelPicker = composer.getByLabel('OpenCode model')
  const effortPicker = composer.getByLabel('OpenCode effort')

  await expect(agentPicker).toHaveValue('Build')
  await expect(modelPicker).toHaveValue('Connected Fake Provider · Connected Fake Model')
  await expect(effortPicker).toHaveValue('Default')

  const composerBox = await elementBox(composer, 'chat prompt composer')
  const promptBox = await elementBox(promptInput, 'chat prompt textarea')
  const agentBox = await elementBox(agentPicker, 'agent picker')
  const modelBox = await elementBox(modelPicker, 'model picker')
  const effortBox = await elementBox(effortPicker, 'effort picker')

  expect(
    promptBox.width,
    'prompt input should span the active pane composer width'
  ).toBeGreaterThan(composerBox.width * 0.85)
  for (const [label, box] of [
    ['agent picker', agentBox],
    ['model picker', modelBox],
    ['effort picker', effortBox]
  ] as const) {
    expect(box.y, `${label} should sit in the composer footer below the textarea`).toBeGreaterThan(
      promptBox.y + promptBox.height - 2
    )
  }
})

test('updates effort options from selected model variants and hides effort for plain models', async ({
  appWindow,
  fakeOpenCodeServer
}) => {
  await openSeededDeterministicChat(appWindow)

  const composer = appWindow.getByRole('form', { name: 'Chat prompt' })
  const effortPicker = composer.getByLabel('OpenCode effort')
  await effortPicker.click()
  await expect(appWindow.getByText('Default', { exact: true })).toBeVisible()
  await expect(appWindow.getByText('Low', { exact: true })).toBeVisible()
  await expect(appWindow.getByText('High', { exact: true })).toBeVisible()
  await appWindow.getByText('High', { exact: true }).click()
  await expect(effortPicker).toHaveValue('High')

  const modelPicker = composer.getByLabel('OpenCode model')
  await modelPicker.click()
  await appWindow.getByText('Connected Alternate Model', { exact: true }).click()
  await expect(modelPicker).toHaveValue('Connected Fake Provider · Connected Alternate Model')
  await expect(composer.getByLabel('OpenCode effort')).toHaveCount(0)

  const prompt = 'No stale variant prompt'
  await sendPrompt(appWindow, prompt)

  await expect
    .poll(
      () =>
        fakeOpenCodeServer.getPromptRequests().find((request) => request.text === prompt) ?? null
    )
    .toMatchObject({
      text: prompt,
      model: { providerID: 'fake-provider', modelID: 'fake-alt-model' },
      variant: null
    })
})

test('sends selected agent model and effort through the OpenCode prompt flow', async ({
  appWindow,
  fakeOpenCodeServer
}) => {
  await openSeededDeterministicChat(appWindow)

  const composer = appWindow.getByRole('form', { name: 'Chat prompt' })
  const agentPicker = composer.getByLabel('OpenCode agent')
  await agentPicker.click()
  await appWindow.getByText('Plan', { exact: true }).click()
  await expect(agentPicker).toHaveValue('Plan')

  const effortPicker = composer.getByLabel('OpenCode effort')
  await effortPicker.click()
  await appWindow.getByText('High', { exact: true }).click()
  await expect(effortPicker).toHaveValue('High')

  const prompt = 'Selected picker prompt'
  await sendPrompt(appWindow, prompt)

  await expect
    .poll(
      () =>
        fakeOpenCodeServer.getPromptRequests().find((request) => request.text === prompt) ?? null
    )
    .toMatchObject({
      sessionID: 'seeded-session',
      text: prompt,
      agent: 'plan',
      model: { providerID: 'fake-provider', modelID: 'fake-connected-model' },
      variant: 'high'
    })
})

test('starts a new stable chat from the project route', async ({ appWindow }) => {
  await seedOpenedFakeProject(appWindow)

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

  const thinkingRow = messageTranscript(appWindow).getByText('Thinking…', { exact: true })
  const thinkingRowContainer = messageTranscript(appWindow).locator(
    '[data-slot="assistant-thinking-row"]'
  )
  const thinkingSurface = messageTranscript(appWindow).locator(
    '[data-slot="assistant-thinking-status"]'
  )
  await expect(thinkingRow).toHaveCount(0)

  await sendPrompt(appWindow, 'Delayed lifecycle prompt')
  await expect(appWindow.getByText('Delayed lifecycle prompt', { exact: true })).toBeVisible()
  await expect(
    appWindow.locator('[data-pending="true"]').filter({ hasText: 'Delayed lifecycle prompt' })
  ).toBeVisible()
  await expect(thinkingRow).toBeVisible()
  await expect(thinkingRowContainer.getByText('assistant', { exact: true })).toHaveCount(0)
  await expect(thinkingSurface).toHaveClass(/shimmer/)
  await expectPlainAssistantSurface(thinkingSurface, 'assistant thinking message surface')
  await expect(
    messageTranscript(appWindow).getByText('Prompt sent. Messages will refresh shortly.')
  ).toHaveCount(0)
  await expect(appWindow.getByText('Fake response for: Delayed lifecycle prompt')).toBeVisible()
  await expect(thinkingRow).toBeVisible()
  await expect(thinkingRow).toHaveCount(0, { timeout: 8_000 })
  await expect(
    appWindow.locator('[data-pending="true"]').filter({ hasText: 'Delayed lifecycle prompt' })
  ).toHaveCount(0)
  await expect(appWindow.getByText('Delayed lifecycle prompt', { exact: true })).toHaveCount(1)
})

test('shows and filters only the undo slash command in the active session composer', async ({
  appWindow
}) => {
  await openSeededDeterministicChat(appWindow)

  const promptInput = appWindow.getByLabel('Message OpenKhodam')
  await promptInput.pressSequentially('/')
  const popover = await expectSlashCommandPopoverShowsOnlyUndo(appWindow)

  await expect(promptInput).toBeFocused()
  await promptInput.pressSequentially('un')
  await expect(promptInput).toBeFocused()
  await expect(promptInput).toHaveValue('/un')
  await expect(popover).toBeVisible()
  await expect(popover.getByText('/undo', { exact: true })).toBeVisible()

  await promptInput.fill('/zz')
  await expect(popover).toBeVisible()
  await expect(popover.getByText('/undo', { exact: true })).toHaveCount(0)
  await expect(popover.getByText('No slash commands available.', { exact: true })).toBeVisible()
})

test('dismisses the undo slash command popover with Escape without executing undo', async ({
  appWindow
}) => {
  await openSeededDeterministicChat(appWindow)

  const promptInput = appWindow.getByLabel('Message OpenKhodam')
  await promptInput.pressSequentially('/un')
  await expectSlashCommandPopoverShowsOnlyUndo(appWindow)

  await promptInput.press('Escape')
  await expect(appWindow.getByRole('dialog', { name: 'Slash commands' })).toHaveCount(0)
  await expect(promptInput).toBeFocused()
  await expect(promptInput).toHaveValue('/un')
  await expect(messageTranscript(appWindow).getByRole('article')).toHaveCount(2)
})

test('executes undo by clicking the slash command and restores the prompt text', async ({
  appWindow,
  fakeOpenCodeServer
}) => {
  await openSeededDeterministicChat(appWindow)

  const promptInput = appWindow.getByLabel('Message OpenKhodam')
  const transcript = messageTranscript(appWindow)
  await promptInput.fill('/')
  const popover = await expectSlashCommandPopoverShowsOnlyUndo(appWindow)
  await popover.getByText('/undo', { exact: true }).click()

  await expect(promptInput).toHaveValue('Seeded user prompt')
  await expect(transcript.getByText('Seeded user prompt', { exact: true })).toHaveCount(0)
  await expect(transcript.getByText('Seeded assistant response', { exact: true })).toHaveCount(0)
  await expect(transcript.getByRole('article')).toHaveCount(0)
  await expect
    .poll(() => fakeSessionMessageTexts(fakeOpenCodeServer, 'seeded-session'))
    .toEqual(expect.arrayContaining(['Seeded user prompt', 'Seeded assistant response']))
})

test('executes undo by keyboard selection and exact slash submit', async ({ appWindow }) => {
  await openSeededDeterministicChat(appWindow)

  const promptInput = appWindow.getByLabel('Message OpenKhodam')
  const transcript = messageTranscript(appWindow)

  await promptInput.fill('/un')
  await expectSlashCommandPopoverShowsOnlyUndo(appWindow)
  await promptInput.press('Enter')
  await expect(promptInput).toHaveValue('Seeded user prompt')
  await expect(transcript.getByText('Seeded assistant response', { exact: true })).toHaveCount(0)

  const exactUndoPrompt = 'Prompt restored from exact undo submit'
  await sendPrompt(appWindow, exactUndoPrompt)
  await expect(appWindow.getByText(`Fake response for: ${exactUndoPrompt}`)).toBeVisible()

  await promptInput.fill('/undo')
  await expect(appWindow.getByRole('button', { name: 'Send' })).toBeEnabled()
  await appWindow.getByRole('button', { name: 'Send' }).click()

  await expect(promptInput).toHaveValue(exactUndoPrompt)
  await expect(transcript.getByText(exactUndoPrompt, { exact: true })).toHaveCount(0)
  await expect(transcript.getByText(`Fake response for: ${exactUndoPrompt}`)).toHaveCount(0)
})

test('repeated undo targets the previous visible user prompt while preserving server history', async ({
  appWindow,
  fakeOpenCodeServer
}) => {
  await openSeededDeterministicChat(appWindow)

  const firstPrompt = 'First repeated undo prompt'
  const secondPrompt = 'Second repeated undo prompt'
  const promptInput = appWindow.getByLabel('Message OpenKhodam')
  const transcript = messageTranscript(appWindow)

  await sendPrompt(appWindow, firstPrompt)
  await expect(transcript.getByText(`Fake response for: ${firstPrompt}`)).toBeVisible()
  await sendPrompt(appWindow, secondPrompt)
  await expect(transcript.getByText(`Fake response for: ${secondPrompt}`)).toBeVisible()

  await promptInput.fill('/undo')
  await appWindow.getByRole('button', { name: 'Send' }).click()
  await expect(promptInput).toHaveValue(secondPrompt)
  await expect(transcript.getByText(secondPrompt, { exact: true })).toHaveCount(0)
  await expect(transcript.getByText(`Fake response for: ${secondPrompt}`)).toHaveCount(0)
  await expect(transcript.getByText(firstPrompt, { exact: true })).toBeVisible()

  await promptInput.fill('/undo')
  await appWindow.getByRole('button', { name: 'Send' }).click()
  await expect(promptInput).toHaveValue(firstPrompt)
  await expect(transcript.getByText(firstPrompt, { exact: true })).toHaveCount(0)
  await expect(transcript.getByText(`Fake response for: ${firstPrompt}`)).toHaveCount(0)
  await expect(transcript.getByText('Seeded user prompt', { exact: true })).toBeVisible()
  await expect(transcript.getByText('Seeded assistant response', { exact: true })).toBeVisible()

  await expect
    .poll(() => fakeSessionMessageTexts(fakeOpenCodeServer, 'seeded-session'))
    .toEqual(
      expect.arrayContaining([
        firstPrompt,
        `Fake response for: ${firstPrompt}`,
        secondPrompt,
        `Fake response for: ${secondPrompt}`
      ])
    )
})

test('aborts a pending prompt before undo revert and restores that prompt', async ({
  appWindow,
  fakeOpenCodeServer
}) => {
  await openSeededDeterministicChat(appWindow)

  const prompt = 'Pending prompt undone before projection'
  const promptInput = appWindow.getByLabel('Message OpenKhodam')
  const transcript = messageTranscript(appWindow)

  await promptInput.fill(prompt)
  await appWindow.getByRole('button', { name: 'Send' }).click()
  await expect(appWindow.locator('[data-pending="true"]').filter({ hasText: prompt })).toBeVisible()

  await promptInput.fill('/undo')
  await expect(appWindow.getByRole('button', { name: 'Send' })).toBeEnabled()
  await appWindow.getByRole('button', { name: 'Send' }).click()

  await expect(promptInput).toHaveValue(prompt)
  await expect(appWindow.locator('[data-pending="true"]').filter({ hasText: prompt })).toHaveCount(
    0
  )
  await expect(transcript.getByText(prompt, { exact: true })).toHaveCount(0)
  await expect(transcript.getByText(`Fake response for: ${prompt}`)).toHaveCount(0)
  await expect(transcript.getByText('Seeded user prompt', { exact: true })).toBeVisible()
  await expect
    .poll(() => fakeOpenCodeServer.getRequestEvents())
    .toEqual(['prompt:seeded-session', 'abort:seeded-session', 'revert:seeded-session'])
})

test('sends the chat composer with Enter while Shift+Enter stays multiline', async ({
  appWindow
}) => {
  await openSeededDeterministicChat(appWindow)

  const promptInput = appWindow.getByLabel('Message OpenKhodam')
  const sendButton = appWindow.getByRole('button', { name: 'Send' })
  await expect(sendButton).toBeDisabled()

  await promptInput.press('Enter')
  await expect(promptInput).toHaveValue('')
  await expect(appWindow.getByRole('article')).toHaveCount(2)

  await promptInput.fill('Line one')
  await promptInput.press('Shift+Enter')
  await expect(promptInput).toHaveValue('Line one\n')
  await promptInput.pressSequentially('Line two')
  await expect(promptInput).toHaveValue('Line one\nLine two')
  await expect(appWindow.getByRole('article')).toHaveCount(2)

  const composingPrompt = 'IME composing prompt'
  await promptInput.fill(composingPrompt)
  await expect(sendButton).toBeEnabled()
  const composingKeydown = await promptInput.evaluate((element) => {
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      isComposing: true
    })

    return {
      dispatchResult: element.dispatchEvent(event),
      defaultPrevented: event.defaultPrevented,
      isComposing: event.isComposing
    }
  })
  expect(composingKeydown).toEqual({
    dispatchResult: true,
    defaultPrevented: false,
    isComposing: true
  })
  await expect(promptInput).toHaveValue(composingPrompt)
  await expect(appWindow.getByRole('article')).toHaveCount(2)
  await expect(
    appWindow.locator('[data-pending="true"]').filter({ hasText: composingPrompt })
  ).toHaveCount(0)

  const enterPrompt = 'Enter lifecycle prompt'
  await promptInput.fill(enterPrompt)
  await expect(sendButton).toBeEnabled()
  await promptInput.press('Enter')

  await expect(appWindow.getByText(enterPrompt, { exact: true })).toBeVisible()
  await expect(
    appWindow.locator('[data-pending="true"]').filter({ hasText: enterPrompt })
  ).toBeVisible()
  await expect(appWindow.getByText(`Fake response for: ${enterPrompt}`)).toBeVisible()
  await expect(
    appWindow.locator('[data-pending="true"]').filter({ hasText: enterPrompt })
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
  await expect(appWindow.getByRole('heading', { name: 'Project sessions' })).toHaveCount(0)
  await expect(openProjectFolderButton(appWindow)).toBeVisible()
  await expect(appWindow.getByRole('form', { name: 'Open project by directory' })).toHaveCount(0)
  await expect(appWindow.getByRole('navigation', { name: 'Projects' })).toBeVisible()
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
  await expect(appWindow.getByRole('heading', { name: 'Providers', exact: true })).toBeVisible()
  await expect(appWindow.getByText('Connected Fake Provider')).toBeVisible()
  const providerSearch = appWindow.getByLabel('Search providers')
  await expect(providerSearch).toBeVisible()
  await expect(providerSearch).not.toBeFocused()
  await expect(appWindow.getByLabel('All OpenCode providers')).toBeVisible()
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

test('connects and disconnects OpenCode API-key providers from settings without persisting secrets', async ({
  appWindow,
  electronApp
}) => {
  const userDataPath = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const appConfigPath = join(userDataPath, 'openkhodam-config.json')
  const providerSecret = 'sk-provider-secret-fixture'

  await waitForChatShell(appWindow)
  await projectSettingsLink(appWindow).click()

  const providersSection = appWindow.locator(
    'section[aria-labelledby="opencode-providers-heading"]'
  )
  await expect(providersSection).toBeVisible()
  await expect(providersSection.getByText('Connected Fake Provider')).toBeVisible()
  const providerViewport = providersSection
    .getByLabel('All OpenCode providers')
    .locator('[data-slot="scroll-area-viewport"]')
  await expect
    .poll(async () =>
      providerViewport.evaluate((scrollable) => {
        return {
          clientHeight: scrollable.clientHeight,
          scrollHeight: scrollable.scrollHeight
        }
      })
    )
    .toMatchObject({
      clientHeight: expect.any(Number),
      scrollHeight: expect.any(Number)
    })
  const providerScrollMetrics = await providerViewport.evaluate((scrollable) => {
    return { clientHeight: scrollable.clientHeight, scrollHeight: scrollable.scrollHeight }
  })
  expect(providerScrollMetrics.scrollHeight).toBeGreaterThan(providerScrollMetrics.clientHeight)
  const providerScrollTop = await providerViewport.evaluate((scrollable) => {
    scrollable.scrollTop = scrollable.scrollHeight
    return scrollable.scrollTop
  })
  expect(providerScrollTop).toBeGreaterThan(0)
  await expect(providersSection.getByText('Disconnected Provider')).toBeVisible()

  const disconnectedRow = providersSection
    .getByRole('listitem')
    .filter({ hasText: 'Disconnected Provider' })
  await expect(disconnectedRow.getByText('Disconnected', { exact: true })).toBeVisible()
  await disconnectedRow.getByRole('button', { name: 'Connect provider', exact: true }).click()

  const dialog = appWindow.getByRole('dialog', { name: 'Connect Disconnected Provider' })
  await expect(dialog).toBeVisible()
  const dialogContent = appWindow.locator('[data-slot="dialog-content"]')
  await expect(dialogContent).toBeVisible()
  await expect(appWindow.locator('[data-slot="sheet-content"]')).toHaveCount(0)
  await dialog.getByLabel('Workspace label').fill('Fixture workspace')
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
  await dialog.getByRole('button', { name: 'US' }).click()
  const apiKey = dialog.getByLabel('API key')
  await expect(apiKey).toBeFocused()
  await apiKey.fill(providerSecret)
  await dialog.getByRole('button', { name: 'Connect provider', exact: true }).click()
  await expect(dialog.getByText('Disconnected Provider connected.', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  await expect(
    disconnectedRow.getByRole('button', { name: 'Disconnect provider', exact: true })
  ).toBeVisible()
  await expect(disconnectedRow.getByText('Connected', { exact: true })).toBeVisible()

  const configRaw = (await readOptionalFile(appConfigPath)) ?? ''
  const artifactsRaw = (await readOptionalFile(projectArtifactsFile)) ?? ''
  expect(configRaw).not.toContain(providerSecret)
  expect(artifactsRaw).not.toContain(providerSecret)

  await disconnectedRow.getByRole('button', { name: 'Disconnect provider', exact: true }).click()
  await expect(
    disconnectedRow.getByRole('button', { name: 'Connect provider', exact: true })
  ).toBeVisible()
  await expect(disconnectedRow.getByText('Disconnected', { exact: true })).toBeVisible()
})

test('connects an OpenCode OAuth provider from settings using the fixture OAuth callback', async ({
  appWindow,
  electronApp
}) => {
  await installProviderOAuthCapture(electronApp)
  await waitForChatShell(appWindow)
  await projectSettingsLink(appWindow).click()

  const providersSection = appWindow.locator(
    'section[aria-labelledby="opencode-providers-heading"]'
  )
  const oauthRow = providersSection.locator('[data-provider-id="oauth-provider"]')
  await expect(oauthRow.getByText('Disconnected', { exact: true })).toBeVisible()
  await oauthRow.getByRole('button', { name: 'Connect provider', exact: true }).click()

  const dialog = appWindow.getByRole('dialog', { name: 'Connect OAuth Provider' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'OAuth code' }).click()
  await expect(dialog.getByRole('link', { name: 'Open authorization link' })).toBeVisible()

  const authUrl = await waitForMainProcessValue(async () =>
    electronApp.evaluate(() => (globalThis as any).__providerOAuthCapture?.authUrl ?? null)
  )
  expect(authUrl).toBe('https://auth.example.test/oauth-provider?method=0')

  await dialog.getByLabel('Authorization code').fill('fixture-oauth-code')
  await dialog.getByRole('button', { name: 'Complete OAuth', exact: true }).click()
  await expect(dialog.getByText('OAuth Provider connected.', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  const connectedOauthRow = providersSection.locator('[data-provider-id="oauth-provider"]')
  await expect(
    connectedOauthRow.getByRole('button', { name: 'Disconnect provider', exact: true })
  ).toBeVisible()
  await expect(connectedOauthRow.getByText('Connected', { exact: true })).toBeVisible()
})

test('opens provider onboarding from the empty model picker and refreshes connected models', async ({
  appWindow,
  fakeOpenCodeServer
}) => {
  fakeOpenCodeServer.setConnectedProviders([])
  await seedOpenedFakeProject(appWindow)
  await projectChatLink(appWindow).filter({ hasText: 'Fake Project' }).click()
  await expectOpenedProjectRouteResolved(appWindow)

  const composer = appWindow.getByRole('form', { name: 'Chat prompt' })
  await expect(composer.getByLabel('OpenCode model')).toHaveCount(0)
  const promptRequestsBeforeNavigation = fakeOpenCodeServer.getPromptRequests().length
  const connectProvider = composer.getByRole('link', { name: 'Connect provider', exact: true })
  await expect(connectProvider).toBeVisible()
  await connectProvider.click()
  await expect(appWindow.evaluate(() => window.location.hash)).resolves.toBe(
    '#/settings?section=providers'
  )
  const providersSection = appWindow.locator(
    'section[aria-labelledby="opencode-providers-heading"]'
  )
  await expect(providersSection).toBeVisible()
  await expect(appWindow.getByLabel('Search providers')).toBeFocused()

  const offlineRow = providersSection.locator('[data-provider-id="offline-provider"]')
  await offlineRow.getByRole('button', { name: 'Connect provider', exact: true }).click()
  const dialog = appWindow.getByRole('dialog', { name: 'Connect Disconnected Provider' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Workspace label').fill('CTA workspace')
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
  await dialog.getByRole('button', { name: 'US' }).click()
  await dialog.getByLabel('API key').fill('sk-empty-model-cta-secret')
  await dialog.getByRole('button', { name: 'Connect provider', exact: true }).click()
  await expect(dialog.getByText('Disconnected Provider connected.', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()

  await projectChatLink(appWindow).filter({ hasText: 'Fake Project' }).click()
  await expectOpenedProjectRouteResolved(appWindow)
  const modelPicker = composer.getByLabel('OpenCode model')
  await expect(modelPicker).toBeVisible()
  await expect(modelPicker).toHaveValue('Disconnected Provider · Disconnected Hidden Model')

  const prompt = 'Connected after provider CTA prompt'
  await sendPrompt(appWindow, prompt)
  await expect
    .poll(
      () =>
        fakeOpenCodeServer.getPromptRequests().find((request) => request.text === prompt) ?? null
    )
    .toMatchObject({
      text: prompt,
      model: { providerID: 'offline-provider', modelID: 'offline-model' }
    })
  expect(fakeOpenCodeServer.getPromptRequests()).toHaveLength(promptRequestsBeforeNavigation + 1)
})

test('keeps environment-managed providers read-only and discovers all providers by search', async ({
  appWindow
}) => {
  await waitForChatShell(appWindow)
  await projectSettingsLink(appWindow).click()

  const providersSection = appWindow.locator(
    'section[aria-labelledby="opencode-providers-heading"]'
  )
  const environmentRow = providersSection
    .getByRole('listitem')
    .filter({ hasText: 'Environment Provider' })
  await expect(environmentRow.getByText('Managed by environment', { exact: true })).toBeVisible()
  await expect(environmentRow.getByRole('button', { name: /Disconnect/ })).toHaveCount(0)

  await providersSection.getByLabel('Search providers').fill('oauth')
  await expect(providersSection.getByText('OAuth Provider', { exact: true })).toBeVisible()
  await expect(providersSection.getByText('Disconnected Provider', { exact: true })).toHaveCount(0)
})

test('does not invent provider auth methods when OpenCode returns no methods', async ({
  appWindow,
  fakeOpenCodeServer
}) => {
  fakeOpenCodeServer.setProviderAuthMode('empty')
  await waitForChatShell(appWindow)
  await projectSettingsLink(appWindow).click()

  const providersSection = appWindow.locator(
    'section[aria-labelledby="opencode-providers-heading"]'
  )
  await providersSection
    .getByRole('listitem')
    .filter({ hasText: 'Disconnected Provider' })
    .getByRole('button', { name: 'Connect provider', exact: true })
    .click()

  const dialog = appWindow.getByRole('dialog', { name: 'Connect Disconnected Provider' })
  await expect(
    dialog.getByText('No auth methods found for this provider.', { exact: true })
  ).toBeVisible()
  await expect(dialog.getByLabel('API key')).toHaveCount(0)
  expect(fakeOpenCodeServer.getProviderAuthRequests()).toEqual([])
})

test('blocks provider connection when OpenCode provider auth fails', async ({
  appWindow,
  fakeOpenCodeServer
}) => {
  fakeOpenCodeServer.setProviderAuthMode('error')
  await waitForChatShell(appWindow)
  await projectSettingsLink(appWindow).click()

  const providersSection = appWindow.locator(
    'section[aria-labelledby="opencode-providers-heading"]'
  )
  await providersSection
    .getByRole('listitem')
    .filter({ hasText: 'Disconnected Provider' })
    .getByRole('button', { name: 'Connect provider', exact: true })
    .click()

  const dialog = appWindow.getByRole('dialog', { name: 'Connect Disconnected Provider' })
  await expect(dialog.getByText(/Provider auth methods are unavailable/)).toBeVisible()
  await expect(dialog.getByLabel('API key')).toHaveCount(0)
  expect(fakeOpenCodeServer.getProviderAuthRequests()).toEqual([])
})

test('auto-selects a sole OpenCode auth method and sends exact prompt metadata', async ({
  appWindow,
  fakeOpenCodeServer
}) => {
  await waitForChatShell(appWindow)
  await projectSettingsLink(appWindow).click()

  const providersSection = appWindow.locator(
    'section[aria-labelledby="opencode-providers-heading"]'
  )
  await providersSection
    .locator('[data-provider-id="fake-provider"]')
    .getByRole('button', { name: 'Connect provider', exact: true })
    .click()
  const singletonDialog = appWindow.getByRole('dialog', { name: 'Connect Connected Fake Provider' })
  await expect(singletonDialog.getByLabel('API key')).toBeVisible()
  await singletonDialog.getByLabel('API key').fill('singleton-key')
  await singletonDialog.getByRole('button', { name: 'Connect provider', exact: true }).click()
  await expect(
    singletonDialog.getByText('Connected Fake Provider connected.', { exact: true })
  ).toBeVisible()
  expect(fakeOpenCodeServer.getProviderAuthRequests()).toContainEqual({
    providerID: 'fake-provider',
    key: 'singleton-key',
    metadata: null
  })

  await singletonDialog.getByRole('button', { name: 'Done', exact: true }).click()
  const offlineRow = providersSection.locator('[data-provider-id="offline-provider"]')
  await offlineRow.getByRole('button', { name: 'Connect provider', exact: true }).click()
  const dialog = appWindow.getByRole('dialog', { name: 'Connect Disconnected Provider' })
  await dialog.getByLabel('Workspace label').fill('Exact workspace')
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
  await dialog.getByRole('button', { name: 'EU' }).click()
  await dialog.getByLabel('API key').fill('metadata-key')
  await dialog.getByRole('button', { name: 'Connect provider', exact: true }).click()
  await expect(dialog.getByText('Disconnected Provider connected.', { exact: true })).toBeVisible()
  expect(fakeOpenCodeServer.getProviderAuthRequests()).toContainEqual({
    providerID: 'offline-provider',
    key: 'metadata-key',
    metadata: { workspace: 'Exact workspace', region: 'eu' }
  })
})

test('completes OAuth auto without prompting for a callback code', async ({
  appWindow,
  electronApp
}) => {
  await installProviderOAuthCapture(electronApp)
  await waitForChatShell(appWindow)
  await projectSettingsLink(appWindow).click()

  const providersSection = appWindow.locator(
    'section[aria-labelledby="opencode-providers-heading"]'
  )
  await providersSection
    .locator('[data-provider-id="oauth-provider"]')
    .getByRole('button', { name: 'Connect provider', exact: true })
    .click()
  const dialog = appWindow.getByRole('dialog', { name: 'Connect OAuth Provider' })
  await dialog.getByRole('button', { name: 'OAuth auto' }).click()
  await expect(dialog.getByText('OAuth Provider connected.', { exact: true })).toBeVisible()
  await expect(dialog.getByLabel('Authorization code')).toHaveCount(0)
})

test('auto-enters prompted singleton API auth using the original method index', async ({
  appWindow
}) => {
  await waitForChatShell(appWindow)
  await projectSettingsLink(appWindow).click()
  const providersSection = appWindow.locator(
    'section[aria-labelledby="opencode-providers-heading"]'
  )
  const dialog = appWindow.getByRole('dialog', { name: 'Connect Singleton Prompt Provider' })
  await providersSection
    .locator('[data-provider-id="singleton-prompt-provider"]')
    .getByRole('button', { name: 'Connect provider', exact: true })
    .click()
  await expect(dialog.getByLabel('Tenant name')).toBeVisible()
  await expect(dialog.getByRole('list', { name: 'Provider auth methods' })).toHaveCount(0)
  await dialog.getByLabel('Tenant name').fill('fixture-tenant')
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(dialog.getByLabel('API key')).toBeVisible()
})

test('auto-starts singleton OAuth auth without a method picker', async ({
  appWindow,
  electronApp
}) => {
  await installProviderOAuthCapture(electronApp)
  await waitForChatShell(appWindow)
  await projectSettingsLink(appWindow).click()
  const providersSection = appWindow.locator(
    'section[aria-labelledby="opencode-providers-heading"]'
  )
  const dialog = appWindow.getByRole('dialog', { name: 'Connect Singleton OAuth Provider' })
  await providersSection
    .locator('[data-provider-id="singleton-oauth-provider"]')
    .getByRole('button', { name: 'Connect provider', exact: true })
    .click()
  await expect(
    dialog.getByText('Singleton OAuth Provider connected.', { exact: true })
  ).toBeVisible()
  await expect(dialog.getByRole('list', { name: 'Provider auth methods' })).toHaveCount(0)
  await expect
    .poll(() =>
      electronApp.evaluate(() => (globalThis as any).__providerOAuthCapture?.authUrl ?? null)
    )
    .toBe('https://auth.example.test/singleton-oauth-provider?method=0')
})

test('unmounting the provider dialog cancels delayed OAuth continuations', async ({
  appWindow,
  electronApp,
  fakeOpenCodeServer
}) => {
  fakeOpenCodeServer.armOAuthAuthorizeGate('oauth-provider')
  await installProviderOAuthCapture(electronApp)
  await waitForChatShell(appWindow)
  await projectSettingsLink(appWindow).click()
  const providersSection = appWindow.locator(
    'section[aria-labelledby="opencode-providers-heading"]'
  )
  await providersSection
    .locator('[data-provider-id="oauth-provider"]')
    .getByRole('button', { name: 'Connect provider', exact: true })
    .click()
  const dialog = appWindow.getByRole('dialog', { name: 'Connect OAuth Provider' })
  await dialog.getByRole('button', { name: 'OAuth auto' }).click()
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
  await fakeOpenCodeServer.waitForOAuthAuthorize('oauth-provider')
  await appWindow.evaluate(() => {
    window.location.hash = '#/'
  })
  await expect(appWindow.getByRole('heading', { name: 'Settings' })).toHaveCount(0)
  await expect(dialog).toHaveCount(0)
  fakeOpenCodeServer.releaseOAuthAuthorize('oauth-provider')
  await fakeOpenCodeServer.waitForOAuthAuthorizeSettlement('oauth-provider')
  await expect
    .poll(() =>
      electronApp.evaluate(() => (globalThis as any).__providerOAuthCapture?.authUrl ?? null)
    )
    .toBe(null)
  expect(fakeOpenCodeServer.getOAuthRequests()).toEqual([
    { providerID: 'oauth-provider', type: 'authorize' }
  ])
  expect(fakeOpenCodeServer.getConnectedProviders()).not.toContain('oauth-provider')
})

test('retries provider auth after a mutation failure without stale state', async ({
  appWindow,
  fakeOpenCodeServer
}) => {
  fakeOpenCodeServer.setProviderConnectMode('fail-once')
  await waitForChatShell(appWindow)
  await projectSettingsLink(appWindow).click()
  const providersSection = appWindow.locator(
    'section[aria-labelledby="opencode-providers-heading"]'
  )
  await providersSection
    .locator('[data-provider-id="fake-provider"]')
    .getByRole('button', { name: 'Connect provider', exact: true })
    .click()
  const dialog = appWindow.getByRole('dialog', { name: 'Connect Connected Fake Provider' })
  await dialog.getByLabel('API key').fill('retry-key')
  await dialog.getByRole('button', { name: 'Connect provider', exact: true }).click()
  await expect(
    dialog.getByText('Fixture provider connection failed.', { exact: true })
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(dialog.getByLabel('API key')).toHaveValue('')
  await dialog.getByLabel('API key').fill('retry-key')
  await dialog.getByRole('button', { name: 'Connect provider', exact: true }).click()
  await expect(
    dialog.getByText('Connected Fake Provider connected.', { exact: true })
  ).toBeVisible()
  expect(fakeOpenCodeServer.getProviderAuthRequests()).toEqual([
    { providerID: 'fake-provider', key: 'retry-key', metadata: null },
    { providerID: 'fake-provider', key: 'retry-key', metadata: null }
  ])
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
        googleSheetsSpreadsheetsScope,
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
        googleSheetsSpreadsheetsScope,
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
