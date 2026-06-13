export type ChatMessage = {
  id: string
  author: 'user' | 'assistant'
  content: string
  createdAt: string
}

export type ProjectChat = {
  id: string
  kind: 'session'
  title: string
  summary: string
  updatedAt: string
  disabled?: boolean
}

export type ChatProject = {
  id: string
  name: string
  subtitle?: string
}

export type ChatInterfaceData = {
  projects: ChatProject[]
  sessions: ProjectChat[]
  activeChat: ProjectChat | null
  messages: ChatMessage[]
}

const projects: ChatProject[] = [
  {
    id: 'project-desktop',
    name: 'Desktop app',
    subtitle: '/tmp/desktop-app'
  },
  {
    id: 'project-research',
    name: 'Research notes',
    subtitle: '/tmp/research-notes'
  }
]

const sessions: ProjectChat[] = [
  {
    id: 'chat-shell-design',
    kind: 'session',
    title: 'Shell design pass',
    summary: 'Map the first pass for the desktop chat experience.',
    updatedAt: '10:42 AM'
  },
  {
    id: 'chat-settings-health',
    kind: 'session',
    title: 'Settings health view',
    summary: 'Review connection states and renderer health copy.',
    updatedAt: 'Yesterday'
  }
]

const activeChat = sessions[0]

const messages: ChatMessage[] = [
  {
    id: 'message-1',
    author: 'user',
    content: 'Sketch a calm home screen for managing project chats.',
    createdAt: '10:38 AM'
  },
  {
    id: 'message-2',
    author: 'assistant',
    content:
      'Start with a grouped chat list on the left, then keep the active conversation roomy and focused on the right.',
    createdAt: '10:39 AM'
  },
  {
    id: 'message-3',
    author: 'user',
    content: 'Keep it static for now so the data source can be replaced later.',
    createdAt: '10:41 AM'
  }
]

export function useChatInterfaceData(): ChatInterfaceData {
  return { projects, sessions, activeChat, messages }
}
