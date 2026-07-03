import { createFileRoute } from '@tanstack/react-router'
import type { LinkedGoogleDoc } from '@openkhodam/ui/types'
import { useEffect, useMemo, useState, type JSX } from 'react'

import { SessionRouteActivePane } from '../components/chat/ChatHomePage'
import type { ChatMessage } from '../hooks/useChatInterfaceData'
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
  const [linkedDocsState, setLinkedDocsState] = useState<SessionLinkedDocsState>({
    docs: [],
    scopeKey: ''
  })
  const session = useOpenCodeSessionRoute(
    project.selectedDirectory,
    sessionId,
    project.sessions,
    admittedPrompt
  )
  const linkedDocsScopeKey = `${project.selectedDirectory ?? ''}\0${sessionId}`
  const linkedDocsMessageVersion = useMemo(
    () => buildLinkedDocsMessageVersion(session.messages),
    [session.messages]
  )
  const linkedDocs =
    linkedDocsState.scopeKey === linkedDocsScopeKey ? linkedDocsState.docs : emptyLinkedDocs

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
    if (!projectDirectory || !sessionId) {
      setLinkedDocsState((current) =>
        sessionLinkedDocsStateEquals(current, emptySessionLinkedDocsState(linkedDocsScopeKey))
          ? current
          : emptySessionLinkedDocsState(linkedDocsScopeKey)
      )
      return
    }

    let cancelled = false

    void window.api
      .listSessionLinkedDocs({ projectDirectory, sessionId })
      .then((docs) => {
        if (cancelled) return
        const nextState = {
          docs: docs.filter((doc) => doc.listed === true),
          scopeKey: linkedDocsScopeKey
        }
        setLinkedDocsState((current) => {
          return sessionLinkedDocsStateEquals(current, nextState) ? current : nextState
        })
      })
      .catch(() => {
        if (cancelled) return
        setLinkedDocsState((current) =>
          sessionLinkedDocsStateEquals(current, emptySessionLinkedDocsState(linkedDocsScopeKey))
            ? current
            : emptySessionLinkedDocsState(linkedDocsScopeKey)
        )
      })

    return () => {
      cancelled = true
    }
  }, [linkedDocsMessageVersion, linkedDocsScopeKey, project.selectedDirectory, sessionId])

  return <SessionRouteActivePane linkedDocs={linkedDocs} project={project} session={session} />
}

type SessionLinkedDocsState = {
  docs: LinkedGoogleDoc[]
  scopeKey: string
}

const emptyLinkedDocs: LinkedGoogleDoc[] = []

function buildLinkedDocsMessageVersion(messages: ChatMessage[]): string {
  return messages
    .map((message) => {
      const partsVersion = message.parts
        .map((part) =>
          part.type === 'tool'
            ? `${part.id}:${part.type}:${part.name}:${part.status ?? ''}`
            : `${part.id}:${part.type}`
        )
        .join('\0')
      return `${message.id}:${message.parts.length}:${partsVersion}`
    })
    .join('\0')
}

function emptySessionLinkedDocsState(scopeKey: string): SessionLinkedDocsState {
  return { docs: emptyLinkedDocs, scopeKey }
}

function sessionLinkedDocsStateEquals(
  left: SessionLinkedDocsState,
  right: SessionLinkedDocsState
): boolean {
  return left.scopeKey === right.scopeKey && linkedGoogleDocsEqual(left.docs, right.docs)
}

function linkedGoogleDocsEqual(left: LinkedGoogleDoc[], right: LinkedGoogleDoc[]): boolean {
  if (left.length !== right.length) return false

  return left.every((doc, index) => linkedGoogleDocEquals(doc, right[index]))
}

function linkedGoogleDocEquals(left: LinkedGoogleDoc, right: LinkedGoogleDoc): boolean {
  return (
    left.artifactPath === right.artifactPath &&
    left.id === right.id &&
    left.title === right.title &&
    left.url === right.url &&
    left.listed === right.listed &&
    left.firstSeenAt === right.firstSeenAt &&
    left.lastSeenAt === right.lastSeenAt &&
    left.firstMessageId === right.firstMessageId &&
    left.lastMessageId === right.lastMessageId
  )
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
