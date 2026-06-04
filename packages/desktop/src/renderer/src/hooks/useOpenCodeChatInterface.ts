import { useMemo, useState } from 'react'

import { useOpenCodeProject, useOpenCodeProjects, type OpenCodeCurrentProject, type OpenCodeProject } from './opencode/projects'
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

const emptyProjects: OpenCodeProject[] = []
const emptySessions: OpenCodeSession[] = []
const emptyMessages: OpenCodeSessionMessage[] = []

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
  projectDirectoryText: string
  openedProject: OpenCodeChatOpenedProject | null
  openProjectStatusMessage: string | null
  canOpenProject: boolean
  selectProject: (directory: string) => void
  selectSession: (sessionID: string | null) => void
  setProjectDirectoryText: (value: string) => void
  openProjectByDirectory: () => void
  setPromptText: (value: string) => void
  sendPrompt: () => void
}

export type OpenCodeChatOpenedProject = {
  name: string
  directory: string
  id: string
}

export function useOpenCodeChatInterface(): OpenCodeChatInterfaceState {
  const { status, connection, connectionQuery, projectsQuery } = useOpenCodeProjects()
  const events = useOpenCodeEvents()
  const [selectedDirectory, setSelectedDirectory] = useState<string | null>(null)
  const [selectedSessionID, setSelectedSessionID] = useState<string | null>(null)
  const [promptText, setPromptText] = useState('')
  const [projectDirectoryText, setProjectDirectoryText] = useState('')
  const [openedDirectory, setOpenedDirectory] = useState<string | null>(null)
  const { projectQuery } = useOpenCodeProject(openedDirectory)
  const effectiveSelectedDirectory = getEffectiveSelectedDirectory(selectedDirectory, openedDirectory, projectQuery.data)
  const { sessionsQuery } = useProjectSessions(effectiveSelectedDirectory)
  const { sessionQuery } = useOpenCodeSession(effectiveSelectedDirectory, selectedSessionID)
  const { messagesQuery } = useSessionMessages(effectiveSelectedDirectory, selectedSessionID)
  const { sendPromptMutation, connection: sendConnection } = useSendOpenCodePrompt(effectiveSelectedDirectory, selectedSessionID)
  const { startConversationMutation, connection: startConnection } = useStartOpenCodeConversation(effectiveSelectedDirectory)

  const projects = projectsQuery.data ?? emptyProjects
  const sessions = sessionsQuery.data ?? emptySessions
  const messages = messagesQuery.data ?? emptyMessages
  const activeSession = sessionQuery.data ?? sessions.find((session) => getSessionId(session) === selectedSessionID) ?? null
  const isSending = sendPromptMutation.isPending || startConversationMutation.isPending
  const canSendPrompt = Boolean(effectiveSelectedDirectory) && promptText.trim().length > 0 && (sendConnection !== null || startConnection !== null) && !isSending

  return {
    projects: useMemo(() => mapProjects(projects, sessions, effectiveSelectedDirectory), [projects, sessions, effectiveSelectedDirectory]),
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
    emptyMessage: getEmptyMessage(connection, effectiveSelectedDirectory, selectedSessionID, projectsQuery.isSuccess, projects.length, sessionsQuery.isSuccess, sessions.length, messagesQuery.isSuccess, messages.length),
    errorMessage: firstErrorMessage(connectionQuery.error, projectsQuery.error, sessionsQuery.error, sessionQuery.error, messagesQuery.error, events.error, sendPromptMutation.error, startConversationMutation.error),
    successMessage: sendPromptMutation.isSuccess ? 'Prompt sent. Messages will refresh shortly.' : startConversationMutation.isSuccess ? 'Session started. Messages will refresh shortly.' : null,
    projectDirectoryText,
    openedProject: projectQuery.data ? mapOpenedProject(projectQuery.data) : null,
    openProjectStatusMessage: getOpenProjectStatusMessage(openedDirectory, projectQuery.isLoading, projectQuery.error, projectQuery.data),
    canOpenProject: projectDirectoryText.trim().length > 0 && connection !== null && !projectQuery.isLoading,
    selectProject: (directory) => {
      setSelectedDirectory(directory)
      setOpenedDirectory(null)
      setSelectedSessionID(null)
    },
    selectSession: setSelectedSessionID,
    setProjectDirectoryText,
    openProjectByDirectory: () => {
      const directory = projectDirectoryText.trim()
      if (!directory) return
      setOpenedDirectory(directory)
      setSelectedDirectory(directory)
      setSelectedSessionID(null)
    },
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

function getEffectiveSelectedDirectory(selectedDirectory: string | null, openedDirectory: string | null, project: OpenCodeCurrentProject | undefined): string | null {
  if (selectedDirectory && openedDirectory && selectedDirectory === openedDirectory) return project?.worktree ?? selectedDirectory
  return selectedDirectory
}

function mapOpenedProject(project: OpenCodeCurrentProject): OpenCodeChatOpenedProject {
  return {
    name: project.name ?? 'Unknown project',
    directory: project.worktree ?? 'Unknown directory',
    id: project.id ?? 'Unknown ID'
  }
}

function getOpenProjectStatusMessage(openedDirectory: string | null, isLoading: boolean, error: unknown, project: OpenCodeCurrentProject | undefined): string | null {
  if (!openedDirectory) return null
  if (isLoading) return `Opening directory: ${openedDirectory}`
  if (error) return `Project open error: ${formatUnknownError(error)}`
  if (project) return `Opened project: ${project.worktree ?? openedDirectory}`
  return null
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
  return formatUnknownError(error)
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (!isRecord(error)) return String(error)
  const message = getStringFromRecord(error, 'message') ?? getStringFromRecord(error, 'detail') ?? getStringFromRecord(error, '_tag') ?? getStringFromRecord(error, 'name')
  if (message) return message
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
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
  return getStringFromRecord(info, 'role') ?? getStringFromRecord(message, 'role') ?? getStringFromRecord(message, 'type')
}

function getMessageTime(message: OpenCodeSessionMessage): string | null {
  const info = getRecordProperty(message, 'info')
  const time = getRecordProperty(message, 'time')
  return getStringFromRecord(info, 'time') ?? getStringFromRecord(info, 'createdAt') ?? getStringFromRecord(time, 'created') ?? getStringFromRecord(message, 'time')
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
