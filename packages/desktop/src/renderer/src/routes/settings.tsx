import { createFileRoute, useNavigate, type SearchSchemaInput } from '@tanstack/react-router'
import type { JSX } from 'react'
import { useCallback } from 'react'

import { ChatHomePage } from '../components/chat/ChatHomePage'
import { useOpenCodeChatShell } from '../hooks/useOpenCodeChatInterface'
import SettingsPage from '../pages/SettingsPage'

type SettingsRouteSearch = {
  section?: 'providers'
}

type SettingsRouteSearchInput = SearchSchemaInput & {
  section?: string
}

export const Route = createFileRoute('/settings')({
  validateSearch: (search: SettingsRouteSearchInput): SettingsRouteSearch =>
    search.section === 'providers' ? { section: 'providers' } : {},
  component: SettingsRoute
})

function SettingsRoute(): JSX.Element {
  const { section } = Route.useSearch()
  const navigate = useNavigate()
  const navigateToOpenedProject = useCallback(
    (project: { id: string }) => {
      void navigate({ to: '/projects/$projectId', params: { projectId: project.id } })
    },
    [navigate]
  )
  const shell = useOpenCodeChatShell(navigateToOpenedProject)
  return (
    <ChatHomePage
      shell={shell}
      activePane={<SettingsPage focusProviders={section === 'providers'} />}
    />
  )
}
