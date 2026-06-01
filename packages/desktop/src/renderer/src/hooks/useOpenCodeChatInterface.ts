import { useMemo, useState } from 'react'

import { useOpenCodeProjects, type OpenCodeProject } from './opencode/projects'
import { type OpenCodePromptOptions, useSendOpenCodePrompt, useStartOpenCodeConversation } from './useOpenCodeChat'
import { useOpenCodeEvents } from './useOpenCodeEvents'
import {
  type OpenCodeSession,
  type OpenCodeSessionDetails,
  type OpenCodeSessionMessage,
  useOpenCodeSession,
  useProjectSessions,
  useSessionMessages
} from './useOpenCodeSessions'
import type { ChatMessage, ChatProject, ProjectChat } from './useChatInterfaceData'

export type OpenCodeChatInterfaceState = {
  projects: ChatProject[]
  activeChat: ProjectChat | null
  messages: ChatMessage[]
  selectedDirectory: string | null
  selectedSessionID: string | null
  promptText: string
  statusLabel: string
  statusMessage: string | null
  eventLabel: string
  isLoading: boolean
  isSending: boolean
  canSendPrompt: boolean
  emptyMessage: string | null
  errorMessage: string | null
  successMessage: string | null
  selectProject: (directory: string) => void
  selectSession: (sessionID: string | null) => void
  setPromptText: (value: string) => void
  sendPrompt: () => void
}

export function useOpenCodeChatInterface(): OpenCodeChatInterfaceState {
  const { status, connection, connectionQuery, projectsQuery } = useOpenCodeProjects()
  const events = useOpenCodeEvents()
  const [selectedDirectory, setSelectedDirectory] = useState<string | null>(null)
  const [selectedSessionID, setSelectedSessionID] = useState<string | null>(null)
  const [promptText, setPromptText] = useState('')
  const { sessionsQuery } = useProjectSessions(selectedDirectory)
  const { sessionQuery } = useOpenCodeSession(selectedDirectory, selectedSessionID)
  const { messagesQuery } = useSessionMessages(selectedDirectory, selectedSessionID)
  const { sendPromptMutation, connection: sendConnection } = useSendOpenCodePrompt(selectedDirectory, selectedSessionID)
  const { startConversationMutation, connection: startConnection } = useStartOpenCodeConversation(selectedDirectory)

  const projects = projectsQuery.data ?? []
  const sessions = sessionsQuery.data ?? []
  const messages = messagesQuery.data ?? []
  const activeSession = sessionQuery.data ?? sessions.find((session) => getSessionId(session) === selectedSessionID) ?? null
  const isSending = sendPromptMutation.isPending || startConversationMutation.isPending
  const canSendPrompt = Boolean(selectedDirectory) && promptText.trim().length > 0 && (sendConnection !== null || startConnection !== null) && !isSending

  return {
    projects: useMemo(() => mapProjects(projects, sessions, selectedDirectory), [projects, sessions, selectedDirectory]),
    activeChat: activeSession ? mapSessionToChat(activeSession, sessions.indexOf(activeSession as OpenCodeSession)) : null,
    messages: useMemo(() => messages.map(mapMessage), [messages]),
    selectedDirectory,
    selectedSessionID,
    promptText,
    statusLabel: status.state,
    statusMessage: status.message,
    eventLabel: events.listening
      ? `Live${events.lastEventType ? ` · ${events.lastEventType}` : ''}${events.lastEventAt ? ` · ${new Date(events.lastEventAt).toLocaleTimeString()}` : ''}`
      : 'Events paused',
    isLoading: projectsQuery.isLoading || sessionsQuery.isLoading || sessionQuery.isLoading || messagesQuery.isLoading,
    isSending,
    canSendPrompt,
    emptyMessage: getEmptyMessage(connection, selectedDirectory, selectedSessionID, projectsQuery.isSuccess, projects.length, sessionsQuery.isSuccess, sessions.length, messagesQuery.isSuccess, messages.length),
    errorMessage: firstErrorMessage(connectionQuery.error, projectsQuery.error, sessionsQuery.error, sessionQuery.error, messagesQuery.error, events.error, sendPromptMutation.error, startConversationMutation.error),
    successMessage: sendPromptMutation.isSuccess ? 'Prompt sent. Messages will refresh shortly.' : startConversationMutation.isSuccess ? 'Session started. Messages will refresh shortly.' : null,
    selectProject: (directory) => {
      setSelectedDirectory(directory)
      setSelectedSessionID(null)
    },
    selectSession: setSelectedSessionID,
    setPromptText,
    sendPrompt: () => {
      const options = buildPromptOptions(promptText)
      if (selectedSessionID) {
        sendPromptMutation.mutate(options, { onSuccess: () => setPromptText('') })
        return
      }
      startConversationMutation.mutate(options, {
        onSuccess: (session) => {
          setSelectedSessionID(getSessionId(session))
          setPromptText('')
        }
      })
    }
  }
}

function mapProjects(projects: OpenCodeProject[], sessions: OpenCodeSession[], selectedDirectory: string | null): ChatProject[] {
  return projects.map((project, index) => ({
    id: project.worktree || project.id || `project-${index}`,
    name: projectLabel(project, index),
    subtitle: project.worktree,
    chats:
      project.worktree === selectedDirectory && sessions.length > 0
        ? sessions.map(mapSessionToChat)
        : [{ id: `project-${project.id ?? index}`, kind: 'project', title: 'Open project', summary: project.worktree, updatedAt: '' }]
  }))
}

function mapSessionToChat(session: OpenCodeSession | OpenCodeSessionDetails, index: number): ProjectChat {
  const id = getSessionId(session) ?? `session-${index}`
  return { id, kind: 'session', title: getSessionTitle(session) ?? `Session ${index + 1}`, summary: id, updatedAt: formatTime(getSessionTime(session)) }
}

function mapMessage(message: OpenCodeSessionMessage, index: number): ChatMessage {
  return {
    id: getMessageId(message) ?? `message-${index}`,
    author: getMessageRole(message) === 'user' ? 'user' : 'assistant',
    content: getMessageText(message),
    createdAt: formatTime(getMessageTime(message))
  }
}

function buildPromptOptions(text: string): OpenCodePromptOptions {
  return { text }
}

function getEmptyMessage(connection: unknown, selectedDirectory: string | null, selectedSessionID: string | null, projectsLoaded: boolean, projectCount: number, sessionsLoaded: boolean, sessionCount: number, messagesLoaded: boolean, messageCount: number): string | null {
  if (connection === null) return 'Waiting for the OpenCode sidecar connection.'
  if (projectsLoaded && projectCount === 0) return 'No OpenCode projects found.'
  if (!selectedDirectory) return 'Select a project to view or start a chat.'
  if (sessionsLoaded && sessionCount === 0) return 'No sessions yet. Send a prompt to start one.'
  if (!selectedSessionID) return 'Select a session, or send a prompt to start a new one.'
  if (messagesLoaded && messageCount === 0) return 'No messages found for this session.'
  return null
}

function firstErrorMessage(...errors: unknown[]): string | null {
  const error = errors.find(Boolean)
  if (!error) return null
  return error instanceof Error ? error.message : String(error)
}

function projectLabel(project: OpenCodeProject, index: number): string {
  return project.name ?? project.worktree ?? project.id ?? `Project ${index + 1}`
}

function getSessionId(session: OpenCodeSession | OpenCodeSessionDetails): string | null {
  return getStringFromRecord(session, 'id') ?? getStringFromRecord(session, 'sessionID')
}

function getSessionTitle(session: OpenCodeSession | OpenCodeSessionDetails): string | null {
  return getStringFromRecord(session, 'title') ?? getStringFromRecord(session, 'name')
}

function getSessionTime(session: OpenCodeSession | OpenCodeSessionDetails): string | null {
  return getStringFromRecord(session, 'updated') ?? getStringFromRecord(session, 'updatedAt') ?? getStringFromRecord(session, 'time')
}

function getMessageId(message: OpenCodeSessionMessage): string | null {
  return getStringFromRecord(message, 'id') ?? getStringFromRecord(message, 'messageID')
}

function getMessageRole(message: OpenCodeSessionMessage): string | null {
  const info = getRecordProperty(message, 'info')
  return getStringFromRecord(info, 'role') ?? getStringFromRecord(message, 'role')
}

function getMessageTime(message: OpenCodeSessionMessage): string | null {
  const info = getRecordProperty(message, 'info')
  return getStringFromRecord(info, 'time') ?? getStringFromRecord(info, 'createdAt') ?? getStringFromRecord(message, 'time')
}

function getMessageText(message: OpenCodeSessionMessage): string {
  const direct = getStringFromRecord(message, 'text') ?? getStringFromRecord(message, 'content')
  if (direct) return direct
  const parts = getArrayProperty(message, 'parts') ?? getArrayProperty(getRecordProperty(message, 'info'), 'parts')
  if (!parts?.length) return 'No text content.'
  return parts.map(formatMessagePart).filter(Boolean).join('\n') || `${parts.length} non-text message part${parts.length === 1 ? '' : 's'}.`
}

function formatMessagePart(part: unknown): string {
  if (typeof part === 'string') return part
  if (!isRecord(part)) return ''
  return getStringFromRecord(part, 'text') ?? getStringFromRecord(part, 'content') ?? `[${getStringFromRecord(part, 'type') ?? 'part'}]`
}

function formatTime(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function getStringFromRecord(value: unknown, property: string): string | null {
  if (!isRecord(value) || !(property in value)) return null
  const propertyValue = value[property]
  return typeof propertyValue === 'string' && propertyValue.length > 0 ? propertyValue : null
}

function getRecordProperty(value: unknown, property: string): Record<string, unknown> | null {
  return isRecord(value) && isRecord(value[property]) ? value[property] : null
}

function getArrayProperty(value: unknown, property: string): unknown[] | null {
  return isRecord(value) && Array.isArray(value[property]) ? value[property] : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
