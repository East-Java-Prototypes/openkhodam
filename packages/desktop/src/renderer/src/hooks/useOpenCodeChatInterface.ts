import { useEffect, useMemo, useRef, useState } from 'react'

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

type TimeValue = string | number | null

export type OpenCodeChatShellState = {
  projects: ChatProject[]
  statusLabel: string
  statusMessage: string | null
  eventLabel: string
  isLoading: boolean
  errorMessage: string | null
  emptyMessage: string | null
  projectDirectoryText: string
  openedProject: OpenCodeChatOpenedProject | null
  openProjectStatusMessage: string | null
  canOpenProject: boolean
  setProjectDirectoryText: (value: string) => void
  openProjectByDirectory: () => void
}

export type OpenCodeProjectRouteState = {
  sessions: ProjectChat[]
  selectedProject: ChatProject | null
  selectedDirectory: string | null
  isLoading: boolean
  errorMessage: string | null
  emptyMessage: string | null
}

export type OpenCodeSessionRouteState = {
  activeChat: ProjectChat | null
  messages: ChatMessage[]
  promptText: string
  isLoading: boolean
  isSending: boolean
  canSendPrompt: boolean
  emptyMessage: string | null
  errorMessage: string | null
  successMessage: string | null
  setPromptText: (value: string) => void
  sendPrompt: () => void
}

export type OpenCodeChatInterfaceState = OpenCodeChatShellState & OpenCodeProjectRouteState & OpenCodeSessionRouteState & {
  selectedSessionID: string | null
}

export type OpenCodeChatOpenedProject = {
  name: string
  directory: string
  id: string
}

export function useOpenCodeChatShell(onOpenedProject?: (project: OpenCodeChatOpenedProject) => void): OpenCodeChatShellState {
  const { status, connection, connectionQuery, projectsQuery } = useOpenCodeProjects()
  const events = useOpenCodeEvents()
  const [projectDirectoryText, setProjectDirectoryText] = useState('')
  const [openedDirectory, setOpenedDirectory] = useState<string | null>(null)
  const lastOpenedProjectId = useRef<string | null>(null)
  const { projectQuery } = useOpenCodeProject(openedDirectory)
  const openedProject = projectQuery.data ? mapOpenedProject(projectQuery.data) : null

  useEffect(() => {
    if (!openedProject || lastOpenedProjectId.current === openedProject.id) return
    lastOpenedProjectId.current = openedProject.id
    onOpenedProject?.(openedProject)
  }, [onOpenedProject, openedProject])

  const projects = projectsQuery.data ?? emptyProjects

  return {
    projects: useMemo(() => mapProjects(projects), [projects]),
    statusLabel: status.state,
    statusMessage: status.message,
    eventLabel: events.listening
      ? `Live${events.lastEventType ? ` · ${events.lastEventType}` : ''}${events.lastEventAt ? ` · ${new Date(events.lastEventAt).toLocaleTimeString()}` : ''}`
      : 'Events paused',
    isLoading: projectsQuery.isLoading,
    errorMessage: firstErrorMessage(connectionQuery.error, projectsQuery.error, projectQuery.error, events.error),
    emptyMessage: getShellEmptyMessage(connection, projectsQuery.isSuccess, projects.length),
    projectDirectoryText,
    openedProject,
    openProjectStatusMessage: getOpenProjectStatusMessage(openedDirectory, projectQuery.isLoading, projectQuery.error, projectQuery.data),
    canOpenProject: projectDirectoryText.trim().length > 0 && connection !== null && !projectQuery.isLoading,
    setProjectDirectoryText,
    openProjectByDirectory: () => {
      const directory = projectDirectoryText.trim()
      if (!directory) return
      setOpenedDirectory(directory)
    }
  }
}

export function useOpenCodeProjectRoute(projectId: string | null | undefined): OpenCodeProjectRouteState {
  const { connection, connectionQuery, projectsQuery } = useOpenCodeProjects()
  const projects = projectsQuery.data ?? emptyProjects
  const selectedProject = resolveProject(projects, projectId)
  const selectedDirectory = selectedProject?.worktree ?? null
  const { sessionsQuery } = useProjectSessions(selectedDirectory)
  const sessions = sessionsQuery.data ?? emptySessions

  return {
    sessions: useMemo(() => sessions.map(mapSessionToChat), [sessions]),
    selectedProject: selectedProject ? mapProject(selectedProject, projects.indexOf(selectedProject)) : null,
    selectedDirectory,
    isLoading: projectsQuery.isLoading || sessionsQuery.isLoading,
    errorMessage: firstErrorMessage(connectionQuery.error, projectsQuery.error, sessionsQuery.error),
    emptyMessage: getProjectEmptyMessage(connection, projectId, projectsQuery.isSuccess, selectedProject, sessionsQuery.isSuccess, sessions.length)
  }
}

export function useOpenCodeSessionRoute(directory: string | null | undefined, sessionID: string | null | undefined, sessions: ProjectChat[]): OpenCodeSessionRouteState {
  const [promptText, setPromptText] = useState('')
  const { sessionQuery } = useOpenCodeSession(directory, sessionID)
  const { messagesQuery } = useSessionMessages(directory, sessionID)
  const { sendPromptMutation, connection: sendConnection } = useSendOpenCodePrompt(directory, sessionID)
  const { startConversationMutation } = useStartOpenCodeConversation(directory)
  const messages = messagesQuery.data ?? emptyMessages
  const activeSessionFromList = sessions.find((session) => session.id === sessionID) ?? null
  const activeSession = sessionQuery.data ? mapSessionToChat(sessionQuery.data) : activeSessionFromList
  const isSending = sendPromptMutation.isPending || startConversationMutation.isPending
  const canSendToActiveSession = Boolean(sessionID) && activeSession !== null

  return {
    activeChat: activeSession,
    messages: useMemo(() => messages.map(mapMessage), [messages]),
    promptText,
    isLoading: (sessionQuery.isLoading && activeSessionFromList === null) || messagesQuery.isLoading,
    isSending,
    canSendPrompt: Boolean(directory) && promptText.trim().length > 0 && canSendToActiveSession && sendConnection !== null && !isSending,
    emptyMessage: getSessionEmptyMessage(sessionID, sessionQuery.isSuccess, activeSession, messagesQuery.isSuccess, messages.length),
    errorMessage: firstErrorMessage(activeSession ? null : sessionQuery.error, messagesQuery.error, sendPromptMutation.error, startConversationMutation.error),
    successMessage: sendPromptMutation.isSuccess ? 'Prompt sent. Messages will refresh shortly.' : startConversationMutation.isSuccess ? 'Session started. Messages will refresh shortly.' : null,
    setPromptText,
    sendPrompt: () => {
      const options = buildPromptOptions(promptText)
      if (sessionID && activeSession) {
        sendPromptMutation.mutate(options, { onSuccess: () => setPromptText('') })
      }
    }
  }
}

export function useOpenCodeChatInterface(): OpenCodeChatInterfaceState {
  const shell = useOpenCodeChatShell()
  const project = useOpenCodeProjectRoute(null)
  const session = useOpenCodeSessionRoute(project.selectedDirectory, null, project.sessions)
  return { ...shell, ...project, ...session, selectedSessionID: null }
}

export function getProjectRouteId(project: OpenCodeProject | ChatProject, index = 0): string {
  return getStringFromRecord(project, 'id') ?? getStringFromRecord(project, 'worktree') ?? `project-${index}`
}

function resolveProject(projects: OpenCodeProject[], projectId: string | null | undefined): OpenCodeProject | null {
  if (!projectId) return null
  return projects.find((project, index) => getProjectRouteId(project, index) === projectId) ?? null
}

function mapOpenedProject(project: OpenCodeCurrentProject): OpenCodeChatOpenedProject {
  return { name: project.name ?? 'Unknown project', directory: project.worktree ?? 'Unknown directory', id: project.id ?? 'Unknown ID' }
}

function getOpenProjectStatusMessage(openedDirectory: string | null, isLoading: boolean, error: unknown, project: OpenCodeCurrentProject | undefined): string | null {
  if (!openedDirectory) return null
  if (isLoading) return `Opening directory: ${openedDirectory}`
  if (error) return `Project open error: ${formatUnknownError(error)}`
  if (project) return `Opened project: ${project.worktree ?? openedDirectory}`
  return null
}

function mapProjects(projects: OpenCodeProject[]): ChatProject[] {
  return projects.map(mapProject)
}

function mapProject(project: OpenCodeProject, index: number): ChatProject {
  return { id: getProjectRouteId(project, index), name: projectLabel(project, index), subtitle: project.worktree }
}

function mapSessionToChat(session: OpenCodeSession | OpenCodeSessionDetails, index = 0): ProjectChat {
  const id = getSessionId(session) ?? `session-${index}`
  return { id, kind: 'session', title: getSessionTitle(session) ?? `Session ${index + 1}`, summary: id, updatedAt: formatTime(getSessionTime(session)) }
}

function mapMessage(message: OpenCodeSessionMessage, index: number): ChatMessage {
  return { id: getMessageId(message) ?? `message-${index}`, author: getMessageRole(message) === 'user' ? 'user' : 'assistant', content: getMessageText(message), createdAt: formatTime(getMessageTime(message)) }
}

function buildPromptOptions(text: string): OpenCodePromptOptions { return { text } }

function getShellEmptyMessage(connection: unknown, projectsLoaded: boolean, projectCount: number): string | null {
  if (connection === null) return 'Waiting for the OpenCode sidecar connection.'
  if (projectsLoaded && projectCount === 0) return 'No OpenCode projects found.'
  return null
}

function getProjectEmptyMessage(connection: unknown, projectId: string | null | undefined, projectsLoaded: boolean, project: OpenCodeProject | null, sessionsLoaded: boolean, sessionCount: number): string | null {
  if (connection === null) return 'Waiting for the OpenCode sidecar connection.'
  if (!projectId) return 'Select a project to view sessions.'
  if (projectsLoaded && !project) return 'Project not found.'
  if (sessionsLoaded && sessionCount === 0) return 'No sessions found for this project.'
  return null
}

function getSessionEmptyMessage(sessionID: string | null | undefined, sessionLoaded: boolean, session: ProjectChat | null, messagesLoaded: boolean, messageCount: number): string | null {
  if (!sessionID) return 'Select a session to view messages.'
  if (sessionLoaded && !session) return 'Session not found.'
  if (messagesLoaded && messageCount === 0) return 'No messages found for this session.'
  return null
}

function firstErrorMessage(...errors: unknown[]): string | null { const error = errors.find(Boolean); return error ? formatUnknownError(error) : null }
function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (!isRecord(error)) return String(error)
  const message = getStringFromRecord(error, 'message') ?? getStringFromRecord(error, 'detail') ?? getStringFromRecord(error, '_tag') ?? getStringFromRecord(error, 'name')
  if (message) return message
  try { return JSON.stringify(error) } catch { return String(error) }
}
function projectLabel(project: OpenCodeProject, index: number): string { return project.name ?? project.worktree ?? project.id ?? `Project ${index + 1}` }
function getSessionId(session: OpenCodeSession | OpenCodeSessionDetails): string | null { return getStringFromRecord(session, 'id') ?? getStringFromRecord(session, 'sessionID') }
function getSessionTitle(session: OpenCodeSession | OpenCodeSessionDetails): string | null { return getStringFromRecord(session, 'title') ?? getStringFromRecord(session, 'name') }
function getSessionTime(session: OpenCodeSession | OpenCodeSessionDetails): TimeValue { const time = getRecordProperty(session, 'time'); return getTimeFromRecord(time, 'updated') ?? getTimeFromRecord(time, 'created') ?? getTimeFromRecord(session, 'updated') ?? getTimeFromRecord(session, 'updatedAt') ?? getTimeFromRecord(session, 'time') }
function getMessageId(message: OpenCodeSessionMessage): string | null { const info = getRecordProperty(message, 'info'); return getStringFromRecord(info, 'id') ?? getStringFromRecord(info, 'messageID') ?? getStringFromRecord(message, 'id') ?? getStringFromRecord(message, 'messageID') }
function getMessageRole(message: OpenCodeSessionMessage): string | null { const info = getRecordProperty(message, 'info'); return getStringFromRecord(info, 'role') ?? getStringFromRecord(message, 'role') ?? getStringFromRecord(message, 'type') }
function getMessageTime(message: OpenCodeSessionMessage): TimeValue { const info = getRecordProperty(message, 'info'); const infoTime = getRecordProperty(info, 'time'); const time = getRecordProperty(message, 'time'); return getTimeFromRecord(infoTime, 'created') ?? getTimeFromRecord(infoTime, 'updated') ?? getTimeFromRecord(info, 'time') ?? getTimeFromRecord(info, 'createdAt') ?? getTimeFromRecord(time, 'created') ?? getTimeFromRecord(message, 'time') }
function getMessageText(message: OpenCodeSessionMessage): string { const direct = getStringFromRecord(message, 'text') ?? getStringFromRecord(message, 'content'); if (direct) return direct; const parts = getArrayProperty(message, 'parts') ?? getArrayProperty(getRecordProperty(message, 'info'), 'parts'); if (!parts?.length) return 'No text content.'; return parts.map(formatMessagePart).filter(Boolean).join('\n') || `${parts.length} non-text message part${parts.length === 1 ? '' : 's'}.` }
function formatMessagePart(part: unknown): string { if (typeof part === 'string') return part; if (!isRecord(part)) return ''; return getStringFromRecord(part, 'text') ?? getStringFromRecord(part, 'content') ?? `[${getStringFromRecord(part, 'type') ?? 'part'}]` }
function formatTime(value: TimeValue): string { if (!value) return ''; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }
function getTimeFromRecord(value: unknown, property: string): TimeValue { if (!isRecord(value) || !(property in value)) return null; const propertyValue = value[property]; if (typeof propertyValue === 'string' && propertyValue.length > 0) return propertyValue; if (typeof propertyValue === 'number') return propertyValue; return null }
function getStringFromRecord(value: unknown, property: string): string | null { if (!isRecord(value) || !(property in value)) return null; const propertyValue = value[property]; return typeof propertyValue === 'string' && propertyValue.length > 0 ? propertyValue : null }
function getRecordProperty(value: unknown, property: string): Record<string, unknown> | null { return isRecord(value) && isRecord(value[property]) ? value[property] : null }
function getArrayProperty(value: unknown, property: string): unknown[] | null { return isRecord(value) && Array.isArray(value[property]) ? value[property] : null }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null }
