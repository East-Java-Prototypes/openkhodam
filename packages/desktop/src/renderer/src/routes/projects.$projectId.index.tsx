import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { JSX } from 'react'

import { ProjectRouteActivePane } from '../components/chat/ChatHomePage'
import { useOpenCodeStartConversation } from '../hooks/useOpenCodeChatInterface'
import { useOpenCodeProjectRouteContext } from '../hooks/useOpenCodeProjectRouteContext'

export const Route = createFileRoute('/projects/$projectId/')({ component: ProjectIndexRoute })

function ProjectIndexRoute(): JSX.Element {
  const { projectId } = Route.useParams()
  const navigate = useNavigate()
  const project = useOpenCodeProjectRouteContext()
  const startConversation = useOpenCodeStartConversation(project.selectedDirectory)
  return (
    <ProjectRouteActivePane
      project={project}
      startConversation={{
        ...startConversation,
        startConversation: () =>
          startConversation.startConversation((sessionID, admittedPrompt) => {
            sessionStorage.setItem(
              `opencode-admitted-prompt:${sessionID}`,
              JSON.stringify(admittedPrompt)
            )
            void navigate({
              to: '/projects/$projectId/sessions/$sessionId',
              params: { projectId, sessionId: sessionID },
              search: true
            })
          })
      }}
    />
  )
}
