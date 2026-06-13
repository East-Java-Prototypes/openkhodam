import { createFileRoute } from '@tanstack/react-router'
import type { JSX } from 'react'

import { ProjectRouteActivePane } from '../components/chat/ChatHomePage'
import { useOpenCodeProjectRouteContext } from '../hooks/useOpenCodeProjectRouteContext'

export const Route = createFileRoute('/projects/$projectId/')({ component: ProjectIndexRoute })

function ProjectIndexRoute(): JSX.Element {
  const project = useOpenCodeProjectRouteContext()
  return <ProjectRouteActivePane project={project} />
}
