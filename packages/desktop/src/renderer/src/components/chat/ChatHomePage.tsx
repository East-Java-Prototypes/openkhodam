import type { JSX } from 'react'

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
    <aside className="border-border bg-sidebar/70 border-r p-4" aria-labelledby="projects-heading">
      <div className="mb-6">
        <p className="text-muted-foreground text-sm font-medium">OpenKhodam</p>
        <h1 id="projects-heading" className="text-2xl font-semibold tracking-tight">
          Project chats
        </h1>
      </div>

      <nav className="space-y-6" aria-label="Project chats">
        {projects.map((project) => (
          <ProjectChatSection key={project.id} project={project} activeChat={activeChat} />
        ))}
      </nav>
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
      <ul className="mt-2 space-y-1">
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
      <a
        className={`block rounded-lg border px-3 py-2 transition-colors ${
          isActive
            ? 'border-border bg-card text-card-foreground shadow-sm'
            : 'border-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
        }`}
        href={`#${chat.id}`}
        aria-current={isActive ? 'page' : undefined}
      >
        <span className="flex items-center justify-between gap-3">
          <span className="truncate text-sm font-medium">{chat.title}</span>
          <span className="text-muted-foreground shrink-0 text-xs">{chat.updatedAt}</span>
        </span>
        <span className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-5">{chat.summary}</span>
      </a>
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
      <header className="border-border flex items-center justify-between gap-4 border-b px-6 py-4">
        <div>
          <p className="text-muted-foreground text-sm">Active chat</p>
          <h2 id="active-chat-heading" className="text-xl font-semibold tracking-tight">
            {activeChat.title}
          </h2>
        </div>
        <div className="border-border bg-secondary text-secondary-foreground rounded-full border px-3 py-1 text-sm">
          Mock data
        </div>
      </header>

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
    <div className="flex-1 space-y-4 overflow-y-auto p-6">
      {messages.map((message) => (
        <ChatMessageBubble key={message.id} message={message} />
      ))}
    </div>
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
        className={`max-w-2xl rounded-2xl border px-4 py-3 shadow-sm ${
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
    <form className="border-border bg-background border-t p-4" aria-label="Chat prompt">
      <label className="sr-only" htmlFor="chat-prompt">
        Message OpenKhodam
      </label>
      <div className="border-input bg-card flex items-center gap-3 rounded-2xl border px-4 py-3 shadow-sm">
        <input
          id="chat-prompt"
          className="placeholder:text-muted-foreground flex-1 bg-transparent text-sm outline-none"
          placeholder="Ask about this project..."
          disabled
        />
        <button
          className="bg-primary text-primary-foreground rounded-full px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          disabled
        >
          Send
        </button>
      </div>
      <p className="text-muted-foreground mt-2 text-xs">Static preview only. Real chat behavior is not wired yet.</p>
    </form>
  )
}
