import {
  createFileRoute,
  Outlet,
  useNavigate,
  useRouter,
  type SearchSchemaInput
} from '@tanstack/react-router'
import type { JSX } from 'react'
import { useCallback } from 'react'

import { ChatHomePage } from '../components/chat/ChatHomePage'
import { useOpenCodeChatShell, useOpenCodeProjectRoute } from '../hooks/useOpenCodeChatInterface'
import { OpenCodeProjectRouteProvider } from '../hooks/useOpenCodeProjectRouteContext'

type ProjectRouteSearch = {
  showActiveProjectSessions?: false
}

type ProjectRouteSearchInput = SearchSchemaInput & {
  showActiveProjectSessions?: boolean | string
}

export const Route = createFileRoute('/projects/$projectId')({
  validateSearch: (search: ProjectRouteSearchInput): ProjectRouteSearch => {
    return search.showActiveProjectSessions === false ||
      search.showActiveProjectSessions === 'false'
      ? { showActiveProjectSessions: false }
      : {}
  },
  component: ProjectRoute
})

export type ProjectRouteContext = ReturnType<typeof useOpenCodeProjectRoute>

function ProjectRoute(): JSX.Element {
  const { projectId } = Route.useParams()
  const { showActiveProjectSessions } = Route.useSearch()
  const router = useRouter()
  const navigate = useNavigate()
  const areActiveProjectSessionsVisible = showActiveProjectSessions !== false
  const navigateToOpenedProject = useCallback(
    (project: { id: string }) => {
      void navigate({ to: '/projects/$projectId', params: { projectId: project.id } })
    },
    [navigate]
  )
  const navigateHomeAfterActiveProjectRemoval = useCallback(
    (project: { id: string }) => {
      if (project.id !== projectId) return
      void navigate({ to: '/' })
    },
    [navigate, projectId]
  )
  const toggleActiveProjectSessions = useCallback(() => {
    void navigate({
      to: router.state.location.pathname,
      search: areActiveProjectSessionsVisible ? { showActiveProjectSessions: false } : {},
      replace: true
    })
  }, [areActiveProjectSessionsVisible, navigate, router])
  const shell = useOpenCodeChatShell(navigateToOpenedProject, navigateHomeAfterActiveProjectRemoval)
  const project = useOpenCodeProjectRoute(projectId)
  return (
    <OpenCodeProjectRouteProvider project={project}>
      <ChatHomePage
        shell={shell}
        project={project}
        activePane={<Outlet />}
        areActiveProjectSessionsVisible={areActiveProjectSessionsVisible}
        onActiveProjectSessionsToggle={toggleActiveProjectSessions}
      />
    </OpenCodeProjectRouteProvider>
  )
}
