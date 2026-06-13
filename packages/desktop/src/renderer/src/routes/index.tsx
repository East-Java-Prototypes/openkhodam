import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { JSX } from 'react'
import { useCallback } from 'react'

import { ChatHomePage } from '../components/chat/ChatHomePage'
import { useOpenCodeChatShell } from '../hooks/useOpenCodeChatInterface'

export const Route = createFileRoute('/')({ component: IndexRoute })

function IndexRoute(): JSX.Element {
  const navigate = useNavigate()
  const navigateToOpenedProject = useCallback((project: { id: string }) => { void navigate({ to: '/projects/$projectId', params: { projectId: project.id } }) }, [navigate])
  const shell = useOpenCodeChatShell(navigateToOpenedProject)
  return <ChatHomePage shell={shell} />
}
