export type ChatMessage = {
  id: string
  author: 'user' | 'assistant'
  parentID?: string
  content: string
  createdAt: string
  parts: ChatMessagePart[]
}

export type ChatMessagePart =
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'reasoning'; text: string }
  | {
      id: string
      type: 'tool'
      name: string
      status?: string
      input?: string
      output?: string
      error?: string
      title?: string
    }
  | { id: string; type: 'status'; title: string; text?: string }
  | { id: string; type: 'unknown'; label: string; text: string }

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
    createdAt: '10:38 AM',
    parts: [
      {
        id: 'message-1-text',
        type: 'text',
        text: 'Sketch a calm home screen for managing project chats.'
      }
    ]
  },
  {
    id: 'message-2',
    author: 'assistant',
    content:
      'Start with a grouped chat list on the left, then keep the active conversation roomy and focused on the right.',
    createdAt: '10:39 AM',
    parts: [
      {
        id: 'message-2-text',
        type: 'text',
        text: 'Start with a grouped chat list on the left, then keep the active conversation roomy and focused on the right.'
      }
    ]
  },
  {
    id: 'message-3',
    author: 'user',
    content: 'Keep it static for now so the data source can be replaced later.',
    createdAt: '10:41 AM',
    parts: [
      {
        id: 'message-3-text',
        type: 'text',
        text: 'Keep it static for now so the data source can be replaced later.'
      }
    ]
  }
]

export function useChatInterfaceData(): ChatInterfaceData {
  return { projects, sessions, activeChat, messages }
}
