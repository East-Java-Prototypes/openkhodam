import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router'
import type { JSX } from 'react'
import { useCallback } from 'react'

import { ChatHomePage } from '../components/chat/ChatHomePage'
import { useOpenCodeChatShell, useOpenCodeProjectRoute } from '../hooks/useOpenCodeChatInterface'
import { OpenCodeProjectRouteProvider } from '../hooks/useOpenCodeProjectRouteContext'

export const Route = createFileRoute('/projects/$projectId')({ component: ProjectRoute })

export type ProjectRouteContext = ReturnType<typeof useOpenCodeProjectRoute>

function ProjectRoute(): JSX.Element {
  const { projectId } = Route.useParams()
  const navigate = useNavigate()
  const navigateToOpenedProject = useCallback((project: { id: string }) => { void navigate({ to: '/projects/$projectId', params: { projectId: project.id } }) }, [navigate])
  const shell = useOpenCodeChatShell(navigateToOpenedProject)
  const project = useOpenCodeProjectRoute(projectId)
  return <OpenCodeProjectRouteProvider project={project}><ChatHomePage shell={shell} project={project} activePane={<Outlet />} /></OpenCodeProjectRouteProvider>
}
