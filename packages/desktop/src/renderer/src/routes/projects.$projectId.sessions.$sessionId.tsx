import { createFileRoute } from '@tanstack/react-router'
import type { JSX } from 'react'

import { SessionRouteActivePane } from '../components/chat/ChatHomePage'
import { useOpenCodeSessionRoute } from '../hooks/useOpenCodeChatInterface'
import { useOpenCodeProjectRouteContext } from '../hooks/useOpenCodeProjectRouteContext'

export const Route = createFileRoute('/projects/$projectId/sessions/$sessionId')({
  component: SessionRoute
})

function SessionRoute(): JSX.Element {
  const { sessionId } = Route.useParams()
  const project = useOpenCodeProjectRouteContext()
  const session = useOpenCodeSessionRoute(project.selectedDirectory, sessionId, project.sessions)
  return <SessionRouteActivePane project={project} session={session} />
}
