import { Link } from '@tanstack/react-router'
import type { CSSProperties, JSX, ReactNode } from 'react'

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
import { ScrollArea } from '@/components/ui/scroll-area'
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

import type { ChatMessage, ChatProject, ProjectChat } from '../../hooks/useChatInterfaceData'
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

export function ChatHomePage({
  shell,
  project,
  session,
  activePane
}: ChatHomePageProps): JSX.Element {
  return (
    <SidebarProvider
      style={
        {
          '--sidebar-width': '20rem'
        } as CSSProperties
      }
      className="h-dvh min-h-0 overflow-hidden"
    >
      <ProjectChatSidebar shell={shell} selectedDirectory={project?.selectedDirectory ?? null} />
      <main className="grid h-dvh min-h-0 min-w-0 flex-1 grid-cols-1 overflow-hidden bg-background text-foreground md:grid-cols-[18rem_minmax(0,1fr)]">
        <SessionChatSidebar project={project} session={session} />
        {activePane ?? <ActiveChatPanel project={project} session={session} />}
      </main>
    </SidebarProvider>
  )
}

function ProjectChatSidebar({
  shell,
  selectedDirectory
}: {
  shell: OpenCodeChatShellState
  selectedDirectory: string | null
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
            <div className="px-2 py-1">
              <p className="text-muted-foreground text-sm font-medium">OpenKhodam</p>
              <h1 id="projects-heading" className="text-2xl font-semibold tracking-tight">
                Project folders
              </h1>
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
                {shell.projects.map((project) => (
                  <ProjectButton
                    key={project.id}
                    project={project}
                    isActive={project.subtitle === selectedDirectory}
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
              <Button asChild size="xs" variant="outline">
                <Link to="/">Home</Link>
              </Button>
              <Button asChild size="xs" variant="outline">
                <Link to="/settings">Settings</Link>
              </Button>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function SessionChatSidebar({
  project,
  session
}: {
  project?: OpenCodeProjectRouteState
  session?: OpenCodeSessionRouteState
}): JSX.Element {
  return (
    <aside
      className="relative min-h-0 overflow-hidden bg-sidebar/40 p-4"
      aria-labelledby="sessions-heading"
    >
      <ScrollArea className="h-full pr-2">
        <div className="mb-4">
          <p className="text-muted-foreground text-sm">Selected project</p>
          <h2 id="sessions-heading" className="text-lg font-semibold tracking-tight">
            Project sessions
          </h2>
        </div>
        <nav className="flex flex-col gap-2" aria-label="Project sessions">
          {!project ? <StatusCard>Select a project to view sessions.</StatusCard> : null}
          {project?.isLoading ? <StatusCard>Loading OpenCode data…</StatusCard> : null}
          {project?.errorMessage ? (
            <StatusCard tone="error">{project.errorMessage}</StatusCard>
          ) : null}
          {project?.emptyMessage ? <StatusCard>{project.emptyMessage}</StatusCard> : null}
          {project?.sessions.map((chat) => (
            <ProjectChatListItem
              key={chat.id}
              chat={chat}
              projectId={project.selectedProject?.id}
              isActive={chat.id === session?.activeChat?.id}
            />
          ))}
        </nav>
      </ScrollArea>
      <Separator orientation="vertical" className="absolute right-0 top-0 hidden h-full md:block" />
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
    <SidebarMenuItem>
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
    </SidebarMenuItem>
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
      <Button
        asChild={Boolean(projectId)}
        type="button"
        disabled={chat.disabled || !projectId}
        variant={isActive ? 'outline' : 'ghost'}
        className="h-auto w-full justify-start px-3 py-2"
      >
        {projectId ? (
          <Link
            to="/projects/$projectId/sessions/$sessionId"
            params={{ projectId, sessionId: chat.id }}
          >
            {content}
          </Link>
        ) : (
          content
        )}
      </Button>
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
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex min-w-0 flex-col gap-4 p-6">
        {isLoading ? <StatusCard>Loading OpenCode data…</StatusCard> : null}
        {errorMessage ? <StatusCard tone="error">{errorMessage}</StatusCard> : null}
        {successMessage ? <StatusCard>{successMessage}</StatusCard> : null}
        {emptyMessage ? <StatusCard>{emptyMessage}</StatusCard> : null}
        {messages.map((message) => (
          <ChatMessageBubble key={message.id} message={message} />
        ))}
      </div>
    </ScrollArea>
  )
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
  return (
    <article
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
      aria-label={`${message.author} message at ${message.createdAt}`}
    >
      <div
        data-pending={message.createdAt === 'Pending' ? 'true' : undefined}
        className={`max-w-2xl min-w-0 border px-4 py-3 shadow-sm ${isUser ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-card-foreground'}`}
      >
        <div className="mb-2 flex items-center justify-between gap-4 text-xs opacity-80">
          <span className="font-medium capitalize">{message.author}</span>
          <time>{message.createdAt}</time>
        </div>
        <p className="whitespace-pre-wrap break-words leading-7">{message.content}</p>
      </div>
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
  return (
    <form
      className="shrink-0 bg-background p-4"
      aria-label="Chat prompt"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSendPrompt) sendPrompt()
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
            disabled={isSending}
          />
          <InputGroupAddon align="inline-end">
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
