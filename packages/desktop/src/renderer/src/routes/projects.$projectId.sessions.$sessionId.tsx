import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, type JSX } from 'react'

import { SessionRouteActivePane } from '../components/chat/ChatHomePage'
import {
  createLinkedGoogleDocRecorder,
  extractGoogleDocDocumentArtifactsFromMessages,
  type GoogleDocDocumentArtifactCandidate
} from '../hooks/opencode/google-doc-artifacts'
import {
  useOpenCodeSessionRoute,
  type OpenCodeAdmittedPrompt
} from '../hooks/useOpenCodeChatInterface'
import { useOpenCodeProjectRouteContext } from '../hooks/useOpenCodeProjectRouteContext'

const linkedGoogleDocRecorder = createLinkedGoogleDocRecorder({
  listSessionLinkedDocs: (input) => window.api.listSessionLinkedDocs(input),
  recordLinkedGoogleDoc: (input) => window.api.recordLinkedGoogleDoc(input)
})

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

  useEffect(() => {
    const projectDirectory = project.selectedDirectory
    if (!projectDirectory || !sessionId) return

    const candidates = extractGoogleDocDocumentArtifactsFromMessages(session.messages)
    if (candidates.length === 0) return

    let cancelled = false

    void (async () => {
      for (const candidate of candidates) {
        if (cancelled) return
        try {
          await linkedGoogleDocRecorder.getOrCreateLinkedGoogleDoc({
            projectDirectory,
            sessionId,
            messageId: candidate.messageId,
            doc: candidate.doc
          })
        } catch (error) {
          logLinkedGoogleDocRecordFailure(error, sessionId, candidate)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [project.selectedDirectory, session.messages, sessionId])

  return <SessionRouteActivePane project={project} session={session} />
}

function logLinkedGoogleDocRecordFailure(
  error: unknown,
  sessionId: string,
  candidate: GoogleDocDocumentArtifactCandidate
): void {
  console.warn('[opencode] Failed to record linked Google Doc artifact', {
    docId: candidate.doc.id,
    messageId: candidate.messageId,
    sessionId,
    error: formatUnknownError(error)
  })
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

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (typeof error !== 'object' || error === null) return String(error)
  const record = error as Record<string, unknown>
  const message = firstString(record.message, record._tag, record.name)
  if (message) return message
  return 'Unknown error'
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value
  }

  return null
}
