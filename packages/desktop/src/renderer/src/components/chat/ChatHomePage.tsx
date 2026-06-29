import { Link } from '@tanstack/react-router'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import {
  useDefaultLayout,
  type PanelImperativeHandle,
  type PanelSize
} from 'react-resizable-panels'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList
} from '@/components/ui/combobox'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea
} from '@/components/ui/input-group'
import { Message, MessageContent, MessageFooter, MessageHeader } from '@/components/ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '@/components/ui/message-scroller'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  readSidebarOpenState
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

import type { ChatMessage, ChatProject, ProjectChat } from '../../hooks/useChatInterfaceData'
import { ChatMessageParts } from './ChatMessageParts'
import type {
  OpenCodeChatShellState,
  OpenCodeModelOption,
  OpenCodeProjectRouteState,
  OpenCodeSessionRouteState,
  OpenCodeStartConversationState
} from '../../hooks/useOpenCodeChatInterface'

type ChatHomePageProps = {
  shell: OpenCodeChatShellState
  project?: OpenCodeProjectRouteState
  session?: OpenCodeSessionRouteState
  activePane?: ReactNode
}

const CHAT_HOME_LAYOUT_STORAGE_ID = 'chat-home-layout'
const CHAT_HOME_PROJECT_SIDEBAR_EXPANDED_SIZE_STORAGE_KEY =
  'chat-home-project-sidebar-expanded-size'
const CHAT_MESSAGE_SCROLL_END_THRESHOLD = 120

export function ChatHomePage({
  shell,
  project,
  session,
  activePane
}: ChatHomePageProps): JSX.Element {
  const projectSidebarPanelRef = useRef<PanelImperativeHandle | null>(null)
  const hasAppliedPersistedProjectSidebarStateRef = useRef(false)
  const persistedLayout = useDefaultLayout({
    id: CHAT_HOME_LAYOUT_STORAGE_ID,
    panelIds: ['project-sidebar-panel', 'active-pane-panel']
  })
  const [isProjectSidebarOpen, setProjectSidebarOpen] = useState(() => readSidebarOpenState(true))

  const syncProjectSidebarPanel = useCallback((open: boolean): void => {
    const projectSidebarPanel = projectSidebarPanelRef.current
    if (!projectSidebarPanel) return

    if (open) {
      projectSidebarPanel.expand()
      const restoredExpandedSize = readStoredProjectSidebarExpandedSize()
      if (restoredExpandedSize !== null) projectSidebarPanel.resize(`${restoredExpandedSize}px`)
      return
    }

    projectSidebarPanel.collapse()
  }, [])

  const handleProjectSidebarOpenChange = useCallback(
    (open: boolean): void => {
      syncProjectSidebarPanel(open)
      setProjectSidebarOpen(open)
    },
    [syncProjectSidebarPanel]
  )

  const handleProjectSidebarResize = useCallback((size: PanelSize): void => {
    if (!hasAppliedPersistedProjectSidebarStateRef.current) return

    const isCollapsed = projectSidebarPanelRef.current?.isCollapsed() ?? size.inPixels <= 64
    if (!isCollapsed) writeStoredProjectSidebarExpandedSize(size.inPixels)
    setProjectSidebarOpen((current) => {
      const nextOpen = !isCollapsed
      return current === nextOpen ? current : nextOpen
    })
  }, [])

  useEffect(() => {
    syncProjectSidebarPanel(isProjectSidebarOpen)
    hasAppliedPersistedProjectSidebarStateRef.current = true
  }, [isProjectSidebarOpen, syncProjectSidebarPanel])

  return (
    <SidebarProvider
      open={isProjectSidebarOpen}
      onOpenChange={handleProjectSidebarOpenChange}
      style={
        {
          '--sidebar-width': '100%'
        } as CSSProperties
      }
      className="h-dvh min-h-0 overflow-hidden"
    >
      <ResizablePanelGroup
        id="chat-home-layout"
        defaultLayout={persistedLayout.defaultLayout}
        onLayoutChanged={persistedLayout.onLayoutChanged}
        orientation="horizontal"
        className="min-h-0 min-w-0"
      >
        <ResizablePanel
          id="project-sidebar-panel"
          panelRef={projectSidebarPanelRef}
          defaultSize="25%"
          minSize="16rem"
          maxSize="32rem"
          collapsedSize="3rem"
          collapsible
          onResize={handleProjectSidebarResize}
        >
          {isProjectSidebarOpen ? (
            <ProjectChatSidebar
              shell={shell}
              project={project}
              session={session}
              onCollapse={() => handleProjectSidebarOpenChange(false)}
            />
          ) : (
            <CollapsedProjectSidebarRail onRestore={() => handleProjectSidebarOpenChange(true)} />
          )}
        </ResizablePanel>
        <ResizableHandle withHandle aria-label="Resize project sidebar" />
        <ResizablePanel id="active-pane-panel" defaultSize="75%" minSize="20rem">
          <main className="grid h-full min-h-0 min-w-0 grid-cols-1 overflow-hidden bg-background text-foreground">
            {activePane ?? <ActiveChatPanel project={project} session={session} />}
          </main>
        </ResizablePanel>
      </ResizablePanelGroup>
    </SidebarProvider>
  )
}

function ProjectChatSidebar({
  shell,
  project,
  session,
  onCollapse
}: {
  shell: OpenCodeChatShellState
  project?: OpenCodeProjectRouteState
  session?: OpenCodeSessionRouteState
  onCollapse: () => void
}): JSX.Element {
  return (
    <Sidebar
      collapsible="none"
      className="relative min-h-0 border-r bg-sidebar/70"
      role="complementary"
      aria-labelledby="projects-heading"
    >
      <SidebarHeader className="p-4 pb-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-start justify-between gap-3 px-2 py-1">
              <div className="min-w-0">
                <p className="text-muted-foreground text-sm font-medium">OpenKhodam</p>
                <h1 id="projects-heading" className="text-2xl font-semibold tracking-tight">
                  Project folders
                </h1>
              </div>
              <Button
                type="button"
                size="xs"
                variant="outline"
                aria-label="Collapse project sidebar"
                title="Collapse project sidebar"
                onClick={onCollapse}
              >
                Collapse
              </Button>
            </div>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <div className="flex flex-wrap gap-2 px-2 py-1">
              <Badge variant="secondary">{shell.statusLabel}</Badge>
              <Badge variant="outline">{shell.eventLabel}</Badge>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="px-4 pb-4">
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <OpenProjectByDirectoryForm shell={shell} />
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <nav aria-label="Project folders">
              <SidebarMenu className="gap-2">
                {shell.emptyMessage ? (
                  <SidebarMenuItem>
                    <StatusCard>{shell.emptyMessage}</StatusCard>
                  </SidebarMenuItem>
                ) : null}
                {shell.errorMessage ? (
                  <SidebarMenuItem>
                    <StatusCard tone="error">{shell.errorMessage}</StatusCard>
                  </SidebarMenuItem>
                ) : null}
                {shell.projects.map((chatProject) => (
                  <ProjectWithSessions
                    key={chatProject.id}
                    project={chatProject}
                    routeProject={project}
                    session={session}
                  />
                ))}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t p-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex flex-wrap gap-2 px-2 py-1">
              <Button
                nativeButton={false}
                render={<Link to="/" role="link" />}
                size="xs"
                variant="outline"
              >
                Home
              </Button>
              <Button
                nativeButton={false}
                render={<Link to="/settings" role="link" />}
                size="xs"
                variant="outline"
              >
                Settings
              </Button>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function CollapsedProjectSidebarRail({ onRestore }: { onRestore: () => void }): JSX.Element {
  return (
    <aside
      className="flex h-full w-full flex-col items-center border-r bg-sidebar/70 py-3 text-sidebar-foreground"
      role="complementary"
      aria-label="Collapsed project sidebar"
    >
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-auto min-h-28 w-8 px-1 py-2 [writing-mode:vertical-rl]"
        aria-label="Restore project sidebar"
        title="Restore project sidebar"
        onClick={onRestore}
      >
        Projects
      </Button>
    </aside>
  )
}

function OpenProjectByDirectoryForm({ shell }: { shell: OpenCodeChatShellState }): JSX.Element {
  return (
    <form
      className="mb-6 rounded-none border bg-card p-3"
      aria-label="Open project by directory"
      onSubmit={(event) => {
        event.preventDefault()
        if (shell.canOpenProject) shell.openProjectByDirectory()
      }}
    >
      <label
        className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        htmlFor="project-directory"
      >
        Project directory
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id="project-directory"
          className="min-w-0 flex-1 rounded-none border bg-background px-2 py-1 text-sm"
          value={shell.projectDirectoryText}
          onChange={(event) => shell.setProjectDirectoryText(event.currentTarget.value)}
          placeholder="/path/to/project"
        />
        <Button type="submit" size="sm" disabled={!shell.canOpenProject}>
          Open
        </Button>
      </div>
      {shell.openProjectStatusMessage ? (
        <p className="mt-2 text-xs text-muted-foreground">{shell.openProjectStatusMessage}</p>
      ) : null}
      {shell.openedProject ? <OpenedProjectDetails project={shell.openedProject} /> : null}
    </form>
  )
}

function OpenedProjectDetails({
  project
}: {
  project: OpenCodeChatShellState['openedProject']
}): JSX.Element | null {
  if (!project) return null
  return (
    <section
      className="mt-2 text-xs text-muted-foreground"
      aria-labelledby="opened-project-heading"
    >
      <h2 id="opened-project-heading" className="font-semibold text-foreground">
        Opened project details
      </h2>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
        <dt>Name</dt>
        <dd>{project.name}</dd>
        <dt>Directory</dt>
        <dd>{project.directory}</dd>
        <dt>ID</dt>
        <dd>{project.id}</dd>
      </dl>
    </section>
  )
}

function ProjectButton({
  project,
  isActive
}: {
  project: ChatProject
  isActive: boolean
}): JSX.Element {
  return (
    <SidebarMenuButton
      asChild
      disabled={!project.id}
      isActive={isActive}
      size="lg"
      variant={isActive ? 'outline' : 'default'}
      className="h-auto px-3 py-2"
    >
      <Link to="/projects/$projectId" params={{ projectId: project.id }}>
        <span className="flex min-w-0 flex-1 flex-col items-stretch gap-1 text-left">
          <span className="truncate text-sm font-medium">{project.name}</span>
          {project.subtitle ? (
            <span className="text-muted-foreground line-clamp-2 text-xs leading-5 whitespace-normal break-words">
              {project.subtitle}
            </span>
          ) : null}
        </span>
      </Link>
    </SidebarMenuButton>
  )
}

function ProjectWithSessions({
  project,
  routeProject,
  session
}: {
  project: ChatProject
  routeProject?: OpenCodeProjectRouteState
  session?: OpenCodeSessionRouteState
}): JSX.Element {
  const isActive = project.subtitle === routeProject?.selectedDirectory
  return (
    <SidebarMenuItem>
      <ProjectButton project={project} isActive={isActive} />
      {isActive ? <SelectedProjectSessions project={routeProject} session={session} /> : null}
    </SidebarMenuItem>
  )
}

function SelectedProjectSessions({
  project,
  session
}: {
  project?: OpenCodeProjectRouteState
  session?: OpenCodeSessionRouteState
}): JSX.Element {
  return (
    <nav className="mt-2 ml-3 border-l pl-3" aria-label="Project sessions">
      <h2 id="sessions-heading" className="sr-only">
        Project sessions
      </h2>
      <ul className="flex flex-col gap-1">
        {project?.isLoading ? <StatusListItem>Loading OpenCode data…</StatusListItem> : null}
        {project?.errorMessage ? (
          <StatusListItem tone="error">{project.errorMessage}</StatusListItem>
        ) : null}
        {project?.emptyMessage ? <StatusListItem>{project.emptyMessage}</StatusListItem> : null}
        {project?.sessions.map((chat) => (
          <ProjectChatListItem
            key={chat.id}
            chat={chat}
            projectId={project.selectedProject?.id}
            isActive={chat.id === session?.activeChat?.id}
          />
        ))}
      </ul>
    </nav>
  )
}

function StatusListItem({
  children,
  tone
}: {
  children: string
  tone?: 'default' | 'error'
}): JSX.Element {
  return (
    <li>
      <StatusCard tone={tone}>{children}</StatusCard>
    </li>
  )
}

function ProjectChatListItem({
  chat,
  projectId,
  isActive
}: {
  chat: ProjectChat
  projectId: string | undefined
  isActive: boolean
}): JSX.Element {
  const content = (
    <span className="flex min-w-0 flex-1 flex-col items-stretch gap-1 text-left">
      <span className="flex items-center justify-between gap-3">
        <span className="truncate text-sm font-medium">{chat.title}</span>
        <span className="text-muted-foreground shrink-0 text-xs">{chat.updatedAt}</span>
      </span>
      <span className="text-muted-foreground line-clamp-2 text-xs leading-5 whitespace-normal">
        {chat.summary}
      </span>
    </span>
  )
  return (
    <li>
      {projectId ? (
        <Button
          nativeButton={false}
          render={
            <Link
              to="/projects/$projectId/sessions/$sessionId"
              params={{ projectId, sessionId: chat.id }}
              role="link"
            />
          }
          disabled={chat.disabled}
          variant={isActive ? 'outline' : 'ghost'}
          className="h-auto w-full justify-start px-3 py-2"
        >
          {content}
        </Button>
      ) : (
        <Button
          type="button"
          disabled
          variant={isActive ? 'outline' : 'ghost'}
          className="h-auto w-full justify-start px-3 py-2"
        >
          {content}
        </Button>
      )}
    </li>
  )
}

export function ActiveChatPanel({
  project,
  session,
  emptyMessage,
  composer,
  composerErrorMessage
}: {
  project?: OpenCodeProjectRouteState
  session?: OpenCodeSessionRouteState
  emptyMessage?: string
  composer?: ReactNode
  composerErrorMessage?: string | null
}): JSX.Element {
  return (
    <section
      className="flex min-h-0 min-w-0 flex-col overflow-hidden"
      aria-labelledby="active-chat-heading"
    >
      <header className="shrink-0 flex items-center justify-between gap-4 px-6 py-4">
        <div>
          <p className="text-muted-foreground text-sm">Active chat</p>
          <h2 id="active-chat-heading" className="text-xl font-semibold tracking-tight">
            {session?.activeChat?.title ?? 'No chat selected'}
          </h2>
          {project?.selectedProject ? (
            <p className="text-muted-foreground text-sm">{project.selectedProject.name}</p>
          ) : null}
        </div>
        <Badge variant="secondary">OpenCode</Badge>
      </header>
      <Separator />
      <ChatMessageList
        messages={session?.messages ?? []}
        emptyMessage={
          session?.emptyMessage ??
          emptyMessage ??
          (!project ? 'Select a project to view sessions.' : 'Select a session to view messages.')
        }
        isLoading={session?.isLoading ?? false}
        errorMessage={session?.errorMessage ?? composerErrorMessage ?? null}
        successMessage={session?.successMessage ?? null}
      />
      {composer ??
        (session ? (
          <ChatPromptComposer
            promptText={session.promptText}
            setPromptText={session.setPromptText}
            sendPrompt={session.sendPrompt}
            canSendPrompt={session.canSendPrompt}
            isSending={session.isSending}
            modelOptions={session.modelOptions}
            selectedModelID={session.selectedModelID}
            setSelectedModelID={session.setSelectedModelID}
            isLoadingModels={session.isLoadingModels}
          />
        ) : null)}
    </section>
  )
}

export function ProjectRouteActivePane({
  project,
  startConversation
}: {
  project?: OpenCodeProjectRouteState
  startConversation?: OpenCodeStartConversationState
}): JSX.Element {
  return (
    <ActiveChatPanel
      project={project}
      emptyMessage={project?.emptyMessage ?? 'Start a new conversation for this project.'}
      composer={
        startConversation ? (
          <ChatPromptComposer
            promptText={startConversation.promptText}
            setPromptText={startConversation.setPromptText}
            sendPrompt={() => startConversation.startConversation()}
            canSendPrompt={startConversation.canSendPrompt}
            isSending={startConversation.isSending}
            modelOptions={startConversation.modelOptions}
            selectedModelID={startConversation.selectedModelID}
            setSelectedModelID={startConversation.setSelectedModelID}
            isLoadingModels={startConversation.isLoadingModels}
            helperText="Start a new conversation in this project."
            modelHelperText={startConversation.modelHelperText}
          />
        ) : null
      }
      composerErrorMessage={startConversation?.errorMessage ?? null}
    />
  )
}

export function SessionRouteActivePane({
  project,
  session
}: {
  project?: OpenCodeProjectRouteState
  session: OpenCodeSessionRouteState
}): JSX.Element {
  return <ActiveChatPanel project={project} session={session} />
}

function ChatMessageList({
  messages,
  emptyMessage,
  isLoading,
  errorMessage,
  successMessage
}: {
  messages: ChatMessage[]
  emptyMessage: string | null
  isLoading: boolean
  errorMessage: string | null
  successMessage: string | null
}): JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const lastInitialScrollKeyRef = useRef<string | null>(null)
  const lastMessageCountRef = useRef<number | null>(null)
  const lastMessageContentKeyRef = useRef<string | null>(null)
  const lastSuccessMessageRef = useRef<string | null>(null)
  const lastViewportScrollStateRef = useRef<ViewportScrollState | null>(null)
  const preUpdateViewportScrollStateRef = useRef<ViewportScrollState | null>(null)
  const followLiveEdgeGenerationRef = useRef(0)
  const shouldFollowLiveEdgeRef = useRef(true)
  const userScrollAwayLockUntilRef = useRef(0)
  const ignoreScrollAwayUntilRef = useRef(0)
  const statusCards = useMemo(
    () => [
      isLoading ? { key: 'loading', content: 'Loading OpenCode data…' } : null,
      errorMessage ? { key: 'error', content: errorMessage, tone: 'error' as const } : null,
      successMessage ? { key: 'success', content: successMessage } : null,
      emptyMessage ? { key: 'empty', content: emptyMessage } : null
    ],
    [emptyMessage, errorMessage, isLoading, successMessage]
  )
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 132,
    getItemKey: (index) => messages[index]?.id ?? index,
    anchorTo: 'end',
    followOnAppend: true,
    scrollEndThreshold: CHAT_MESSAGE_SCROLL_END_THRESHOLD,
    overscan: 6,
    measureElement: (element) => element.getBoundingClientRect().height
  })

  const initialScrollKey = messages.length > 0 ? messages[0]!.id : 'empty'
  const messageContentKey = useMemo(
    () => messages.map((message) => `${message.id}:${message.content.length}`).join('|'),
    [messages]
  )

  const cancelLiveEdgeFollow = useCallback((): void => {
    shouldFollowLiveEdgeRef.current = false
    followLiveEdgeGenerationRef.current += 1
  }, [])

  const followLiveEdge = useCallback((): void => {
    if (performance.now() < userScrollAwayLockUntilRef.current) return
    shouldFollowLiveEdgeRef.current = true
  }, [])

  const forceFollowLiveEdge = useCallback((): void => {
    userScrollAwayLockUntilRef.current = 0
    ignoreScrollAwayUntilRef.current = performance.now() + 100
    shouldFollowLiveEdgeRef.current = true
  }, [])

  const markUserScrollAwayIntent = useCallback((): void => {
    ignoreScrollAwayUntilRef.current = 0
    userScrollAwayLockUntilRef.current = performance.now() + 1000
    cancelLiveEdgeFollow()
  }, [cancelLiveEdgeFollow])

  const rememberLiveEdgeIntent = useCallback((): void => {
    const viewport = viewportRef.current
    if (!viewport) return

    const previousState = lastViewportScrollStateRef.current
    const nextState = readViewportScrollState(viewport)
    lastViewportScrollStateRef.current = nextState
    const scrolledAwayFromEnd =
      previousState !== null &&
      Math.round(nextState.scrollTop) < Math.round(previousState.scrollTop) &&
      nextState.distanceFromEnd > CHAT_MESSAGE_SCROLL_END_THRESHOLD

    if (nextState.atLiveEdge) followLiveEdge()
    else if (scrolledAwayFromEnd && performance.now() > ignoreScrollAwayUntilRef.current) {
      cancelLiveEdgeFollow()
    }
  }, [cancelLiveEdgeFollow, followLiveEdge])

  const rememberWheelIntent = useCallback(
    (event: globalThis.WheelEvent): void => {
      if (event.deltaY < 0) markUserScrollAwayIntent()
    },
    [markUserScrollAwayIntent]
  )

  const rememberKeyboardScrollIntent = useCallback(
    (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Home' || event.key === 'PageUp' || event.key === 'ArrowUp') {
        markUserScrollAwayIntent()
      }
    },
    [markUserScrollAwayIntent]
  )

  const rememberViewportScrollState = useCallback((): void => {
    const viewport = viewportRef.current
    if (viewport) lastViewportScrollStateRef.current = readViewportScrollState(viewport)
  }, [])

  const shouldPreserveLiveEdge = useCallback((): boolean => {
    return shouldFollowLiveEdgeRef.current
  }, [])

  const shouldFollowContentChange = useCallback((): boolean => {
    return (
      shouldFollowLiveEdgeRef.current ||
      lastViewportScrollStateRef.current?.atLiveEdge === true ||
      preUpdateViewportScrollStateRef.current?.atLiveEdge === true
    )
  }, [])

  const shouldRecoverNearLiveEdge = useCallback((): boolean => {
    const viewport = viewportRef.current
    if (!viewport) return false
    return readViewportScrollState(viewport).distanceFromEnd <= CHAT_MESSAGE_SCROLL_END_THRESHOLD + 64
  }, [])

  const scrollToEnd = useCallback((): void => {
    const followGeneration = followLiveEdgeGenerationRef.current + 1
    followLiveEdgeGenerationRef.current = followGeneration

    const scroll = () => {
      if (messages.length > 0) {
        virtualizer.scrollToIndex(messages.length - 1, { align: 'end', behavior: 'auto' })
      } else {
        virtualizer.scrollToEnd({ behavior: 'auto' })
      }

      const viewport = viewportRef.current
      if (viewport) viewport.scrollTop = viewport.scrollHeight
    }
    const deferredScroll = () => {
      if (followLiveEdgeGenerationRef.current !== followGeneration) return
      if (!shouldPreserveLiveEdge()) return
      scroll()
      rememberViewportScrollState()
    }
    forceFollowLiveEdge()
    scroll()
    rememberViewportScrollState()
    window.requestAnimationFrame(deferredScroll)
    for (const delay of [50, 150, 300, 600]) window.setTimeout(deferredScroll, delay)
  }, [
    forceFollowLiveEdge,
    messages.length,
    rememberViewportScrollState,
    shouldPreserveLiveEdge,
    virtualizer
  ])

  useEffect(() => {
    if (lastInitialScrollKeyRef.current === initialScrollKey) return
    lastInitialScrollKeyRef.current = initialScrollKey
    if (messages.length > 0) scrollToEnd()
  }, [initialScrollKey, messages.length, scrollToEnd])

  useLayoutEffect(() => {
    const previousSuccessMessage = lastSuccessMessageRef.current
    lastSuccessMessageRef.current = successMessage
    if (!successMessage || previousSuccessMessage === successMessage) return

    const viewport = viewportRef.current
    if (!viewport) return
    const wasFollowingLiveEdge = shouldPreserveLiveEdge()
    const scrollState = readViewportScrollState(viewport)
    lastViewportScrollStateRef.current = scrollState
    if (wasFollowingLiveEdge || scrollState.atLiveEdge) {
      followLiveEdge()
    }
  }, [followLiveEdge, shouldPreserveLiveEdge, successMessage])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    viewport.addEventListener('scroll', rememberLiveEdgeIntent, { passive: true })
    viewport.addEventListener('wheel', rememberWheelIntent, { passive: true })
    viewport.addEventListener('keydown', rememberKeyboardScrollIntent)
    return () => {
      viewport.removeEventListener('scroll', rememberLiveEdgeIntent)
      viewport.removeEventListener('wheel', rememberWheelIntent)
      viewport.removeEventListener('keydown', rememberKeyboardScrollIntent)
    }
  }, [rememberKeyboardScrollIntent, rememberLiveEdgeIntent, rememberWheelIntent])

  useEffect(() => {
    const content = contentRef.current
    if (!content || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      if (shouldFollowContentChange() || shouldRecoverNearLiveEdge()) {
        followLiveEdge()
        scrollToEnd()
      }
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [followLiveEdge, scrollToEnd, shouldFollowContentChange, shouldRecoverNearLiveEdge])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    return () => {
      if (viewport) preUpdateViewportScrollStateRef.current = readViewportScrollState(viewport)
    }
  })

  useLayoutEffect(() => {
    const previousMessageCount = lastMessageCountRef.current
    lastMessageCountRef.current = messages.length
    if (previousMessageCount === null || messages.length <= previousMessageCount) return
    if (
      !shouldFollowContentChange() &&
      !shouldRecoverNearLiveEdge() &&
      !virtualizer.isAtEnd(CHAT_MESSAGE_SCROLL_END_THRESHOLD)
    ) {
      return
    }

    followLiveEdge()
    virtualizer.measure()
    scrollToEnd()
  }, [
    followLiveEdge,
    messages.length,
    scrollToEnd,
    shouldFollowContentChange,
    shouldRecoverNearLiveEdge,
    virtualizer
  ])

  useLayoutEffect(() => {
    const previousMessageContentKey = lastMessageContentKeyRef.current
    lastMessageContentKeyRef.current = messageContentKey
    if (previousMessageContentKey === null || previousMessageContentKey === messageContentKey)
      return
    if (!shouldFollowContentChange() && !shouldRecoverNearLiveEdge()) return

    followLiveEdge()
    virtualizer.measure()
    scrollToEnd()
  }, [
    followLiveEdge,
    messageContentKey,
    scrollToEnd,
    shouldFollowContentChange,
    shouldRecoverNearLiveEdge,
    virtualizer
  ])

  useLayoutEffect(() => {
    rememberViewportScrollState()
  })

  return (
    <MessageScrollerProvider autoScroll={false}>
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport
          ref={viewportRef}
          onScroll={rememberLiveEdgeIntent}
        >
          <MessageScrollerContent aria-busy={isLoading} className="block min-h-full p-6">
            <div ref={contentRef} className="flex min-w-0 flex-col gap-4">
              {statusCards.map((status) =>
                status ? (
                  <StatusCard key={status.key} tone={status.tone}>
                    {status.content}
                  </StatusCard>
                ) : null
              )}
              <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const message = messages[virtualRow.index]
                  if (!message) return null
                  return (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                      scrollAnchor={message.author === 'user'}
                      data-index={virtualRow.index}
                      ref={virtualizer.measureElement}
                      className="absolute start-0 top-0 w-full pb-4"
                      style={{ transform: `translateY(${virtualRow.start}px)` }}
                    >
                      <ChatMessageBubble message={message} />
                    </MessageScrollerItem>
                  )
                })}
              </div>
            </div>
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <div onPointerDownCapture={scrollToEnd} onClickCapture={scrollToEnd}>
          <MessageScrollerButton onClick={scrollToEnd} />
        </div>
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

function readStoredProjectSidebarExpandedSize(): number | null {
  if (typeof localStorage === 'undefined') return null

  const storedSize = Number(
    localStorage.getItem(CHAT_HOME_PROJECT_SIDEBAR_EXPANDED_SIZE_STORAGE_KEY)
  )
  return Number.isFinite(storedSize) && storedSize > 64 ? storedSize : null
}

function writeStoredProjectSidebarExpandedSize(size: number): void {
  if (typeof localStorage === 'undefined' || size <= 64) return
  localStorage.setItem(CHAT_HOME_PROJECT_SIDEBAR_EXPANDED_SIZE_STORAGE_KEY, String(size))
}

type ViewportScrollState = {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  distanceFromEnd: number
  atLiveEdge: boolean
}

function readViewportScrollState(viewport: HTMLElement): ViewportScrollState {
  const distanceFromEnd = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
  return {
    scrollTop: viewport.scrollTop,
    scrollHeight: viewport.scrollHeight,
    clientHeight: viewport.clientHeight,
    distanceFromEnd,
    atLiveEdge: distanceFromEnd <= CHAT_MESSAGE_SCROLL_END_THRESHOLD
  }
}

function StatusCard({
  children,
  tone = 'default'
}: {
  children: string
  tone?: 'default' | 'error'
}): JSX.Element {
  return (
    <div
      className={`rounded-none border px-4 py-3 text-sm ${tone === 'error' ? 'border-destructive text-destructive' : 'border-border bg-card text-muted-foreground'}`}
    >
      {children}
    </div>
  )
}

function ChatMessageBubble({ message }: { message: ChatMessage }): JSX.Element {
  const isUser = message.author === 'user'
  const isPending = message.createdAt === 'Pending'
  return (
    <article
      data-pending={isPending ? 'true' : undefined}
      className="min-w-0"
      aria-label={`${message.author} message at ${message.createdAt}`}
    >
      <Message align={isUser ? 'end' : 'start'}>
        <MessageContent className={cn(isUser ? 'items-end' : 'items-start')}>
          <MessageHeader className="px-0 capitalize">{message.author}</MessageHeader>
          <div
            data-slot="message-surface"
            className={cn(
              'max-w-2xl min-w-0 border px-4 py-3 text-sm shadow-sm',
              isUser
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-card-foreground'
            )}
          >
            <ChatMessageParts parts={message.parts} />
          </div>
          <MessageFooter className="px-0">
            <time>{message.createdAt}</time>
          </MessageFooter>
        </MessageContent>
      </Message>
    </article>
  )
}

function ChatPromptComposer({
  promptText,
  setPromptText,
  sendPrompt,
  canSendPrompt,
  isSending,
  modelOptions,
  selectedModelID,
  setSelectedModelID,
  isLoadingModels,
  helperText = 'Send to the selected session.',
  modelHelperText
}: {
  promptText: string
  setPromptText: (value: string) => void
  sendPrompt: () => void
  canSendPrompt: boolean
  isSending: boolean
  modelOptions: OpenCodeModelOption[]
  selectedModelID: string | null
  setSelectedModelID: (value: string | null) => void
  isLoadingModels: boolean
  helperText?: string
  modelHelperText?: string
}): JSX.Element {
  const modelText = modelHelperText ?? 'Select a connected OpenCode model before sending.'
  const submitPrompt = (): void => {
    if (!canSendPrompt) return
    sendPrompt()
  }

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter') return
    if (!event.metaKey && !event.ctrlKey) return
    if (event.nativeEvent.isComposing) return

    event.preventDefault()
    submitPrompt()
  }

  return (
    <form
      className="shrink-0 bg-background p-4"
      aria-label="Chat prompt"
      onSubmit={(event) => {
        event.preventDefault()
        submitPrompt()
      }}
    >
      <Separator className="mb-4" />
      <label className="sr-only" htmlFor="chat-prompt">
        Message OpenKhodam
      </label>
      <div className="flex flex-col gap-2 md:flex-row md:items-start">
        <ModelPickerCombobox
          options={modelOptions}
          selectedModelID={selectedModelID}
          setSelectedModelID={setSelectedModelID}
          disabled={isSending || isLoadingModels || modelOptions.length === 0}
        />
        <InputGroup className="h-auto min-w-0 flex-1 bg-card shadow-sm has-disabled:bg-card has-disabled:opacity-100">
          <InputGroupTextarea
            id="chat-prompt"
            className="min-h-11 text-sm"
            placeholder="Ask about this project..."
            value={promptText}
            onChange={(event) => setPromptText(event.currentTarget.value)}
            onKeyDown={handlePromptKeyDown}
            disabled={isSending}
          />
          <InputGroupAddon align="block-end" className="justify-end border-t">
            <InputGroupButton type="submit" disabled={!canSendPrompt}>
              {isSending ? 'Sending…' : 'Send'}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>
      <p className="text-muted-foreground mt-2 text-xs">
        {helperText} {modelText}
      </p>
    </form>
  )
}

function ModelPickerCombobox({
  options,
  selectedModelID,
  setSelectedModelID,
  disabled
}: {
  options: OpenCodeModelOption[]
  selectedModelID: string | null
  setSelectedModelID: (value: string | null) => void
  disabled: boolean
}): JSX.Element {
  const selected = options.find((option) => option.id === selectedModelID) ?? null
  return (
    <div className="min-w-0 md:w-64">
      <label className="sr-only" htmlFor="opencode-model-picker">
        OpenCode model
      </label>
      <Combobox
        items={options}
        value={selected}
        onValueChange={(option) => setSelectedModelID(option?.id ?? null)}
        itemToStringValue={(option) => option?.label ?? ''}
      >
        <ComboboxInput
          id="opencode-model-picker"
          className="w-full bg-card"
          placeholder="Select model"
          disabled={disabled}
          aria-label="OpenCode model"
        />
        <ComboboxContent className="w-72">
          <ComboboxEmpty>No connected models found.</ComboboxEmpty>
          <ComboboxList>
            {(option) => (
              <ComboboxItem key={option.id} value={option}>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="truncate font-medium">{option.modelName}</span>
                  <span className="truncate text-muted-foreground">{option.providerName}</span>
                </span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  )
}
