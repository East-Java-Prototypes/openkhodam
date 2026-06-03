import type { JSX } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'

import { useOpenCodeChatInterface } from '../../hooks/useOpenCodeChatInterface'
import type { ChatMessage, ChatProject, ProjectChat } from '../../hooks/useChatInterfaceData'

export function ChatHomePage(): JSX.Element {
  const chat = useOpenCodeChatInterface()

  return (
    <main className="grid min-h-[calc(100vh-3.5rem)] grid-cols-1 bg-background text-foreground md:grid-cols-[20rem_1fr]">
      <ProjectChatSidebar chat={chat} />
      <ActiveChatPanel chat={chat} />
    </main>
  )
}

type ProjectChatSidebarProps = {
  chat: ReturnType<typeof useOpenCodeChatInterface>
}

function ProjectChatSidebar({ chat }: ProjectChatSidebarProps): JSX.Element {
  return (
    <aside className="relative bg-sidebar/70 p-4" aria-labelledby="projects-heading">
      <ScrollArea className="h-full pr-2">
        <div className="mb-6">
          <p className="text-muted-foreground text-sm font-medium">OpenKhodam</p>
          <h1 id="projects-heading" className="text-2xl font-semibold tracking-tight">
            Project chats
          </h1>
          <div className="mt-3 flex flex-wrap gap-2"><Badge variant="secondary">{chat.statusLabel}</Badge><Badge variant="outline">{chat.eventLabel}</Badge></div>
        </div>

        <OpenProjectByDirectoryForm chat={chat} />

        <nav className="flex flex-col gap-6" aria-label="Project chats">
          {chat.projects.map((project) => (
            <ProjectChatSection key={project.id} project={project} activeChat={chat.activeChat} onSelectProject={chat.selectProject} onSelectSession={chat.selectSession} />
          ))}
        </nav>
      </ScrollArea>
      <Separator orientation="vertical" className="absolute right-0 top-0 hidden h-full md:block" />
    </aside>
  )
}

function OpenProjectByDirectoryForm({ chat }: { chat: ReturnType<typeof useOpenCodeChatInterface> }): JSX.Element {
  return (
    <form className="mb-6 rounded-none border bg-card p-3" aria-label="Open project by directory" onSubmit={(event) => { event.preventDefault(); if (chat.canOpenProject) chat.openProjectByDirectory() }}>
      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="project-directory">
        Project directory
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id="project-directory"
          className="min-w-0 flex-1 rounded-none border bg-background px-2 py-1 text-sm"
          value={chat.projectDirectoryText}
          onChange={(event) => chat.setProjectDirectoryText(event.currentTarget.value)}
          placeholder="/path/to/project"
        />
        <Button type="submit" size="sm" disabled={!chat.canOpenProject}>Open</Button>
      </div>
      {chat.openProjectStatusMessage ? <p className="mt-2 text-xs text-muted-foreground">{chat.openProjectStatusMessage}</p> : null}
      {chat.openedProject ? <OpenedProjectDetails project={chat.openedProject} /> : null}
    </form>
  )
}

function OpenedProjectDetails({ project }: { project: ReturnType<typeof useOpenCodeChatInterface>['openedProject'] }): JSX.Element | null {
  if (!project) return null

  return (
    <section className="mt-2 text-xs text-muted-foreground" aria-labelledby="opened-project-heading">
      <h2 id="opened-project-heading" className="font-semibold text-foreground">Opened project details</h2>
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

type ProjectChatSectionProps = {
  project: ChatProject
  activeChat: ProjectChat | null
  onSelectProject: (directory: string) => void
  onSelectSession: (sessionID: string | null) => void
}

function ProjectChatSection({ project, activeChat, onSelectProject, onSelectSession }: ProjectChatSectionProps): JSX.Element {
  return (
    <section aria-labelledby={`${project.id}-heading`}>
      <h2
        id={`${project.id}-heading`}
        className="text-muted-foreground px-2 text-xs font-semibold uppercase tracking-wide"
      >
        {project.name}
      </h2>
      <ul className="mt-2 flex flex-col gap-1">
        {project.chats.map((chat) => (
          <ProjectChatListItem key={chat.id} chat={chat} isActive={chat.kind === 'session' && chat.id === activeChat?.id} onSelect={() => { if (!project.subtitle) return; onSelectProject(project.subtitle); if (chat.kind === 'session') onSelectSession(chat.id) }} />
        ))}
      </ul>
    </section>
  )
}

type ProjectChatListItemProps = {
  chat: ProjectChat
  isActive: boolean
  onSelect: () => void
}

function ProjectChatListItem({ chat, isActive, onSelect }: ProjectChatListItemProps): JSX.Element {
  return (
    <li>
      <Button type="button" disabled={chat.disabled} onClick={onSelect} variant={isActive ? 'outline' : 'ghost'} className="h-auto w-full justify-start px-3 py-2">
          <span className="flex min-w-0 flex-1 flex-col items-stretch gap-1 text-left">
            <span className="flex items-center justify-between gap-3">
              <span className="truncate text-sm font-medium">{chat.title}</span>
              <span className="text-muted-foreground shrink-0 text-xs">{chat.updatedAt}</span>
            </span>
            <span className="text-muted-foreground line-clamp-2 text-xs leading-5 whitespace-normal">{chat.summary}</span>
          </span>
      </Button>
    </li>
  )
}

function ActiveChatPanel({ chat }: { chat: ReturnType<typeof useOpenCodeChatInterface> }): JSX.Element {
  return (
    <section className="flex min-h-0 flex-col" aria-labelledby="active-chat-heading">
      <header className="flex items-center justify-between gap-4 px-6 py-4">
        <div>
          <p className="text-muted-foreground text-sm">Active chat</p>
          <h2 id="active-chat-heading" className="text-xl font-semibold tracking-tight">
            {chat.activeChat?.title ?? 'No chat selected'}
          </h2>
          {chat.statusMessage ? <p className="text-muted-foreground text-sm">{chat.statusMessage}</p> : null}
        </div>
        <Badge variant="secondary">OpenCode</Badge>
      </header>
      <Separator />

      <ChatMessageList messages={chat.messages} emptyMessage={chat.emptyMessage} isLoading={chat.isLoading} errorMessage={chat.errorMessage} successMessage={chat.successMessage} />
      <ChatPromptComposer promptText={chat.promptText} setPromptText={chat.setPromptText} sendPrompt={chat.sendPrompt} canSendPrompt={chat.canSendPrompt} isSending={chat.isSending} />
    </section>
  )
}

type ChatMessageListProps = {
  messages: ChatMessage[]
  emptyMessage: string | null
  isLoading: boolean
  errorMessage: string | null
  successMessage: string | null
}

function ChatMessageList({ messages, emptyMessage, isLoading, errorMessage, successMessage }: ChatMessageListProps): JSX.Element {
  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col gap-4 p-6">
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

function StatusCard({ children, tone = 'default' }: { children: string; tone?: 'default' | 'error' }): JSX.Element {
  return <div className={`rounded-none border px-4 py-3 text-sm ${tone === 'error' ? 'border-destructive text-destructive' : 'border-border bg-card text-muted-foreground'}`}>{children}</div>
}

type ChatMessageBubbleProps = {
  message: ChatMessage
}

function ChatMessageBubble({ message }: ChatMessageBubbleProps): JSX.Element {
  const isUser = message.author === 'user'

  return (
    <article
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
      aria-label={`${message.author} message at ${message.createdAt}`}
    >
      <div
        className={`max-w-2xl border px-4 py-3 shadow-sm ${
          isUser ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-card-foreground'
        }`}
      >
        <div className="mb-2 flex items-center justify-between gap-4 text-xs opacity-80">
          <span className="font-medium capitalize">{message.author}</span>
          <time>{message.createdAt}</time>
        </div>
        <p className="leading-7">{message.content}</p>
      </div>
    </article>
  )
}

function ChatPromptComposer({ promptText, setPromptText, sendPrompt, canSendPrompt, isSending }: { promptText: string; setPromptText: (value: string) => void; sendPrompt: () => void; canSendPrompt: boolean; isSending: boolean }): JSX.Element {
  return (
    <form className="bg-background p-4" aria-label="Chat prompt" onSubmit={(event) => { event.preventDefault(); if (canSendPrompt) sendPrompt() }}>
      <Separator className="mb-4" />
      <label className="sr-only" htmlFor="chat-prompt">
        Message OpenKhodam
      </label>
      <InputGroup className="h-auto bg-card shadow-sm has-disabled:bg-card has-disabled:opacity-100">
        <InputGroupTextarea
          id="chat-prompt"
          className="min-h-11 text-sm"
          placeholder="Ask about this project..."
          value={promptText}
          onChange={(event) => setPromptText(event.currentTarget.value)}
          disabled={isSending}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton type="submit" disabled={!canSendPrompt}>{isSending ? 'Sending…' : 'Send'}</InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <p className="text-muted-foreground mt-2 text-xs">Send to the selected session, or start a new session when none is selected.</p>
    </form>
  )
}
