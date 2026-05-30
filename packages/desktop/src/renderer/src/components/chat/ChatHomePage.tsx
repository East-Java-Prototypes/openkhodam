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

import type { ChatMessage, ChatProject, ProjectChat } from '../../hooks/useChatInterfaceData'
import { useChatInterfaceData } from '../../hooks/useChatInterfaceData'

export function ChatHomePage(): JSX.Element {
  const { projects, activeChat, messages } = useChatInterfaceData()

  return (
    <main className="grid min-h-[calc(100vh-3.5rem)] grid-cols-1 bg-background text-foreground md:grid-cols-[20rem_1fr]">
      <ProjectChatSidebar projects={projects} activeChat={activeChat} />
      <ActiveChatPanel activeChat={activeChat} messages={messages} />
    </main>
  )
}

type ProjectChatSidebarProps = {
  projects: ChatProject[]
  activeChat: ProjectChat
}

function ProjectChatSidebar({ projects, activeChat }: ProjectChatSidebarProps): JSX.Element {
  return (
    <aside className="relative bg-sidebar/70 p-4" aria-labelledby="projects-heading">
      <ScrollArea className="h-full pr-2">
        <div className="mb-6">
          <p className="text-muted-foreground text-sm font-medium">OpenKhodam</p>
          <h1 id="projects-heading" className="text-2xl font-semibold tracking-tight">
            Project chats
          </h1>
        </div>

        <nav className="flex flex-col gap-6" aria-label="Project chats">
          {projects.map((project) => (
            <ProjectChatSection key={project.id} project={project} activeChat={activeChat} />
          ))}
        </nav>
      </ScrollArea>
      <Separator orientation="vertical" className="absolute right-0 top-0 hidden h-full md:block" />
    </aside>
  )
}

type ProjectChatSectionProps = {
  project: ChatProject
  activeChat: ProjectChat
}

function ProjectChatSection({ project, activeChat }: ProjectChatSectionProps): JSX.Element {
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
          <ProjectChatListItem key={chat.id} chat={chat} isActive={chat.id === activeChat.id} />
        ))}
      </ul>
    </section>
  )
}

type ProjectChatListItemProps = {
  chat: ProjectChat
  isActive: boolean
}

function ProjectChatListItem({ chat, isActive }: ProjectChatListItemProps): JSX.Element {
  return (
    <li>
      <Button asChild variant={isActive ? 'outline' : 'ghost'} className="h-auto w-full justify-start px-3 py-2">
        <a href={`#${chat.id}`} aria-current={isActive ? 'page' : undefined}>
          <span className="flex min-w-0 flex-1 flex-col items-stretch gap-1 text-left">
            <span className="flex items-center justify-between gap-3">
              <span className="truncate text-sm font-medium">{chat.title}</span>
              <span className="text-muted-foreground shrink-0 text-xs">{chat.updatedAt}</span>
            </span>
            <span className="text-muted-foreground line-clamp-2 text-xs leading-5 whitespace-normal">{chat.summary}</span>
          </span>
        </a>
      </Button>
    </li>
  )
}

type ActiveChatPanelProps = {
  activeChat: ProjectChat
  messages: ChatMessage[]
}

function ActiveChatPanel({ activeChat, messages }: ActiveChatPanelProps): JSX.Element {
  return (
    <section className="flex min-h-0 flex-col" aria-labelledby="active-chat-heading">
      <header className="flex items-center justify-between gap-4 px-6 py-4">
        <div>
          <p className="text-muted-foreground text-sm">Active chat</p>
          <h2 id="active-chat-heading" className="text-xl font-semibold tracking-tight">
            {activeChat.title}
          </h2>
        </div>
        <Badge variant="secondary">Mock data</Badge>
      </header>
      <Separator />

      <ChatMessageList messages={messages} />
      <ChatPromptComposer />
    </section>
  )
}

type ChatMessageListProps = {
  messages: ChatMessage[]
}

function ChatMessageList({ messages }: ChatMessageListProps): JSX.Element {
  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col gap-4 p-6">
        {messages.map((message) => (
          <ChatMessageBubble key={message.id} message={message} />
        ))}
      </div>
    </ScrollArea>
  )
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

function ChatPromptComposer(): JSX.Element {
  return (
    <form className="bg-background p-4" aria-label="Chat prompt">
      <Separator className="mb-4" />
      <label className="sr-only" htmlFor="chat-prompt">
        Message OpenKhodam
      </label>
      <InputGroup className="h-auto bg-card shadow-sm has-disabled:bg-card has-disabled:opacity-100">
        <InputGroupTextarea
          id="chat-prompt"
          className="min-h-11 text-sm"
          placeholder="Ask about this project..."
          disabled
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton disabled>Send</InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <p className="text-muted-foreground mt-2 text-xs">Static preview only. Real chat behavior is not wired yet.</p>
    </form>
  )
}
