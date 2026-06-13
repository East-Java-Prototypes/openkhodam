import { createFileRoute } from '@tanstack/react-router'
import type { JSX } from 'react'

import { ProjectRouteActivePane } from '../components/chat/ChatHomePage'
import { useOpenCodeProjectRoute } from '../hooks/useOpenCodeChatInterface'

export const Route = createFileRoute('/projects/$projectId/')({ component: ProjectIndexRoute })

function ProjectIndexRoute(): JSX.Element {
  const { projectId } = Route.useParams()
  const project = useOpenCodeProjectRoute(projectId)
  return <ProjectRouteActivePane project={project} />
}
