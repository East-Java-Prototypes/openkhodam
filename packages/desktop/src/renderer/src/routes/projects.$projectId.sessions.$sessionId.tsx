import { createFileRoute } from '@tanstack/react-router'
import type { LinkedGoogleArtifact } from '@openkhodam/ui/types'
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
  const [linkedGoogleArtifactsState, setLinkedGoogleArtifactsState] =
    useState<SessionLinkedGoogleArtifactsState>({
      artifacts: [],
      scopeKey: ''
    })
  const session = useOpenCodeSessionRoute(
    project.selectedDirectory,
    sessionId,
    project.sessions,
    admittedPrompt
  )
  const linkedGoogleArtifactsScopeKey = `${project.selectedDirectory ?? ''}\0${sessionId}`
  const linkedGoogleArtifactsMessageVersion = useMemo(
    () => buildLinkedGoogleArtifactsMessageVersion(session.messages),
    [session.messages]
  )
  const linkedGoogleArtifacts =
    linkedGoogleArtifactsState.scopeKey === linkedGoogleArtifactsScopeKey
      ? linkedGoogleArtifactsState.artifacts
      : emptyLinkedGoogleArtifacts

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
      setLinkedGoogleArtifactsState((current) =>
        sessionLinkedGoogleArtifactsStateEquals(
          current,
          emptySessionLinkedGoogleArtifactsState(linkedGoogleArtifactsScopeKey)
        )
          ? current
          : emptySessionLinkedGoogleArtifactsState(linkedGoogleArtifactsScopeKey)
      )
      return
    }

    let cancelled = false

    void window.api
      .listSessionLinkedGoogleArtifacts({ projectDirectory, sessionId })
      .then((artifacts) => {
        if (cancelled) return
        const nextState = {
          artifacts: artifacts.filter((artifact) => artifact.listed === true),
          scopeKey: linkedGoogleArtifactsScopeKey
        }
        setLinkedGoogleArtifactsState((current) => {
          return sessionLinkedGoogleArtifactsStateEquals(current, nextState) ? current : nextState
        })
      })
      .catch(() => {
        if (cancelled) return
        setLinkedGoogleArtifactsState((current) =>
          sessionLinkedGoogleArtifactsStateEquals(
            current,
            emptySessionLinkedGoogleArtifactsState(linkedGoogleArtifactsScopeKey)
          )
            ? current
            : emptySessionLinkedGoogleArtifactsState(linkedGoogleArtifactsScopeKey)
        )
      })

    return () => {
      cancelled = true
    }
  }, [
    linkedGoogleArtifactsMessageVersion,
    linkedGoogleArtifactsScopeKey,
    project.selectedDirectory,
    sessionId
  ])

  return (
    <SessionRouteActivePane
      linkedGoogleArtifacts={linkedGoogleArtifacts}
      project={project}
      session={session}
    />
  )
}

type SessionLinkedGoogleArtifactsState = {
  artifacts: LinkedGoogleArtifact[]
  scopeKey: string
}

const emptyLinkedGoogleArtifacts: LinkedGoogleArtifact[] = []

function buildLinkedGoogleArtifactsMessageVersion(messages: ChatMessage[]): string {
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

function emptySessionLinkedGoogleArtifactsState(
  scopeKey: string
): SessionLinkedGoogleArtifactsState {
  return { artifacts: emptyLinkedGoogleArtifacts, scopeKey }
}

function sessionLinkedGoogleArtifactsStateEquals(
  left: SessionLinkedGoogleArtifactsState,
  right: SessionLinkedGoogleArtifactsState
): boolean {
  return (
    left.scopeKey === right.scopeKey && linkedGoogleArtifactsEqual(left.artifacts, right.artifacts)
  )
}

function linkedGoogleArtifactsEqual(
  left: LinkedGoogleArtifact[],
  right: LinkedGoogleArtifact[]
): boolean {
  if (left.length !== right.length) return false

  return left.every((artifact, index) => linkedGoogleArtifactEquals(artifact, right[index]))
}

function linkedGoogleArtifactEquals(
  left: LinkedGoogleArtifact,
  right: LinkedGoogleArtifact
): boolean {
  return (
    left.type === right.type &&
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
