import { Link } from '@tanstack/react-router'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { LinkedGoogleArtifact } from '@openkhodam/ui/types'
import { PanelRightIcon, SquareIcon } from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode
} from 'react'
import type { PanelImperativeHandle, PanelSize } from 'react-resizable-panels'

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
import { Popover, PopoverContent } from '@/components/ui/popover'
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
  SidebarRail
} from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import type { ChatMessage, ChatProject, ProjectChat } from '../../hooks/useChatInterfaceData'
import { ChatActionPane } from './ChatActionPane'
import { ChatMessageParts } from './ChatMessageParts'
import type {
  OpenCodeChatShellState,
  OpenCodeAgentOption,
  OpenCodeModelEffortOption,
  OpenCodeHeartbeatStatus,
  OpenCodeModelOption,
  OpenCodeProjectRouteState,
  OpenCodeSessionRetry,
  OpenCodeSessionRouteState,
  OpenCodeStartConversationState
} from '../../hooks/useOpenCodeChatInterface'

type ChatHomePageProps = {
  shell: OpenCodeChatShellState
  project?: OpenCodeProjectRouteState
  session?: OpenCodeSessionRouteState
  activePane?: ReactNode
  areActiveProjectSessionsVisible?: boolean
  onActiveProjectSessionsToggle?: () => void
}

type ActionPaneControlsContextValue = {
  isActionPaneOpen: boolean
  setActionPaneOpen: (open: boolean) => void
  setActionPaneAvailable: (available: boolean) => void
  selectedActionPaneTab: ActionPaneTab
  selectActionPaneTab: (tab: ActionPaneTab) => void
}

type ActionPaneTab = 'artifacts'

const ActionPaneControlsContext = createContext<ActionPaneControlsContextValue | null>(null)

const emptyChatMessages: ChatMessage[] = []
const emptyLinkedGoogleArtifacts: LinkedGoogleArtifact[] = []
const noop = (): void => {}
const undoSlashCommand = {
  value: 'undo',
  trigger: '/undo',
  title: 'Undo last prompt',
  description: 'Revert the last prompt and restore it to the composer.'
}

export function ChatHomePage({
  shell,
  project,
  session,
  activePane,
  areActiveProjectSessionsVisible = true,
  onActiveProjectSessionsToggle = noop
}: ChatHomePageProps): JSX.Element {
  const projectSidebarPanelRef = useRef<PanelImperativeHandle | null>(null)
  const [isProjectSidebarOpen, setProjectSidebarOpen] = useState(true)
  const [isActionPaneOpen, setActionPaneOpen] = useState(true)
  const [isActionPaneAvailable, setActionPaneAvailable] = useState(false)
  const [selectedActionPaneTab, setSelectedActionPaneTab] = useState<ActionPaneTab>('artifacts')

  const actionPaneControls = useMemo<ActionPaneControlsContextValue>(
    () => ({
      isActionPaneOpen,
      setActionPaneOpen,
      setActionPaneAvailable,
      selectedActionPaneTab,
      selectActionPaneTab: setSelectedActionPaneTab
    }),
    [isActionPaneOpen, selectedActionPaneTab]
  )

  const syncProjectSidebarPanel = useCallback((open: boolean): void => {
    const projectSidebarPanel = projectSidebarPanelRef.current
    if (!projectSidebarPanel) return

    if (open) {
      projectSidebarPanel.expand()
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
    const isCollapsed = projectSidebarPanelRef.current?.isCollapsed() ?? size.inPixels <= 64

    setProjectSidebarOpen(!isCollapsed)
  }, [])

  useEffect(() => {
    syncProjectSidebarPanel(isProjectSidebarOpen)
  }, [isProjectSidebarOpen, syncProjectSidebarPanel])

  const toggleProjectSidebar = useCallback((): void => {
    handleProjectSidebarOpenChange(!isProjectSidebarOpen)
  }, [handleProjectSidebarOpenChange, isProjectSidebarOpen])

  const toggleActionPane = useCallback((): void => {
    setActionPaneOpen((open) => !open)
  }, [])

  let projectSidebarPane: ReactNode
  if (isProjectSidebarOpen) {
    projectSidebarPane = (
      <ProjectChatSidebar
        shell={shell}
        project={project}
        session={session}
        areActiveProjectSessionsVisible={areActiveProjectSessionsVisible}
        onActiveProjectSessionsToggle={onActiveProjectSessionsToggle}
      />
    )
  } else {
    projectSidebarPane = (
      <CollapsedProjectSidebarRail onRestore={() => handleProjectSidebarOpenChange(true)} />
    )
  }

  return (
    <ActionPaneControlsContext.Provider value={actionPaneControls}>
      <SidebarProvider
        open={isProjectSidebarOpen}
        onOpenChange={handleProjectSidebarOpenChange}
        style={
          {
            '--sidebar-width': '100%'
          } as CSSProperties
        }
        className="flex h-dvh min-h-0 flex-col overflow-hidden"
      >
        <ChatShellTitlebar
          isProjectSidebarOpen={isProjectSidebarOpen}
          onToggleProjectSidebar={toggleProjectSidebar}
          hasActionPane={isActionPaneAvailable}
          isActionPaneOpen={isActionPaneOpen}
          onToggleActionPane={toggleActionPane}
        />
        <ResizablePanelGroup
          id="chat-home-layout"
          orientation="horizontal"
          className="min-h-0 min-w-0 flex-1"
        >
          <ResizablePanel
            id="project-sidebar-panel"
            panelRef={projectSidebarPanelRef}
            defaultSize="25%"
            minSize="16rem"
            collapsedSize="3rem"
            collapsible
            onResize={handleProjectSidebarResize}
          >
            {projectSidebarPane}
          </ResizablePanel>
          <ResizableHandle withHandle aria-label="Resize project sidebar" />
          <ResizablePanel id="active-pane-panel" defaultSize="75%" minSize="20rem">
            <main className="grid h-full min-h-0 min-w-0 grid-cols-1 overflow-hidden bg-background text-foreground">
              {activePane ?? <ActiveChatPanel project={project} session={session} />}
            </main>
          </ResizablePanel>
        </ResizablePanelGroup>
      </SidebarProvider>
    </ActionPaneControlsContext.Provider>
  )
}

function ChatShellTitlebar({
  isProjectSidebarOpen,
  onToggleProjectSidebar,
  hasActionPane,
  isActionPaneOpen,
  onToggleActionPane
}: {
  isProjectSidebarOpen: boolean
  onToggleProjectSidebar: () => void
  hasActionPane: boolean
  isActionPaneOpen: boolean
  onToggleActionPane: () => void
}): JSX.Element {
  const projectSidebarLabel = isProjectSidebarOpen
    ? 'Collapse project sidebar'
    : 'Restore project sidebar'
  const actionPaneLabel = isActionPaneOpen ? 'Collapse action pane' : 'Restore action pane'
  const platform = window.api.platform

  return (
    <div
      className="app-titlebar flex h-10 shrink-0 items-center gap-2 border-b bg-background/95 text-foreground"
      data-platform={platform}
      role="toolbar"
      aria-label="Pane controls"
    >
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="app-region-no-drag"
        aria-label={projectSidebarLabel}
        title={projectSidebarLabel}
        aria-pressed={!isProjectSidebarOpen}
        onClick={onToggleProjectSidebar}
      >
        <PaneToggleIcon side="left" open={isProjectSidebarOpen} />
      </Button>
      <div className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
        OpenKhodam
      </div>
      {hasActionPane ? (
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="app-region-no-drag"
          aria-label={actionPaneLabel}
          title={actionPaneLabel}
          aria-pressed={!isActionPaneOpen}
          onClick={onToggleActionPane}
        >
          <PaneToggleIcon side="right" open={isActionPaneOpen} />
        </Button>
      ) : (
        <div className="size-6" aria-hidden="true" />
      )}
    </div>
  )
}

function PaneToggleIcon({ side, open }: { side: 'left' | 'right'; open: boolean }): JSX.Element {
  const dividerX = side === 'left' ? 8 : 16
  const arrowPath =
    side === 'left'
      ? open
        ? 'm11 9-3 3 3 3'
        : 'm8 9 3 3-3 3'
      : open
        ? 'm13 9 3 3-3 3'
        : 'm16 9-3 3 3 3'

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="16" rx="1" />
      <path d={`M${dividerX} 4v16`} />
      <path d={arrowPath} />
    </svg>
  )
}

function useActionPaneControls(): ActionPaneControlsContextValue {
  const context = useContext(ActionPaneControlsContext)
  if (!context) throw new Error('ActiveChatPanel must be rendered within ChatHomePage.')

  return context
}

function ProjectChatSidebar({
  shell,
  project,
  session,
  areActiveProjectSessionsVisible,
  onActiveProjectSessionsToggle
}: {
  shell: OpenCodeChatShellState
  project?: OpenCodeProjectRouteState
  session?: OpenCodeSessionRouteState
  areActiveProjectSessionsVisible: boolean
  onActiveProjectSessionsToggle: () => void
}): JSX.Element {
  return (
    <Sidebar
      collapsible="none"
      className="relative min-h-0 border-r bg-sidebar/70"
      role="complementary"
      aria-label="Projects"
    >
      <SidebarHeader className="border-b p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Projects
          </h2>
          <OpenProjectDirectoryButton shell={shell} />
        </div>
        {shell.openProjectStatusMessage ? (
          <p role="status" className="sr-only">
            {shell.openProjectStatusMessage}
          </p>
        ) : null}
      </SidebarHeader>
      <SidebarContent className="p-4">
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <nav aria-label="Projects">
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
                    isRemoving={shell.removingProjectDirectory === chatProject.directory}
                    onRemoveProject={shell.removeOpenedProject}
                    areActiveProjectSessionsVisible={areActiveProjectSessionsVisible}
                    onActiveProjectSessionsToggle={onActiveProjectSessionsToggle}
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
            <div className="flex flex-wrap items-center gap-2 px-2 py-1">
              <SidebarHeartbeat status={shell.heartbeatStatus} />
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

function OpenProjectDirectoryButton({ shell }: { shell: OpenCodeChatShellState }): JSX.Element {
  const label = 'Open project folder'

  return (
    <Button
      type="button"
      size="icon-sm"
      variant="outline"
      aria-label={label}
      title={label}
      disabled={!shell.canSelectProjectDirectory}
      onClick={shell.selectProjectDirectory}
    >
      <FolderPlusIcon />
    </Button>
  )
}

function FolderPlusIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v4" />
      <path d="M16 19h6" />
      <path d="M19 16v6" />
    </svg>
  )
}

function SidebarHeartbeat({ status }: { status: OpenCodeHeartbeatStatus }): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild data-slot="sidebar-heartbeat" delay={0}>
        <div
          data-slot="sidebar-heartbeat"
          data-state={status.connected ? 'connected' : 'disconnected'}
          role="img"
          tabIndex={0}
          aria-label={status.ariaLabel}
          title={status.title}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full p-0 outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <span
            data-slot="sidebar-heartbeat-dot"
            aria-hidden="true"
            className={cn(
              'size-2 rounded-full',
              status.connected ? 'bg-emerald-500' : 'bg-destructive'
            )}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent role="tooltip" side="top" align="end" sideOffset={8}>
        {status.title}
      </TooltipContent>
    </Tooltip>
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

function ProjectButton({
  project,
  isActive,
  onActiveProjectSessionsToggle
}: {
  project: ChatProject
  isActive: boolean
  onActiveProjectSessionsToggle: () => void
}): JSX.Element {
  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>): void => {
      if (!isActive) return

      event.preventDefault()
      onActiveProjectSessionsToggle()
    },
    [isActive, onActiveProjectSessionsToggle]
  )

  return (
    <SidebarMenuButton
      asChild
      disabled={!project.id}
      isActive={isActive}
      size="lg"
      variant={isActive ? 'outline' : 'default'}
      className="h-auto px-3 py-2"
    >
      <Link
        to="/projects/$projectId"
        params={{ projectId: project.id }}
        search={{}}
        onClick={handleClick}
      >
        <span className="flex min-w-0 flex-1 flex-col items-stretch gap-1 text-left">
          <span className="truncate text-sm font-medium">{project.name}</span>
        </span>
      </Link>
    </SidebarMenuButton>
  )
}

function ProjectNewConversationLink({ project }: { project: ChatProject }): JSX.Element {
  const label = `Start new conversation in ${project.name}`

  return (
    <Button
      nativeButton={false}
      render={
        <Link
          to="/projects/$projectId"
          params={{ projectId: project.id }}
          search={{}}
          role="link"
          aria-label={label}
          title={label}
        />
      }
      size="icon"
      variant="ghost"
      className="size-10 shrink-0 text-base leading-none"
    >
      +
    </Button>
  )
}

function ProjectRemoveButton({
  project,
  isRemoving,
  onRemoveProject
}: {
  project: ChatProject
  isRemoving: boolean
  onRemoveProject: (project: ChatProject) => void
}): JSX.Element {
  const label = `Remove ${project.name} from Projects`

  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      event.preventDefault()
      event.stopPropagation()
      onRemoveProject(project)
    },
    [onRemoveProject, project]
  )

  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      className="size-10 shrink-0 text-base leading-none"
      disabled={isRemoving || !project.directory}
      aria-label={label}
      title={label}
      onClick={handleClick}
    >
      <span aria-hidden="true">×</span>
    </Button>
  )
}

function ProjectWithSessions({
  project,
  routeProject,
  session,
  isRemoving,
  onRemoveProject,
  areActiveProjectSessionsVisible,
  onActiveProjectSessionsToggle
}: {
  project: ChatProject
  routeProject?: OpenCodeProjectRouteState
  session?: OpenCodeSessionRouteState
  isRemoving: boolean
  onRemoveProject: (project: ChatProject) => void
  areActiveProjectSessionsVisible: boolean
  onActiveProjectSessionsToggle: () => void
}): JSX.Element {
  const isActive = project.id === routeProject?.selectedProject?.id
  return (
    <SidebarMenuItem>
      <div className="flex min-w-0 items-start gap-1">
        <div className="min-w-0 flex-1">
          <ProjectButton
            project={project}
            isActive={isActive}
            onActiveProjectSessionsToggle={onActiveProjectSessionsToggle}
          />
        </div>
        <ProjectNewConversationLink project={project} />
        <ProjectRemoveButton
          project={project}
          isRemoving={isRemoving}
          onRemoveProject={onRemoveProject}
        />
      </div>
      {isActive && areActiveProjectSessionsVisible ? (
        <SelectedProjectSessions project={routeProject} session={session} />
      ) : null}
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
              search={true}
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
  linkedGoogleArtifacts = emptyLinkedGoogleArtifacts,
  composer,
  composerErrorMessage
}: {
  project?: OpenCodeProjectRouteState
  session?: OpenCodeSessionRouteState
  linkedGoogleArtifacts?: LinkedGoogleArtifact[]
  composer?: ReactNode
  composerErrorMessage?: string | null
}): JSX.Element {
  const {
    isActionPaneOpen,
    setActionPaneOpen,
    setActionPaneAvailable,
    selectedActionPaneTab,
    selectActionPaneTab
  } = useActionPaneControls()
  const actionPanePanelRef = useRef<PanelImperativeHandle | null>(null)
  const messages = session?.messages ?? emptyChatMessages

  const syncActionPanePanel = useCallback((open: boolean): void => {
    const actionPanePanel = actionPanePanelRef.current
    if (!actionPanePanel) return

    if (open) {
      actionPanePanel.expand()
      return
    }

    actionPanePanel.collapse()
  }, [])

  const handleActionPaneOpenChange = useCallback(
    (open: boolean): void => {
      syncActionPanePanel(open)
      setActionPaneOpen(open)
    },
    [setActionPaneOpen, syncActionPanePanel]
  )

  const handleActionPaneResize = useCallback(
    (size: PanelSize): void => {
      const isCollapsed = actionPanePanelRef.current?.isCollapsed() ?? size.inPixels <= 64

      setActionPaneOpen(!isCollapsed)
    },
    [setActionPaneOpen]
  )

  useEffect(() => {
    syncActionPanePanel(isActionPaneOpen)
  }, [isActionPaneOpen, syncActionPanePanel])

  useEffect(() => {
    setActionPaneAvailable(true)
    return () => setActionPaneAvailable(false)
  }, [setActionPaneAvailable])

  const toggleArtifacts = useCallback((): void => {
    if (!isActionPaneOpen) {
      handleActionPaneOpenChange(true)
      selectActionPaneTab('artifacts')
      return
    }

    if (selectedActionPaneTab !== 'artifacts') {
      selectActionPaneTab('artifacts')
      return
    }

    handleActionPaneOpenChange(false)
  }, [handleActionPaneOpenChange, isActionPaneOpen, selectActionPaneTab, selectedActionPaneTab])

  return (
    <ResizablePanelGroup
      id="active-chat-layout"
      orientation="horizontal"
      className="min-h-0 min-w-0"
    >
      <ResizablePanel id="chat-center-panel" defaultSize="70%" minSize="20rem">
        <section
          className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
          aria-labelledby="active-chat-heading"
        >
          <header className="flex shrink-0 items-center gap-2 px-6 py-3">
            <h2
              id="active-chat-heading"
              className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight"
            >
              {session?.activeChat?.title ?? 'No chat selected'}
            </h2>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={isActionPaneOpen ? 'Collapse Artifacts' : 'Open Artifacts'}
                    aria-pressed={isActionPaneOpen}
                    onClick={toggleArtifacts}
                  />
                }
              >
                <PanelRightIcon aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent>
                {isActionPaneOpen ? 'Collapse Artifacts' : 'Open Artifacts'}
              </TooltipContent>
            </Tooltip>
          </header>
          <Separator />
          <ChatMessageList
            messages={messages}
            isAwaitingAssistantResponse={session?.isAwaitingAssistantResponse ?? false}
            retry={session?.retry ?? null}
            transcriptStatusMessage={
              session?.transcriptStatusMessage ?? project?.transcriptStatusMessage ?? null
            }
            isLoading={session?.isLoading ?? false}
            errorMessage={session?.errorMessage ?? composerErrorMessage ?? null}
            generationErrorMessage={session?.generationErrorMessage ?? null}
            successMessage={session?.successMessage ?? null}
          />
          {composer ??
            (session ? (
              <ChatPromptComposer
                promptText={session.promptText}
                setPromptText={session.setPromptText}
                sendPrompt={session.sendPrompt}
                stopGeneration={session.stopGeneration}
                canSendPrompt={session.canSendPrompt}
                canUndoPrompt={session.canUndoPrompt}
                canStopGeneration={session.canStopGeneration}
                isSending={session.isSending}
                isUndoingPrompt={session.isUndoingPrompt}
                isStoppingGeneration={session.isStoppingGeneration}
                undoLastPrompt={session.undoLastPrompt}
                modelOptions={session.modelOptions}
                agentOptions={session.agentOptions}
                effortOptions={session.effortOptions}
                selectedModelID={session.selectedModelID}
                setSelectedModelID={session.setSelectedModelID}
                selectedAgentID={session.selectedAgentID}
                setSelectedAgentID={session.setSelectedAgentID}
                selectedEffortID={session.selectedEffortID}
                setSelectedEffortID={session.setSelectedEffortID}
                isLoadingModels={session.isLoadingModels}
                isLoadingAgents={session.isLoadingAgents}
              />
            ) : null)}
        </section>
      </ResizablePanel>
      <ResizableHandle withHandle aria-label="Resize action pane" />
      <ResizablePanel
        id="action-pane-panel"
        panelRef={actionPanePanelRef}
        defaultSize="30%"
        minSize="16rem"
        collapsedSize="3rem"
        collapsible
        onResize={handleActionPaneResize}
      >
        {isActionPaneOpen ? (
          <ChatActionPane
            linkedGoogleArtifacts={linkedGoogleArtifacts}
            selectedTab={selectedActionPaneTab}
            onSelectedTabChange={selectActionPaneTab}
          />
        ) : (
          <CollapsedActionPaneRail onRestore={() => handleActionPaneOpenChange(true)} />
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

function CollapsedActionPaneRail({ onRestore }: { onRestore: () => void }): JSX.Element {
  return (
    <aside
      className="flex h-full w-full flex-col items-center border-l bg-sidebar/40 py-3 text-sidebar-foreground"
      role="complementary"
      aria-label="Collapsed action pane"
    >
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-auto min-h-28 w-8 px-1 py-2 [writing-mode:vertical-rl]"
        aria-label="Restore action pane"
        title="Restore action pane"
        onClick={onRestore}
      >
        Actions
      </Button>
    </aside>
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
      composer={
        startConversation ? (
          <ChatPromptComposer
            promptText={startConversation.promptText}
            setPromptText={startConversation.setPromptText}
            sendPrompt={() => startConversation.startConversation()}
            stopGeneration={noop}
            canSendPrompt={startConversation.canSendPrompt}
            canStopGeneration={false}
            isSending={startConversation.isSending}
            isStoppingGeneration={false}
            modelOptions={startConversation.modelOptions}
            agentOptions={startConversation.agentOptions}
            effortOptions={startConversation.effortOptions}
            selectedModelID={startConversation.selectedModelID}
            setSelectedModelID={startConversation.setSelectedModelID}
            selectedAgentID={startConversation.selectedAgentID}
            setSelectedAgentID={startConversation.setSelectedAgentID}
            selectedEffortID={startConversation.selectedEffortID}
            setSelectedEffortID={startConversation.setSelectedEffortID}
            isLoadingModels={startConversation.isLoadingModels}
            isLoadingAgents={startConversation.isLoadingAgents}
          />
        ) : null
      }
      composerErrorMessage={startConversation?.errorMessage ?? null}
    />
  )
}

export function SessionRouteActivePane({
  project,
  session,
  linkedGoogleArtifacts
}: {
  project?: OpenCodeProjectRouteState
  session: OpenCodeSessionRouteState
  linkedGoogleArtifacts: LinkedGoogleArtifact[]
}): JSX.Element {
  return (
    <ActiveChatPanel
      linkedGoogleArtifacts={linkedGoogleArtifacts}
      project={project}
      session={session}
    />
  )
}

function ChatMessageList({
  messages,
  isAwaitingAssistantResponse,
  retry,
  transcriptStatusMessage,
  isLoading,
  errorMessage,
  generationErrorMessage,
  successMessage
}: {
  messages: ChatMessage[]
  isAwaitingAssistantResponse: boolean
  retry: OpenCodeSessionRetry | null
  transcriptStatusMessage: string | null
  isLoading: boolean
  errorMessage: string | null
  generationErrorMessage: string | null
  successMessage: string | null
}): JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const lastInitialScrollKeyRef = useRef<string | null>(null)
  const statusCards = useMemo(
    () => [
      isLoading ? { key: 'loading', content: 'Loading OpenCode data…' } : null,
      errorMessage ? { key: 'error', content: errorMessage, tone: 'error' as const } : null,
      successMessage ? { key: 'success', content: successMessage } : null,
      transcriptStatusMessage ? { key: 'route-status', content: transcriptStatusMessage } : null
    ],
    [errorMessage, isLoading, successMessage, transcriptStatusMessage]
  )
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 132,
    getItemKey: (index) => messages[index]?.id ?? index,
    anchorTo: 'end',
    followOnAppend: true,
    scrollEndThreshold: 120,
    overscan: 6,
    measureElement: (element) => element.getBoundingClientRect().height
  })

  const initialScrollKey = messages.length > 0 ? messages[0]!.id : 'empty'

  useEffect(() => {
    if (lastInitialScrollKeyRef.current === initialScrollKey) return
    lastInitialScrollKeyRef.current = initialScrollKey
    if (messages.length > 0) virtualizer.scrollToEnd({ behavior: 'auto' })
  }, [initialScrollKey, messages.length, virtualizer])

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport ref={viewportRef}>
          <MessageScrollerContent aria-busy={isLoading} className="block min-h-full p-6">
            <div className="flex min-w-0 flex-col gap-4">
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
                  const previousMessage = messages[virtualRow.index - 1] ?? null
                  const showHeader = shouldShowMessageHeader(message, previousMessage)
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
                      <ChatMessageBubble message={message} showHeader={showHeader} />
                    </MessageScrollerItem>
                  )
                })}
              </div>
              {generationErrorMessage ? (
                <TranscriptGenerationError message={generationErrorMessage} />
              ) : null}
              {retry ? <AssistantRetryRow retry={retry} /> : null}
              {isAwaitingAssistantResponse ? <AssistantThinkingRow /> : null}
            </div>
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

function TranscriptGenerationError({ message }: { message: string }): JSX.Element {
  return <StatusCard tone="error">{message}</StatusCard>
}

function AssistantRetryRow({ retry }: { retry: OpenCodeSessionRetry }): JSX.Element {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    setNow(Date.now())
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [retry.next])

  const seconds = retry.next === null ? null : Math.max(0, Math.round((retry.next - now) / 1000))
  const attempt = retry.attempt === null ? 'Retrying' : `Retry attempt ${retry.attempt}`
  const countdown = seconds === null ? '' : ` · ${seconds}s`

  return (
    <div data-slot="assistant-retry-row" role="status" aria-live="polite" className="min-w-0">
      <StatusCard tone="error">{`${retry.message} — ${attempt}${countdown}`}</StatusCard>
    </div>
  )
}

function AssistantThinkingRow(): JSX.Element {
  return (
    <div data-slot="assistant-thinking-row" role="status" aria-live="polite" className="min-w-0">
      <Message align="start">
        <MessageContent className="items-start">
          <div
            data-slot="assistant-thinking-status"
            className="shimmer max-w-2xl min-w-0 text-sm text-muted-foreground"
          >
            Thinking…
          </div>
        </MessageContent>
      </Message>
    </div>
  )
}

function shouldShowMessageHeader(
  message: ChatMessage,
  previousMessage: ChatMessage | null
): boolean {
  if (message.author === 'user') return true
  if (!previousMessage || previousMessage.author !== 'assistant') return true
  if (message.parentID && previousMessage.parentID)
    return message.parentID !== previousMessage.parentID
  return false
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

function ChatMessageBubble({
  message,
  showHeader
}: {
  message: ChatMessage
  showHeader: boolean
}): JSX.Element {
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
          {showHeader ? (
            <MessageHeader className="px-0 capitalize">{message.author}</MessageHeader>
          ) : null}
          <div
            data-slot="message-surface"
            className={cn(
              'max-w-2xl min-w-0 text-sm',
              isUser
                ? 'border border-primary bg-primary px-4 py-3 text-primary-foreground shadow-sm'
                : 'text-foreground'
            )}
          >
            <ChatMessageParts author={message.author} parts={message.parts} />
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
  stopGeneration = noop,
  canSendPrompt,
  canUndoPrompt = false,
  canStopGeneration = false,
  isSending,
  isUndoingPrompt = false,
  isStoppingGeneration = false,
  undoLastPrompt = noop,
  modelOptions,
  agentOptions,
  effortOptions,
  selectedModelID,
  setSelectedModelID,
  selectedAgentID,
  setSelectedAgentID,
  selectedEffortID,
  setSelectedEffortID,
  isLoadingModels,
  isLoadingAgents
}: {
  promptText: string
  setPromptText: (value: string) => void
  sendPrompt: () => void
  stopGeneration?: () => void
  canSendPrompt: boolean
  canUndoPrompt?: boolean
  canStopGeneration?: boolean
  isSending: boolean
  isUndoingPrompt?: boolean
  isStoppingGeneration?: boolean
  undoLastPrompt?: () => void
  modelOptions: OpenCodeModelOption[]
  agentOptions: OpenCodeAgentOption[]
  effortOptions: OpenCodeModelEffortOption[]
  selectedModelID: string | null
  setSelectedModelID: (value: string | null) => void
  selectedAgentID: string | null
  setSelectedAgentID: (value: string | null) => void
  selectedEffortID: string | null
  setSelectedEffortID: (value: string | null) => void
  isLoadingModels: boolean
  isLoadingAgents: boolean
}): JSX.Element {
  const composerAnchorRef = useRef<HTMLDivElement | null>(null)
  const [activeSlashCommandValue, setActiveSlashCommandValue] = useState<string | null>(
    undoSlashCommand.value
  )
  const [isSlashCommandPopoverDismissed, setSlashCommandPopoverDismissed] = useState(false)
  const isExactUndoCommand = promptText.trim().toLowerCase() === undoSlashCommand.trigger
  const canRunUndoCommand = canUndoPrompt && !isUndoingPrompt
  const slashCommandQuery = getSlashCommandQuery(promptText)
  const filteredSlashCommands = useMemo(() => {
    if (slashCommandQuery === null || !canRunUndoCommand) return []
    return undoSlashCommand.value.startsWith(slashCommandQuery) ? [undoSlashCommand] : []
  }, [canRunUndoCommand, slashCommandQuery])
  const isSlashCommandPopoverOpen = slashCommandQuery !== null && !isSlashCommandPopoverDismissed
  const canSubmitPrompt = isExactUndoCommand ? canRunUndoCommand : canSendPrompt
  const isComposerBusy = isSending || isUndoingPrompt || isStoppingGeneration
  const isStopVisible = canStopGeneration || isStoppingGeneration

  useEffect(() => {
    if (!isSlashCommandPopoverOpen) return
    const firstCommand = filteredSlashCommands[0]
    if (!firstCommand) {
      setActiveSlashCommandValue(null)
      return
    }
    setActiveSlashCommandValue((current) =>
      filteredSlashCommands.some((command) => command.value === current)
        ? current
        : firstCommand.value
    )
  }, [filteredSlashCommands, isSlashCommandPopoverOpen])

  useEffect(() => {
    setSlashCommandPopoverDismissed(false)
  }, [promptText])

  const executeUndoCommand = (): void => {
    if (!canRunUndoCommand) return
    undoLastPrompt()
  }

  const submitPrompt = (): void => {
    if (isExactUndoCommand) {
      executeUndoCommand()
      return
    }
    if (!canSendPrompt) return
    sendPrompt()
  }

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing) return

    if (isSlashCommandPopoverOpen) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setSlashCommandPopoverDismissed(true)
        return
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveSlashCommandValue(filteredSlashCommands[0]?.value ?? null)
        return
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        if (filteredSlashCommands.length > 0) executeUndoCommand()
        else submitPrompt()
        return
      }
    }

    if (event.key !== 'Enter') return
    if (event.shiftKey) return

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
      <Popover
        modal={false}
        open={isSlashCommandPopoverOpen}
        onOpenChange={(open) => {
          if (!open) setSlashCommandPopoverDismissed(true)
        }}
      >
        <InputGroup
          ref={composerAnchorRef}
          className="h-auto min-w-0 bg-card shadow-sm has-disabled:bg-card has-disabled:opacity-100"
        >
          <InputGroupTextarea
            id="chat-prompt"
            className="min-h-24 text-sm"
            placeholder="Ask about this project..."
            value={promptText}
            onChange={(event) => setPromptText(event.currentTarget.value)}
            onKeyDown={handlePromptKeyDown}
            disabled={isComposerBusy}
            aria-controls={isSlashCommandPopoverOpen ? 'chat-slash-command-popover' : undefined}
            aria-expanded={isSlashCommandPopoverOpen}
            aria-haspopup="listbox"
          />
          <InputGroupAddon align="block-end" className="flex-wrap justify-between gap-2 border-t">
            <div
              className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
              onClick={(event) => event.stopPropagation()}
            >
              {agentOptions.length > 0 ? (
                <AgentPickerCombobox
                  options={agentOptions}
                  selectedAgentID={selectedAgentID}
                  setSelectedAgentID={setSelectedAgentID}
                  disabled={isComposerBusy || isLoadingAgents}
                />
              ) : null}
              {modelOptions.length > 0 ? (
                <ModelPickerCombobox
                  options={modelOptions}
                  selectedModelID={selectedModelID}
                  setSelectedModelID={setSelectedModelID}
                  disabled={isComposerBusy || isLoadingModels}
                />
              ) : !isLoadingModels ? (
                <Button
                  nativeButton={false}
                  render={<Link to="/settings" search={{ section: 'providers' }} role="link" />}
                  variant="outline"
                  disabled={isComposerBusy}
                >
                  Connect provider
                </Button>
              ) : null}
              {effortOptions.length > 0 ? (
                <EffortPickerCombobox
                  options={effortOptions}
                  selectedEffortID={selectedEffortID}
                  setSelectedEffortID={setSelectedEffortID}
                  disabled={isComposerBusy || isLoadingModels}
                />
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isStopVisible ? (
                <InputGroupButton
                  type="button"
                  size="icon-sm"
                  aria-label="Stop generation"
                  title="Stop generation"
                  disabled={!canStopGeneration || isStoppingGeneration}
                  onClick={stopGeneration}
                >
                  <SquareIcon aria-hidden="true" />
                </InputGroupButton>
              ) : null}
              <InputGroupButton type="submit" disabled={!canSubmitPrompt}>
                {isUndoingPrompt ? 'Undoing…' : isSending ? 'Sending…' : 'Send'}
              </InputGroupButton>
            </div>
          </InputGroupAddon>
        </InputGroup>
        <PopoverContent
          id="chat-slash-command-popover"
          initialFocus={false}
          role="dialog"
          aria-label="Slash commands"
          anchor={composerAnchorRef}
          side="top"
          align="start"
          sideOffset={8}
          className="w-[var(--anchor-width)] max-w-[calc(100vw-2rem)] min-w-0 gap-0 p-0"
          onMouseDown={(event) => event.preventDefault()}
        >
          <div className="flex max-h-72 flex-col overflow-y-auto py-1" role="presentation">
            {filteredSlashCommands.length > 0 ? (
              <div role="group" aria-label="Commands">
                <div className="px-2 py-1.5 text-xs text-muted-foreground">Commands</div>
                <div role="listbox" aria-label="Slash commands">
                  {filteredSlashCommands.map((command) => (
                    <button
                      key={command.value}
                      type="button"
                      role="option"
                      aria-label={`${command.trigger} ${command.title}`}
                      aria-selected={activeSlashCommandValue === command.value}
                      className={cn(
                        'flex min-h-10 w-full cursor-default items-start gap-2 px-2 py-2 text-left text-xs outline-hidden select-none hover:bg-muted focus-visible:bg-muted focus-visible:text-foreground',
                        activeSlashCommandValue === command.value
                          ? 'bg-muted text-foreground'
                          : null
                      )}
                      onClick={executeUndoCommand}
                      onPointerMove={() => setActiveSlashCommandValue(command.value)}
                    >
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="font-medium">{command.trigger}</span>
                          <span className="truncate">{command.title}</span>
                        </span>
                        <span className="truncate text-muted-foreground">
                          {command.description}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="px-2 py-6 text-center text-xs" role="status">
                No slash commands available.
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </form>
  )
}

function getSlashCommandQuery(promptText: string): string | null {
  if (!promptText.startsWith('/')) return null
  const query = promptText.slice(1).trimStart().toLowerCase()
  return query.includes(' ') ? '__unsupported__' : query
}

function AgentPickerCombobox({
  options,
  selectedAgentID,
  setSelectedAgentID,
  disabled
}: {
  options: OpenCodeAgentOption[]
  selectedAgentID: string | null
  setSelectedAgentID: (value: string | null) => void
  disabled: boolean
}): JSX.Element {
  const selected = options.find((option) => option.id === selectedAgentID) ?? null
  return (
    <div className="min-w-32 flex-1 sm:max-w-40 sm:flex-none">
      <label className="sr-only" htmlFor="opencode-agent-picker">
        OpenCode agent
      </label>
      <Combobox
        items={options}
        value={selected}
        onValueChange={(option) => setSelectedAgentID(option?.id ?? null)}
        itemToStringValue={(option) => option?.label ?? ''}
      >
        <ComboboxInput
          id="opencode-agent-picker"
          className="w-full bg-card"
          placeholder="Select agent"
          disabled={disabled}
          aria-label="OpenCode agent"
        />
        <ComboboxContent className="w-64">
          <ComboboxEmpty>No agents found.</ComboboxEmpty>
          <ComboboxList>
            {(option) => (
              <ComboboxItem key={option.id} value={option}>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="truncate font-medium">{option.label}</span>
                  {option.description ? (
                    <span className="truncate text-muted-foreground">{option.description}</span>
                  ) : null}
                </span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
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
    <div className="min-w-48 flex-[2] sm:max-w-72 sm:flex-none">
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

function EffortPickerCombobox({
  options,
  selectedEffortID,
  setSelectedEffortID,
  disabled
}: {
  options: OpenCodeModelEffortOption[]
  selectedEffortID: string | null
  setSelectedEffortID: (value: string | null) => void
  disabled: boolean
}): JSX.Element {
  const selected = options.find((option) => option.value === selectedEffortID) ?? null
  return (
    <div className="min-w-32 flex-1 sm:max-w-40 sm:flex-none">
      <label className="sr-only" htmlFor="opencode-effort-picker">
        OpenCode effort
      </label>
      <Combobox
        items={options}
        value={selected}
        onValueChange={(option) => setSelectedEffortID(option?.value ?? null)}
        itemToStringValue={(option) => option?.label ?? ''}
      >
        <ComboboxInput
          id="opencode-effort-picker"
          className="w-full bg-card"
          placeholder="Default effort"
          disabled={disabled}
          aria-label="OpenCode effort"
        />
        <ComboboxContent className="w-48">
          <ComboboxEmpty>No effort options found.</ComboboxEmpty>
          <ComboboxList>
            {(option) => (
              <ComboboxItem key={option.id} value={option}>
                <span className="truncate font-medium">{option.label}</span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  )
}
