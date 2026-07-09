import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import {
  useOpenCodeProjects,
  type OpenCodeCurrentProject,
  type OpenCodeOpenedProject,
  type OpenCodeProject
} from './opencode/projects'
import {
  type OpenCodePromptOptions,
  type OpenCodeAdmittedPrompt,
  useSendOpenCodePrompt,
  useStartOpenCodeConversation,
  useUndoOpenCodePrompt
} from './useOpenCodeChat'
import {
  openCodeSessionEventErrorsQueryKey,
  type OpenCodeEventsState,
  useOpenCodeEvents,
  type OpenCodeSessionEventError
} from './useOpenCodeEvents'
import {
  type OpenCodeSession,
  type OpenCodeSessionDetails,
  isRenderableSession,
  useOpenCodeSession,
  useProjectSessions,
  useSessionStatuses,
  isActiveSessionStatus,
  useSessionMessages
} from './useOpenCodeSessions'
import {
  useOpenCodeModels,
  type OpenCodeModelEffortOption,
  type OpenCodeModelOption,
  type OpenCodeModelSelection
} from './useOpenCodeModels'
import { useOpenCodeAgents, type OpenCodeAgentOption } from './useOpenCodeAgents'
import type { ChatMessage, ChatProject, ProjectChat } from './useChatInterfaceData'
import { normalizeOpenCodeMessage } from './opencode/message-normalizer'

const emptySessions: OpenCodeSession[] = []
const emptyMessages: unknown[] = []

type TimeValue = string | number | null

export type OpenCodeHeartbeatStatus = {
  connected: boolean
  ariaLabel: string
  title: string
}

export type OpenCodeChatShellState = {
  projects: ChatProject[]
  statusMessage: string | null
  heartbeatStatus: OpenCodeHeartbeatStatus
  isLoading: boolean
  errorMessage: string | null
  emptyMessage: string | null
  openedProject: OpenCodeChatOpenedProject | null
  openProjectStatusMessage: string | null
  canSelectProjectDirectory: boolean
  removingProjectDirectory: string | null
  selectProjectDirectory: () => void
  removeOpenedProject: (project: ChatProject) => void
}

export type OpenCodeProjectRouteState = {
  sessions: ProjectChat[]
  selectedProject: ChatProject | null
  selectedDirectory: string | null
  isLoading: boolean
  errorMessage: string | null
  emptyMessage: string | null
  transcriptStatusMessage: string | null
}

export type OpenCodeStartConversationState = {
  promptText: string
  isSending: boolean
  canSendPrompt: boolean
  errorMessage: string | null
  admittedPrompt: OpenCodeAdmittedPrompt | null
  modelOptions: OpenCodeModelOption[]
  agentOptions: OpenCodeAgentOption[]
  effortOptions: OpenCodeModelEffortOption[]
  selectedModel: OpenCodeModelOption | null
  selectedModelID: string | null
  setSelectedModelID: (value: string | null) => void
  selectedAgent: OpenCodeAgentOption | null
  selectedAgentID: string | null
  setSelectedAgentID: (value: string | null) => void
  selectedEffort: OpenCodeModelEffortOption | null
  selectedEffortID: string | null
  setSelectedEffortID: (value: string | null) => void
  modelHelperText: string
  modelErrorMessage: string | null
  isLoadingModels: boolean
  isLoadingAgents: boolean
  setPromptText: (value: string) => void
  startConversation: (
    onSuccess?: (sessionID: string, admittedPrompt: OpenCodeAdmittedPrompt) => void
  ) => void
}

export type OpenCodeSessionRouteState = {
  activeChat: ProjectChat | null
  messages: ChatMessage[]
  isAwaitingAssistantResponse: boolean
  promptText: string
  isLoading: boolean
  isSending: boolean
  isUndoingPrompt: boolean
  canSendPrompt: boolean
  canUndoPrompt: boolean
  emptyMessage: string | null
  transcriptStatusMessage: string | null
  errorMessage: string | null
  successMessage: string | null
  modelOptions: OpenCodeModelOption[]
  agentOptions: OpenCodeAgentOption[]
  effortOptions: OpenCodeModelEffortOption[]
  selectedModel: OpenCodeModelOption | null
  selectedModelID: string | null
  setSelectedModelID: (value: string | null) => void
  selectedAgent: OpenCodeAgentOption | null
  selectedAgentID: string | null
  setSelectedAgentID: (value: string | null) => void
  selectedEffort: OpenCodeModelEffortOption | null
  selectedEffortID: string | null
  setSelectedEffortID: (value: string | null) => void
  modelHelperText: string
  modelErrorMessage: string | null
  isLoadingModels: boolean
  isLoadingAgents: boolean
  setPromptText: (value: string) => void
  sendPrompt: () => void
  undoLastPrompt: () => void
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

export type {
  OpenCodeAdmittedPrompt,
  OpenCodeAgentOption,
  OpenCodeModelEffortOption,
  OpenCodeModelOption
}

export function useOpenCodeChatShell(
  onOpenedProject?: (project: OpenCodeChatOpenedProject) => void,
  onRemovedProject?: (project: ChatProject) => void
): OpenCodeChatShellState {
  const {
    status,
    connection,
    connectionQuery,
    projectsQuery,
    openProjectMutation,
    removeProjectFolderMutation
  } = useOpenCodeProjects()
  const events = useOpenCodeEvents()
  const [openedDirectory, setOpenedDirectory] = useState<string | null>(null)
  const [isSelectingProjectDirectory, setSelectingProjectDirectory] = useState(false)
  const [projectDirectorySelectionError, setProjectDirectorySelectionError] =
    useState<unknown>(null)
  const lastOpenedProjectId = useRef<string | null>(null)
  const openedProject = openProjectMutation.data ? mapOpenedProject(openProjectMutation.data) : null
  const heartbeatStatus = getHeartbeatStatus(connection, events)
  const isOpeningProject = openProjectMutation.isPending || isSelectingProjectDirectory
  const canSelectProjectDirectory = connection !== null && !isOpeningProject

  const selectProjectDirectory = useCallback(() => {
    if (connection === null || isOpeningProject) return

    setProjectDirectorySelectionError(null)
    setSelectingProjectDirectory(true)
    void window.api
      .selectProjectDirectory()
      .then((directory) => {
        if (!directory) return
        setOpenedDirectory(directory)
        openProjectMutation.mutate(directory)
      })
      .catch((error: unknown) => {
        setProjectDirectorySelectionError(error)
      })
      .finally(() => {
        setSelectingProjectDirectory(false)
      })
  }, [connection, isOpeningProject, openProjectMutation])

  useEffect(() => {
    if (!openedProject || lastOpenedProjectId.current === openedProject.id) return
    lastOpenedProjectId.current = openedProject.id
    onOpenedProject?.(openedProject)
  }, [onOpenedProject, openedProject])

  const projects = projectsQuery.data

  return {
    projects: useMemo(() => mapProjects(projects), [projects]),
    statusMessage: status.message,
    heartbeatStatus,
    isLoading: projectsQuery.isLoading,
    errorMessage: firstErrorMessage(
      connectionQuery.error,
      projectsQuery.error,
      projectDirectorySelectionError,
      openProjectMutation.error,
      removeProjectFolderMutation.error,
      events.error
    ),
    emptyMessage: getShellEmptyMessage(connection, projectsQuery.isSuccess, projects.length),
    openedProject,
    openProjectStatusMessage: getOpenProjectStatusMessage(
      openedDirectory,
      openProjectMutation.isPending,
      openProjectMutation.error,
      openProjectMutation.data
    ),
    canSelectProjectDirectory,
    removingProjectDirectory: removeProjectFolderMutation.isPending
      ? (removeProjectFolderMutation.variables ?? null)
      : null,
    selectProjectDirectory,
    removeOpenedProject: (project) => {
      if (!project.directory) return
      removeProjectFolderMutation.mutate(project.directory, {
        onSuccess: () => onRemovedProject?.(project)
      })
    }
  }
}

export function useOpenCodeProjectRoute(
  projectId: string | null | undefined
): OpenCodeProjectRouteState {
  const { connection, connectionQuery, projectsQuery } = useOpenCodeProjects()
  const projects = projectsQuery.data
  const selectedProject = resolveProject(projects, projectId)
  const selectedDirectory = selectedProject?.directory ?? null
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
    ),
    transcriptStatusMessage: getProjectTranscriptStatusMessage(
      connection,
      projectId,
      projectsQuery.isSuccess,
      selectedProject
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
  const [awaitingPrompts, setAwaitingPrompts] = useState<OpenCodeAdmittedPrompt[]>([])
  const queryClient = useQueryClient()
  const { sessionQuery } = useOpenCodeSession(directory, sessionID)
  const sessionStatusesQuery = useSessionStatuses(directory)
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
  const agents = useOpenCodeAgents(directory)
  const { sendPromptMutation, connection: sendConnection } = useSendOpenCodePrompt(
    directory,
    sessionID
  )
  const { undoPromptMutation, connection: undoConnection } = useUndoOpenCodePrompt(
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
  const isUndoingPrompt = undoPromptMutation.isPending
  const canSendToActiveSession = Boolean(sessionID) && activeSession !== null
  const revertMessageID = activeSession ? getSessionRevertMessageID(fetchedSession) : null

  const mappedMessages = useMemo(() => messages.map(mapMessage).filter(isChatMessage), [messages])
  const refetchMessages = messagesQuery.refetch
  const visibleStableMessages = useMemo(
    () => filterMessagesBeforeRevert(mappedMessages, revertMessageID),
    [mappedMessages, revertMessageID]
  )
  const visibleMessages = useMemo(
    () =>
      activeSession
        ? appendOptimisticPrompts(
            visibleStableMessages,
            optimisticPrompts,
            sessionID,
            revertMessageID
          )
        : [],
    [activeSession, optimisticPrompts, revertMessageID, sessionID, visibleStableMessages]
  )
  const isAwaitingAssistantResponse = useMemo(() => {
    const sessionStatus = sessionID ? sessionStatusesQuery.data?.[sessionID] : undefined
    if (sessionStatusesQuery.isSuccess && !sessionStatusesQuery.isFetching) {
      return isActiveSessionStatus(sessionStatus)
    }

    return (
      isActiveSessionStatus(sessionStatus) ||
      awaitingPrompts.some((prompt) =>
        isPromptAwaitingAssistantResponse(visibleMessages, prompt, sessionID)
      )
    )
  }, [
    awaitingPrompts,
    sessionID,
    sessionStatusesQuery.data,
    sessionStatusesQuery.isFetching,
    sessionStatusesQuery.isSuccess,
    visibleMessages
  ])
  const lastVisibleUserPrompt = useMemo(
    () => findLastVisibleUserPrompt(visibleMessages, sessionID),
    [sessionID, visibleMessages]
  )

  useEffect(() => {
    if (!admittedPrompt || admittedPrompt.sessionID !== sessionID) return
    setOptimisticPrompts((current) => {
      if (current.some((prompt) => promptKey(prompt) === promptKey(admittedPrompt))) return current
      return [...current, admittedPrompt]
    })
    setAwaitingPrompts((current) => addUniquePrompt(current, admittedPrompt))
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

  useEffect(() => {
    setAwaitingPrompts((current) => {
      const next = current.filter(
        (prompt) =>
          prompt.sessionID !== sessionID || !hasAssistantResponseForPrompt(visibleMessages, prompt)
      )
      return next.length === current.length ? current : next
    })
  }, [sessionID, visibleMessages])

  return {
    activeChat: activeSession,
    messages: visibleMessages,
    isAwaitingAssistantResponse,
    promptText,
    isLoading:
      (sessionQuery.isLoading && activeSessionFromList === null) || messagesQuery.isLoading,
    isSending,
    isUndoingPrompt,
    canSendPrompt:
      Boolean(directory) &&
      promptText.trim().length > 0 &&
      models.selectedModel !== null &&
      !agents.isLoading &&
      canSendToActiveSession &&
      sendConnection !== null &&
      !isSending &&
      !isUndoingPrompt,
    canUndoPrompt:
      Boolean(directory) &&
      canSendToActiveSession &&
      undoConnection !== null &&
      lastVisibleUserPrompt !== null &&
      !isUndoingPrompt,
    emptyMessage: getSessionEmptyMessage(
      sessionID,
      sessionQuery.isSuccess,
      activeSession,
      messagesQuery.isSuccess,
      mappedMessages.length
    ),
    transcriptStatusMessage: getSessionTranscriptStatusMessage(
      sessionID,
      sessionQuery.isSuccess,
      activeSession
    ),
    errorMessage: firstErrorMessage(
      activeSession ? null : sessionQuery.error,
      messagesQuery.error,
      sendPromptMutation.error,
      undoPromptMutation.error,
      sessionEventError?.message
    ),
    successMessage: null,
    modelOptions: models.options,
    agentOptions: agents.options,
    effortOptions: models.effortOptions,
    selectedModel: models.selectedModel,
    selectedModelID: models.selectedModelID,
    setSelectedModelID: models.setSelectedModelID,
    selectedAgent: agents.selectedAgent,
    selectedAgentID: agents.selectedAgentID,
    setSelectedAgentID: agents.setSelectedAgentID,
    selectedEffort: models.selectedEffort,
    selectedEffortID: models.selectedEffortID,
    setSelectedEffortID: models.setSelectedEffortID,
    modelHelperText: models.helperText,
    modelErrorMessage: models.errorMessage,
    isLoadingModels: models.isLoading,
    isLoadingAgents: agents.isLoading,
    setPromptText,
    sendPrompt: () => {
      const options = buildPromptOptions(
        promptText,
        models.selectedModel,
        agents.selectedAgentID,
        models.selectedEffortID
      )
      if (sessionID && activeSession) {
        sendPromptMutation.mutate(options, {
          onSuccess: (admittedPrompt) => {
            setOptimisticPrompts((current) => addUniquePrompt(current, admittedPrompt))
            setAwaitingPrompts((current) => addUniquePrompt(current, admittedPrompt))
            setPromptText('')
          }
        })
      }
    },
    undoLastPrompt: () => {
      if (!activeSession || !lastVisibleUserPrompt) return
      undoPromptMutation.mutate(
        { messageID: lastVisibleUserPrompt.messageID },
        {
          onSuccess: () => {
            setOptimisticPrompts((current) =>
              removePromptByMessageID(current, lastVisibleUserPrompt.messageID)
            )
            setAwaitingPrompts((current) =>
              removePromptByMessageID(current, lastVisibleUserPrompt.messageID)
            )
            setPromptText(lastVisibleUserPrompt.text)
          }
        }
      )
    }
  }
}

type UndoPromptTarget = {
  messageID: string
  text: string
}

function findLastVisibleUserPrompt(
  messages: ChatMessage[],
  sessionID: string | null | undefined
): UndoPromptTarget | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || message.author !== 'user') continue
    return {
      messageID: undoMessageID(message, sessionID),
      text: promptTextFromMessage(message)
    }
  }

  return null
}

function undoMessageID(message: ChatMessage, sessionID: string | null | undefined): string {
  const optimisticPrefix = sessionID ? `optimistic-${sessionID}-` : null
  if (optimisticPrefix && message.id.startsWith(optimisticPrefix)) {
    return message.id.slice(optimisticPrefix.length)
  }

  return message.id
}

function promptTextFromMessage(message: ChatMessage): string {
  const text = message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')

  return text || message.content
}

function filterMessagesBeforeRevert(
  messages: ChatMessage[],
  revertMessageID: string | null
): ChatMessage[] {
  if (!revertMessageID) return messages

  const revertIndex = messages.findIndex((message) => message.id === revertMessageID)
  if (revertIndex !== -1) return messages.slice(0, revertIndex)

  return messages.filter((message) => isMessageBeforeRevert(message.id, revertMessageID))
}

function isMessageBeforeRevert(messageID: string, revertMessageID: string | null): boolean {
  if (!revertMessageID) return true
  return messageID.localeCompare(revertMessageID) < 0
}

function getSessionRevertMessageID(
  session: OpenCodeSessionDetails | null | undefined
): string | null {
  const revert = getRecordProperty(session, 'revert')
  return getStringFromRecord(revert, 'messageID') ?? getStringFromRecord(session, 'revertMessageID')
}

function appendOptimisticPrompts(
  messages: ChatMessage[],
  optimisticPrompts: OpenCodeAdmittedPrompt[],
  sessionID: string | null | undefined,
  revertMessageID: string | null
): ChatMessage[] {
  const pending = optimisticPrompts.filter(
    (prompt) =>
      prompt.sessionID === sessionID &&
      isMessageBeforeRevert(prompt.id, revertMessageID) &&
      !messages.some(
        (message) => message.author === 'user' && isProjectedPromptMessage(message, prompt)
      )
  )
  if (pending.length === 0) return messages
  return [
    ...messages,
    ...pending.map((prompt) => ({
      id: optimisticPromptMessageID(prompt),
      author: 'user' as const,
      content: prompt.text,
      parts: [{ id: `optimistic-${prompt.id}-text`, type: 'text' as const, text: prompt.text }],
      createdAt: 'Pending'
    }))
  ]
}

function addUniquePrompt(
  prompts: OpenCodeAdmittedPrompt[],
  prompt: OpenCodeAdmittedPrompt
): OpenCodeAdmittedPrompt[] {
  if (prompts.some((current) => promptKey(current) === promptKey(prompt))) return prompts
  return [...prompts, prompt]
}

function promptKey(prompt: OpenCodeAdmittedPrompt): string {
  return `${prompt.sessionID}:${prompt.id}`
}

function removePromptByMessageID(
  prompts: OpenCodeAdmittedPrompt[],
  messageID: string
): OpenCodeAdmittedPrompt[] {
  return prompts.filter(
    (prompt) => prompt.id !== messageID && optimisticPromptMessageID(prompt) !== messageID
  )
}

function optimisticPromptMessageID(prompt: OpenCodeAdmittedPrompt): string {
  return `optimistic-${prompt.sessionID}-${prompt.id}`
}

function isPromptAwaitingAssistantResponse(
  messages: ChatMessage[],
  admittedPrompt: OpenCodeAdmittedPrompt,
  sessionID: string | null | undefined
): boolean {
  if (admittedPrompt.sessionID !== sessionID) return false
  return (
    findPromptMessageIndex(messages, admittedPrompt) !== -1 &&
    !hasAssistantResponseForPrompt(messages, admittedPrompt)
  )
}

function hasAssistantResponseForPrompt(
  messages: ChatMessage[],
  admittedPrompt: OpenCodeAdmittedPrompt
): boolean {
  const promptIndex = findPromptMessageIndex(messages, admittedPrompt)
  if (promptIndex === -1) return false

  return messages
    .slice(promptIndex + 1)
    .some(
      (message) =>
        message.author === 'assistant' &&
        (!message.parentID || message.parentID === admittedPrompt.id)
    )
}

function findPromptMessageIndex(
  messages: ChatMessage[],
  admittedPrompt: OpenCodeAdmittedPrompt
): number {
  return messages.findIndex(
    (message) =>
      message.author === 'user' &&
      (isProjectedPromptMessage(message, admittedPrompt) ||
        message.id === optimisticPromptMessageID(admittedPrompt))
  )
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
  const agents = useOpenCodeAgents(directory)
  const isSending = startConversationMutation.isPending

  return {
    promptText,
    isSending,
    canSendPrompt:
      Boolean(directory) &&
      promptText.trim().length > 0 &&
      models.selectedModel !== null &&
      !agents.isLoading &&
      connection !== null &&
      !isSending,
    errorMessage: firstErrorMessage(startConversationMutation.error, models.errorMessage),
    admittedPrompt,
    modelOptions: models.options,
    agentOptions: agents.options,
    effortOptions: models.effortOptions,
    selectedModel: models.selectedModel,
    selectedModelID: models.selectedModelID,
    setSelectedModelID: models.setSelectedModelID,
    selectedAgent: agents.selectedAgent,
    selectedAgentID: agents.selectedAgentID,
    setSelectedAgentID: agents.setSelectedAgentID,
    selectedEffort: models.selectedEffort,
    selectedEffortID: models.selectedEffortID,
    setSelectedEffortID: models.setSelectedEffortID,
    modelHelperText: models.helperText,
    modelErrorMessage: models.errorMessage,
    isLoadingModels: models.isLoading,
    isLoadingAgents: agents.isLoading,
    setPromptText,
    startConversation: (onSuccess) => {
      const options = buildPromptOptions(
        promptText,
        models.selectedModel,
        agents.selectedAgentID,
        models.selectedEffortID
      )
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
  const directory =
    getStringFromRecord(project, 'directory') ?? getStringFromRecord(project, 'worktree')
  if (directory) return getProjectDirectoryRouteId(directory)

  return getStringFromRecord(project, 'id') ?? `project-${index}`
}

function resolveProject(
  projects: OpenCodeOpenedProject[],
  projectId: string | null | undefined
): OpenCodeOpenedProject | null {
  if (!projectId) return null
  return projects.find((project, index) => getProjectRouteId(project, index) === projectId) ?? null
}

function mapOpenedProject(input: {
  folder: { directory: string }
  project: OpenCodeCurrentProject
}): OpenCodeChatOpenedProject {
  return {
    name: input.project.name ?? basename(input.folder.directory) ?? 'Unknown project',
    directory: input.folder.directory,
    id: getProjectDirectoryRouteId(input.folder.directory)
  }
}

function getOpenProjectStatusMessage(
  openedDirectory: string | null,
  isLoading: boolean,
  error: unknown,
  openedProject: { folder: { directory: string } } | undefined
): string | null {
  if (!openedDirectory) return null
  if (isLoading) return `Opening directory: ${openedDirectory}`
  if (error) return `Project open error: ${formatUnknownError(error)}`
  if (openedProject) return `Opened project: ${openedProject.folder.directory}`
  return null
}

function mapProjects(projects: OpenCodeOpenedProject[]): ChatProject[] {
  return projects.map(mapProject)
}

function mapSessionsToChats(sessions: OpenCodeSession[]): ProjectChat[] {
  return sessions.map(mapSessionToChat)
}

function mapProject(project: OpenCodeOpenedProject, index: number): ChatProject {
  return {
    id: getProjectRouteId(project, index),
    name: projectLabel(project, index),
    directory: project.directory
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

function mapMessage(message: unknown, index: number): ChatMessage | null {
  const normalized = normalizeOpenCodeMessage(message)
  if (!normalized) return null
  return {
    id: normalized.id ?? `message-${index}`,
    author: normalized.author,
    ...(normalized.parentID ? { parentID: normalized.parentID } : {}),
    content: normalized.content,
    parts: normalized.parts,
    createdAt: formatTime(normalized.createdAt)
  }
}

function isChatMessage(message: ChatMessage | null): message is ChatMessage {
  return message !== null
}

function buildPromptOptions(
  text: string,
  model: OpenCodeModelSelection | null,
  agent: string | null,
  variant: string | null
): OpenCodePromptOptions {
  return {
    text,
    model: model ? { providerID: model.providerID, modelID: model.modelID } : null,
    agent,
    variant
  }
}

function getShellEmptyMessage(
  connection: unknown,
  projectsLoaded: boolean,
  projectCount: number
): string | null {
  if (connection === null) return 'Waiting for the OpenCode sidecar connection.'
  if (projectsLoaded && projectCount === 0) return 'No opened project folders yet.'
  return null
}

function getHeartbeatStatus(
  connection: unknown,
  events: OpenCodeEventsState
): OpenCodeHeartbeatStatus {
  const eventErrorMessage =
    connection === null || !events.error ? null : formatUnknownError(events.error)
  const connected = connection !== null && events.listening && eventErrorMessage === null
  const stateText = connected ? 'OpenCode connected.' : 'OpenCode disconnected.'
  const streamText = getHeartbeatStreamText(connection, events, eventErrorMessage)
  const heartbeatText = events.lastEventAt
    ? `Last heartbeat: ${formatHeartbeatTimestamp(events.lastEventAt)}${events.lastEventType ? ` (${events.lastEventType})` : ''}.`
    : connected
      ? 'Waiting for the first heartbeat.'
      : 'No heartbeat received.'
  const detail = `${stateText} ${streamText} ${heartbeatText}`

  return {
    connected,
    ariaLabel: detail,
    title: detail
  }
}

function getHeartbeatStreamText(
  connection: unknown,
  events: OpenCodeEventsState,
  eventErrorMessage: string | null
): string {
  if (connection === null) return 'OpenCode sidecar connection is unavailable.'
  if (eventErrorMessage) return `Event stream error: ${eventErrorMessage}.`
  if (events.listening) return 'Listening for live events.'
  return 'Live events paused.'
}

function formatHeartbeatTimestamp(value: number): string {
  return new Date(value).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
  })
}

function getProjectEmptyMessage(
  connection: unknown,
  projectId: string | null | undefined,
  projectsLoaded: boolean,
  project: OpenCodeOpenedProject | null,
  sessionsLoaded: boolean,
  sessionCount: number
): string | null {
  if (connection === null) return 'Waiting for the OpenCode sidecar connection.'
  if (!projectId) return 'Select a project to view sessions.'
  if (projectsLoaded && !project) return 'Project not found.'
  if (sessionsLoaded && sessionCount === 0) return 'No sessions found for this project.'
  return null
}

function getProjectTranscriptStatusMessage(
  connection: unknown,
  projectId: string | null | undefined,
  projectsLoaded: boolean,
  project: OpenCodeOpenedProject | null
): string | null {
  if (!projectId) return null
  if (connection === null) return 'Waiting for the OpenCode sidecar connection.'
  if (projectsLoaded && !project) return 'Project not found.'
  return null
}

function getSessionEmptyMessage(
  sessionID: string | null | undefined,
  sessionLoaded: boolean,
  session: ProjectChat | null,
  messagesLoaded: boolean,
  messageCount: number
): string | null {
  if (!sessionID) return null
  if (sessionLoaded && !session) return 'Session not found.'
  if (messagesLoaded && messageCount === 0) return 'No messages found for this session.'
  return null
}

function getSessionTranscriptStatusMessage(
  sessionID: string | null | undefined,
  sessionLoaded: boolean,
  session: ProjectChat | null
): string | null {
  if (!sessionID) return null
  if (sessionLoaded && !session) return 'Session not found.'
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
function projectLabel(project: OpenCodeOpenedProject, index: number): string {
  return project.name || basename(project.directory) || project.id || `Project ${index + 1}`
}

function getProjectDirectoryRouteId(directory: string): string {
  return `dir-${base64UrlEncode(directory)}`
}

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
function basename(path: string | undefined): string | null {
  if (!path) return null
  const trimmed = path.replace(/[\\/]+$/, '')
  if (!trimmed) return null
  const parts = trimmed.split(/[\\/]/)
  return parts[parts.length - 1] || null
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
