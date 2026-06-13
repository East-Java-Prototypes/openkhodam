import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router'
import type { JSX } from 'react'
import { useCallback } from 'react'

import { ChatHomePage } from '../components/chat/ChatHomePage'
import { useOpenCodeChatShell, useOpenCodeProjectRoute } from '../hooks/useOpenCodeChatInterface'

export const Route = createFileRoute('/projects/$projectId')({ component: ProjectRoute })

function ProjectRoute(): JSX.Element {
  const { projectId } = Route.useParams()
  const navigate = useNavigate()
  const navigateToOpenedProject = useCallback((project: { id: string }) => { void navigate({ to: '/projects/$projectId', params: { projectId: project.id } }) }, [navigate])
  const shell = useOpenCodeChatShell(navigateToOpenedProject)
  const project = useOpenCodeProjectRoute(projectId)
  return <ChatHomePage shell={shell} project={project} activePane={<Outlet />} />
}
