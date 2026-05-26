export type ChatMessage = {
  id: string
  author: 'user' | 'assistant'
  content: string
  createdAt: string
}

export type ProjectChat = {
  id: string
  title: string
  summary: string
  updatedAt: string
}

export type ChatProject = {
  id: string
  name: string
  chats: ProjectChat[]
}

export type ChatInterfaceData = {
  projects: ChatProject[]
  activeChat: ProjectChat
  messages: ChatMessage[]
}

const projects: ChatProject[] = [
  {
    id: 'project-desktop',
    name: 'Desktop app',
    chats: [
      {
        id: 'chat-shell-design',
        title: 'Shell design pass',
        summary: 'Map the first pass for the desktop chat experience.',
        updatedAt: '10:42 AM'
      },
      {
        id: 'chat-settings-health',
        title: 'Settings health view',
        summary: 'Review connection states and renderer health copy.',
        updatedAt: 'Yesterday'
      }
    ]
  },
  {
    id: 'project-research',
    name: 'Research notes',
    chats: [
      {
        id: 'chat-agent-flows',
        title: 'Agent workflow ideas',
        summary: 'Collect rough notes for handoff and review loops.',
        updatedAt: 'Mon'
      }
    ]
  }
]

const activeChat = projects[0].chats[0]

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
  return { projects, activeChat, messages }
}
