import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, type JSX } from 'react'

import { SessionRouteActivePane } from '../components/chat/ChatHomePage'
import {
  useOpenCodeSessionRoute,
  type OpenCodeAdmittedPrompt
} from '../hooks/useOpenCodeChatInterface'
import { useOpenCodeProjectRouteContext } from '../hooks/useOpenCodeProjectRouteContext'

export const Route = createFileRoute('/projects/$projectId/sessions/$sessionId')({
  component: SessionRoute
})

function SessionRoute(): JSX.Element {
  const { sessionId } = Route.useParams()
  const project = useOpenCodeProjectRouteContext()
  const [admittedPrompt, setAdmittedPrompt] = useState<OpenCodeAdmittedPrompt | null>(() =>
    readAdmittedPromptHandoff(sessionId)
  )
  const session = useOpenCodeSessionRoute(
    project.selectedDirectory,
    sessionId,
    project.sessions,
    admittedPrompt
  )

  useEffect(() => {
    if (!admittedPrompt) return
    if (
      session.messages.some(
        (message) => message.author === 'user' && isProjectedAdmittedPrompt(message, admittedPrompt)
      )
    ) {
      sessionStorage.removeItem(`opencode-admitted-prompt:${sessionId}`)
      setAdmittedPrompt(null)
    }
  }, [admittedPrompt, session.messages, sessionId])

  return <SessionRouteActivePane project={project} session={session} />
}

function readAdmittedPromptHandoff(sessionID: string): OpenCodeAdmittedPrompt | null {
  const raw = sessionStorage.getItem(`opencode-admitted-prompt:${sessionID}`)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (isAdmittedPrompt(parsed)) return parsed
  } catch {
    if (raw.trim()) return { id: `handoff-${sessionID}`, sessionID, text: raw.trim() }
  }
  return null
}

function isProjectedAdmittedPrompt(
  message: { id: string; content: string },
  admittedPrompt: OpenCodeAdmittedPrompt
): boolean {
  if (admittedPrompt.id) return message.id === admittedPrompt.id
  return message.id.startsWith('optimistic-')
    ? false
    : message.content.trim() === admittedPrompt.text.trim()
}

function isAdmittedPrompt(value: unknown): value is OpenCodeAdmittedPrompt {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.sessionID === 'string' &&
    typeof record.text === 'string'
  )
}
