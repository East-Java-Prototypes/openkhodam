import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import {
  useOpenCodeProjects,
  type OpenCodeCurrentProject,
  type OpenCodeProject
} from './opencode/projects'
import {
  type OpenCodePromptOptions,
  type OpenCodeAdmittedPrompt,
  useSendOpenCodePrompt,
  useStartOpenCodeConversation
} from './useOpenCodeChat'
import {
  openCodeSessionEventErrorsQueryKey,
  useOpenCodeEvents,
  type OpenCodeSessionEventError
} from './useOpenCodeEvents'
import {
  type OpenCodeSession,
  type OpenCodeSessionDetails,
  isRenderableSession,
  useOpenCodeSession,
  useProjectSessions,
  useSessionMessages
} from './useOpenCodeSessions'
import {
  useOpenCodeModels,
  type OpenCodeModelOption,
  type OpenCodeModelSelection
} from './useOpenCodeModels'
import type { ChatMessage, ChatProject, ProjectChat } from './useChatInterfaceData'
import { normalizeOpenCodeMessage } from './opencode/message-normalizer'

const emptyProjects: OpenCodeProject[] = []
const emptySessions: OpenCodeSession[] = []
const emptyMessages: unknown[] = []

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

export type OpenCodeStartConversationState = {
  promptText: string
  isSending: boolean
  canSendPrompt: boolean
  errorMessage: string | null
  admittedPrompt: OpenCodeAdmittedPrompt | null
  modelOptions: OpenCodeModelOption[]
  selectedModel: OpenCodeModelOption | null
  selectedModelID: string | null
  setSelectedModelID: (value: string | null) => void
  modelHelperText: string
  modelErrorMessage: string | null
  isLoadingModels: boolean
  setPromptText: (value: string) => void
  startConversation: (
    onSuccess?: (sessionID: string, admittedPrompt: OpenCodeAdmittedPrompt) => void
  ) => void
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
  modelOptions: OpenCodeModelOption[]
  selectedModel: OpenCodeModelOption | null
  selectedModelID: string | null
  setSelectedModelID: (value: string | null) => void
  modelHelperText: string
  modelErrorMessage: string | null
  isLoadingModels: boolean
  setPromptText: (value: string) => void
  sendPrompt: () => void
}

export type OpenCodeChatInterfaceState = OpenCodeChatShellState &
  OpenCodeProjectRouteState &
  OpenCodeSessionRouteState & {
    selectedSessionID: string | null
  }

export type OpenCodeChatOpenedProject = {
  name: string
  directory: string
  id: string
}

export type { OpenCodeAdmittedPrompt, OpenCodeModelOption }

export function useOpenCodeChatShell(
  onOpenedProject?: (project: OpenCodeChatOpenedProject) => void
): OpenCodeChatShellState {
  const { status, connection, connectionQuery, projectsQuery, openProjectMutation } =
    useOpenCodeProjects()
  const events = useOpenCodeEvents()
  const [projectDirectoryText, setProjectDirectoryText] = useState('')
  const [openedDirectory, setOpenedDirectory] = useState<string | null>(null)
  const lastOpenedProjectId = useRef<string | null>(null)
  const openedProject = openProjectMutation.data ? mapOpenedProject(openProjectMutation.data) : null

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
    errorMessage: firstErrorMessage(
      connectionQuery.error,
      projectsQuery.error,
      openProjectMutation.error,
      events.error
    ),
    emptyMessage: getShellEmptyMessage(connection, projectsQuery.isSuccess, projects.length),
    projectDirectoryText,
    openedProject,
    openProjectStatusMessage: getOpenProjectStatusMessage(
      openedDirectory,
      openProjectMutation.isPending,
      openProjectMutation.error,
      openProjectMutation.data
    ),
    canOpenProject:
      projectDirectoryText.trim().length > 0 &&
      connection !== null &&
      !openProjectMutation.isPending,
    setProjectDirectoryText,
    openProjectByDirectory: () => {
      const directory = projectDirectoryText.trim()
      if (!directory) return
      setOpenedDirectory(directory)
      openProjectMutation.mutate(directory)
    }
  }
}

export function useOpenCodeProjectRoute(
  projectId: string | null | undefined
): OpenCodeProjectRouteState {
  const { connection, connectionQuery, projectsQuery } = useOpenCodeProjects()
  const projects = projectsQuery.data ?? emptyProjects
  const selectedProject = resolveProject(projects, projectId)
  const selectedDirectory = selectedProject?.worktree ?? null
  const { sessionsQuery } = useProjectSessions(selectedDirectory)
  const sessions = sessionsQuery.data ?? emptySessions

  return {
    sessions: useMemo(() => mapSessionsToChats(sessions), [sessions]),
    selectedProject: selectedProject
      ? mapProject(selectedProject, projects.indexOf(selectedProject))
      : null,
    selectedDirectory,
    isLoading: projectsQuery.isLoading || sessionsQuery.isLoading,
    errorMessage: firstErrorMessage(
      connectionQuery.error,
      projectsQuery.error,
      sessionsQuery.error
    ),
    emptyMessage: getProjectEmptyMessage(
      connection,
      projectId,
      projectsQuery.isSuccess,
      selectedProject,
      sessionsQuery.isSuccess,
      sessions.length
    )
  }
}

export function useOpenCodeSessionRoute(
  directory: string | null | undefined,
  sessionID: string | null | undefined,
  sessions: ProjectChat[],
  admittedPrompt?: OpenCodeAdmittedPrompt | null
): OpenCodeSessionRouteState {
  const [promptText, setPromptText] = useState('')
  const [optimisticPrompts, setOptimisticPrompts] = useState<OpenCodeAdmittedPrompt[]>([])
  const queryClient = useQueryClient()
  const { sessionQuery } = useOpenCodeSession(directory, sessionID)
  const activeSessionFromList = sessions.find((session) => session.id === sessionID) ?? null
  const fetchedSession = sessionQuery.data
  const fetchedSessionIsRenderable = fetchedSession ? isRenderableSession(fetchedSession) : false
  const activeSession = fetchedSession
    ? fetchedSessionIsRenderable
      ? mapSessionToChat(fetchedSession)
      : null
    : activeSessionFromList
  const messageSessionID = activeSession ? sessionID : null
  const { messagesQuery } = useSessionMessages(directory, messageSessionID)
  const models = useOpenCodeModels(directory)
  const { sendPromptMutation, connection: sendConnection } = useSendOpenCodePrompt(
    directory,
    sessionID
  )
  const messages = messagesQuery.data ?? emptyMessages
  const sessionEventErrorsQuery = useQuery({
    queryKey: openCodeSessionEventErrorsQueryKey,
    queryFn: async () =>
      queryClient.getQueryData<OpenCodeSessionEventError[]>(openCodeSessionEventErrorsQueryKey) ??
      [],
    initialData: () =>
      queryClient.getQueryData<OpenCodeSessionEventError[]>(openCodeSessionEventErrorsQueryKey) ??
      []
  })
  const sessionEventErrors = sessionEventErrorsQuery.data
  const sessionEventError = sessionEventErrors.find(
    (error) => error.sessionID === sessionID || (!error.sessionID && error.directory === directory)
  )
  const isSending = sendPromptMutation.isPending
  const canSendToActiveSession = Boolean(sessionID) && activeSession !== null

  const mappedMessages = useMemo(() => messages.map(mapMessage), [messages])
  const refetchMessages = messagesQuery.refetch
  const visibleMessages = useMemo(
    () =>
      activeSession ? appendOptimisticPrompts(mappedMessages, optimisticPrompts, sessionID) : [],
    [activeSession, mappedMessages, optimisticPrompts, sessionID]
  )

  useEffect(() => {
    if (!admittedPrompt || admittedPrompt.sessionID !== sessionID) return
    setOptimisticPrompts((current) => {
      if (current.some((prompt) => promptKey(prompt) === promptKey(admittedPrompt))) return current
      return [...current, admittedPrompt]
    })
  }, [admittedPrompt, sessionID])

  useEffect(() => {
    setOptimisticPrompts((current) =>
      current.filter(
        (prompt) =>
          prompt.sessionID !== sessionID ||
          !mappedMessages.some(
            (message) => message.author === 'user' && isProjectedPromptMessage(message, prompt)
          )
      )
    )
  }, [mappedMessages, sessionID])

  useEffect(() => {
    const pendingPrompts = optimisticPrompts.filter(
      (prompt) =>
        prompt.sessionID === sessionID &&
        !mappedMessages.some(
          (message) => message.author === 'user' && isProjectedPromptMessage(message, prompt)
        )
    )
    if (pendingPrompts.length === 0) return
    let cancelled = false
    let attempts = 0
    const refetch = () => {
      if (cancelled || attempts >= 12) return
      attempts += 1
      void refetchMessages().finally(() => {
        if (cancelled) return
        window.setTimeout(refetch, 350)
      })
    }
    void refetchMessages()
    const timeout = window.setTimeout(refetch, 150)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [mappedMessages, optimisticPrompts, refetchMessages, sessionID])

  return {
    activeChat: activeSession,
    messages: visibleMessages,
    promptText,
    isLoading:
      (sessionQuery.isLoading && activeSessionFromList === null) || messagesQuery.isLoading,
    isSending,
    canSendPrompt:
      Boolean(directory) &&
      promptText.trim().length > 0 &&
      models.selectedModel !== null &&
      canSendToActiveSession &&
      sendConnection !== null &&
      !isSending,
    emptyMessage: getSessionEmptyMessage(
      sessionID,
      sessionQuery.isSuccess,
      activeSession,
      messagesQuery.isSuccess,
      messages.length
    ),
    errorMessage: firstErrorMessage(
      activeSession ? null : sessionQuery.error,
      messagesQuery.error,
      sendPromptMutation.error,
      sessionEventError?.message
    ),
    successMessage: sendPromptMutation.isSuccess
      ? 'Prompt sent. Messages will refresh shortly.'
      : null,
    modelOptions: models.options,
    selectedModel: models.selectedModel,
    selectedModelID: models.selectedModelID,
    setSelectedModelID: models.setSelectedModelID,
    modelHelperText: models.helperText,
    modelErrorMessage: models.errorMessage,
    isLoadingModels: models.isLoading,
    setPromptText,
    sendPrompt: () => {
      const options = buildPromptOptions(promptText, models.selectedModel)
      if (sessionID && activeSession) {
        sendPromptMutation.mutate(options, {
          onSuccess: (admittedPrompt) => {
            setOptimisticPrompts((current) => [...current, admittedPrompt])
            setPromptText('')
          }
        })
      }
    }
  }
}

function appendOptimisticPrompts(
  messages: ChatMessage[],
  optimisticPrompts: OpenCodeAdmittedPrompt[],
  sessionID: string | null | undefined
): ChatMessage[] {
  const pending = optimisticPrompts.filter(
    (prompt) =>
      prompt.sessionID === sessionID &&
      !messages.some(
        (message) => message.author === 'user' && isProjectedPromptMessage(message, prompt)
      )
  )
  if (pending.length === 0) return messages
  return [
    ...messages,
    ...pending.map((prompt) => ({
      id: `optimistic-${prompt.sessionID}-${prompt.id}`,
      author: 'user' as const,
      content: prompt.text,
      parts: [{ id: `optimistic-${prompt.id}-text`, type: 'text' as const, text: prompt.text }],
      createdAt: 'Pending'
    }))
  ]
}

function promptKey(prompt: OpenCodeAdmittedPrompt): string {
  return `${prompt.sessionID}:${prompt.id}`
}

function isProjectedPromptMessage(
  message: ChatMessage,
  admittedPrompt: OpenCodeAdmittedPrompt
): boolean {
  return message.id === admittedPrompt.id
}

export function useOpenCodeStartConversation(
  directory: string | null | undefined
): OpenCodeStartConversationState {
  const [promptText, setPromptText] = useState('')
  const [admittedPrompt, setAdmittedPrompt] = useState<OpenCodeAdmittedPrompt | null>(null)
  const { startConversationMutation, connection } = useStartOpenCodeConversation(directory)
  const models = useOpenCodeModels(directory)
  const isSending = startConversationMutation.isPending

  return {
    promptText,
    isSending,
    canSendPrompt:
      Boolean(directory) &&
      promptText.trim().length > 0 &&
      models.selectedModel !== null &&
      connection !== null &&
      !isSending,
    errorMessage: firstErrorMessage(startConversationMutation.error, models.errorMessage),
    admittedPrompt,
    modelOptions: models.options,
    selectedModel: models.selectedModel,
    selectedModelID: models.selectedModelID,
    setSelectedModelID: models.setSelectedModelID,
    modelHelperText: models.helperText,
    modelErrorMessage: models.errorMessage,
    isLoadingModels: models.isLoading,
    setPromptText,
    startConversation: (onSuccess) => {
      const options = buildPromptOptions(promptText, models.selectedModel)
      startConversationMutation.mutate(options, {
        onSuccess: (admittedPrompt) => {
          setAdmittedPrompt(admittedPrompt)
          setPromptText('')
          onSuccess?.(admittedPrompt.sessionID, admittedPrompt)
        }
      })
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
  return (
    getStringFromRecord(project, 'id') ??
    getStringFromRecord(project, 'worktree')?.replaceAll('/', '-') ??
    `project-${index}`
  )
}

function resolveProject(
  projects: OpenCodeProject[],
  projectId: string | null | undefined
): OpenCodeProject | null {
  if (!projectId) return null
  return projects.find((project, index) => getProjectRouteId(project, index) === projectId) ?? null
}

function mapOpenedProject(project: OpenCodeCurrentProject): OpenCodeChatOpenedProject {
  return {
    name: project.name ?? 'Unknown project',
    directory: project.worktree ?? 'Unknown directory',
    id: project.id ?? 'Unknown ID'
  }
}

function getOpenProjectStatusMessage(
  openedDirectory: string | null,
  isLoading: boolean,
  error: unknown,
  project: OpenCodeCurrentProject | undefined
): string | null {
  if (!openedDirectory) return null
  if (isLoading) return `Opening directory: ${openedDirectory}`
  if (error) return `Project open error: ${formatUnknownError(error)}`
  if (project) return `Opened project: ${project.worktree ?? openedDirectory}`
  return null
}

function mapProjects(projects: OpenCodeProject[]): ChatProject[] {
  return projects.map(mapProject)
}

function mapSessionsToChats(sessions: OpenCodeSession[]): ProjectChat[] {
  return sessions.map(mapSessionToChat)
}

function mapProject(project: OpenCodeProject, index: number): ChatProject {
  return {
    id: getProjectRouteId(project, index),
    name: projectLabel(project, index),
    subtitle: project.worktree
  }
}

function mapSessionToChat(
  session: OpenCodeSession | OpenCodeSessionDetails,
  index = 0
): ProjectChat {
  const id = getSessionId(session) ?? `session-${index}`
  return {
    id,
    kind: 'session',
    title: getSessionTitle(session) ?? `Session ${index + 1}`,
    summary: id,
    updatedAt: formatTime(getSessionTime(session))
  }
}

function mapMessage(message: unknown, index: number): ChatMessage {
  const normalized = normalizeOpenCodeMessage(message)
  return {
    id: normalized.id ?? `message-${index}`,
    author: normalized.author,
    content: normalized.content,
    parts: normalized.parts,
    createdAt: formatTime(normalized.createdAt)
  }
}

function buildPromptOptions(
  text: string,
  model: OpenCodeModelSelection | null
): OpenCodePromptOptions {
  return {
    text,
    model: model ? { providerID: model.providerID, modelID: model.modelID } : null
  }
}

function getShellEmptyMessage(
  connection: unknown,
  projectsLoaded: boolean,
  projectCount: number
): string | null {
  if (connection === null) return 'Waiting for the OpenCode sidecar connection.'
  if (projectsLoaded && projectCount === 0) return 'No OpenCode projects found.'
  return null
}

function getProjectEmptyMessage(
  connection: unknown,
  projectId: string | null | undefined,
  projectsLoaded: boolean,
  project: OpenCodeProject | null,
  sessionsLoaded: boolean,
  sessionCount: number
): string | null {
  if (connection === null) return 'Waiting for the OpenCode sidecar connection.'
  if (!projectId) return 'Select a project to view sessions.'
  if (projectsLoaded && !project) return 'Project not found.'
  if (sessionsLoaded && sessionCount === 0) return 'No sessions found for this project.'
  return null
}

function getSessionEmptyMessage(
  sessionID: string | null | undefined,
  sessionLoaded: boolean,
  session: ProjectChat | null,
  messagesLoaded: boolean,
  messageCount: number
): string | null {
  if (!sessionID) return 'Select a session to view messages.'
  if (sessionLoaded && !session) return 'Session not found.'
  if (messagesLoaded && messageCount === 0) return 'No messages found for this session.'
  return null
}

function firstErrorMessage(...errors: unknown[]): string | null {
  const error = errors.find(Boolean)
  return error ? formatUnknownError(error) : null
}
function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (!isRecord(error)) return String(error)
  const message =
    getStringFromRecord(error, 'message') ??
    getStringFromRecord(error, 'detail') ??
    getStringFromRecord(error, '_tag') ??
    getStringFromRecord(error, 'name')
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
function getSessionTime(session: OpenCodeSession | OpenCodeSessionDetails): TimeValue {
  const time = getRecordProperty(session, 'time')
  return (
    getTimeFromRecord(time, 'updated') ??
    getTimeFromRecord(time, 'created') ??
    getTimeFromRecord(session, 'updated') ??
    getTimeFromRecord(session, 'updatedAt') ??
    getTimeFromRecord(session, 'time')
  )
}
function formatTime(value: TimeValue): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
function getTimeFromRecord(value: unknown, property: string): TimeValue {
  if (!isRecord(value) || !(property in value)) return null
  const propertyValue = value[property]
  if (typeof propertyValue === 'string' && propertyValue.length > 0) return propertyValue
  if (typeof propertyValue === 'number') return propertyValue
  return null
}
function getStringFromRecord(value: unknown, property: string): string | null {
  if (!isRecord(value) || !(property in value)) return null
  const propertyValue = value[property]
  return typeof propertyValue === 'string' && propertyValue.length > 0 ? propertyValue : null
}
function getRecordProperty(value: unknown, property: string): Record<string, unknown> | null {
  return isRecord(value) && isRecord(value[property]) ? value[property] : null
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
