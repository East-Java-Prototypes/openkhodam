import { createFileRoute } from '@tanstack/react-router'
import type { JSX } from 'react'

import { SessionRouteActivePane } from '../components/chat/ChatHomePage'
import { useOpenCodeProjectRoute, useOpenCodeSessionRoute } from '../hooks/useOpenCodeChatInterface'

export const Route = createFileRoute('/projects/$projectId/sessions/$sessionId')({ component: SessionRoute })

function SessionRoute(): JSX.Element {
  const { projectId, sessionId } = Route.useParams()
  const project = useOpenCodeProjectRoute(projectId)
  const session = useOpenCodeSessionRoute(project.selectedDirectory, sessionId, project.sessions)
  return <SessionRouteActivePane project={project} session={session} />
}
