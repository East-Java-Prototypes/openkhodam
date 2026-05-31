import { Link, createFileRoute } from '@tanstack/react-router'
import type { JSX } from 'react'
import { useMemo, useState } from 'react'

import {
  type OpenCodePromptOptions,
  useSendOpenCodePrompt,
  useStartOpenCodeConversation
} from '../hooks/useOpenCodeChat'
import { type OpenCodeProject, useOpenCodeProjects } from '../hooks/opencode/projects'
import {
  type OpenCodeSession,
  type OpenCodeSessionDetails,
  type OpenCodeSessionMessage,
  useOpenCodeSession,
  useProjectSessions,
  useSessionMessages
} from '../hooks/useOpenCodeSessions'

export const Route = createFileRoute('/')({ component: IndexRoute })

function IndexRoute(): JSX.Element {
  const { status, connection, connectionQuery, projectsQuery } = useOpenCodeProjects()
  const [selectedDirectory, setSelectedDirectory] = useState<string | null>(null)
  const [selectedSessionID, setSelectedSessionID] = useState<string | null>(null)
  const [promptText, setPromptText] = useState('')
  const [agent, setAgent] = useState('')
  const [providerID, setProviderID] = useState('')
  const [modelID, setModelID] = useState('')
  const { sessionsQuery } = useProjectSessions(selectedDirectory)
  const { sessionQuery } = useOpenCodeSession(selectedDirectory, selectedSessionID)
  const { messagesQuery } = useSessionMessages(selectedDirectory, selectedSessionID)
  const { sendPromptMutation, connection: sendConnection } = useSendOpenCodePrompt(selectedDirectory, selectedSessionID)
  const { startConversationMutation, connection: startConnection } = useStartOpenCodeConversation(selectedDirectory)
  const projects = projectsQuery.data ?? []
  const sessions = sessionsQuery.data ?? []
  const messages = messagesQuery.data ?? []
  const isPromptBlank = promptText.trim().length === 0
  const isChatPending = sendPromptMutation.isPending || startConversationMutation.isPending
  const selectedProject = useMemo(
    () => projects.find((project) => project.worktree === selectedDirectory),
    [projects, selectedDirectory]
  )

  return (
    <main>
      <h1>Projects</h1>
      <p>OpenKhodam desktop is running.</p>

      <section>
        <h2>OpenCode sidecar</h2>
        <p>
          Status: <strong>{status.state}</strong>
          {status.message ? ` — ${status.message}` : null}
        </p>
        {status.state === 'connected' && connection === null ? <p>Loading connection details...</p> : null}
        {connectionQuery.isError ? <p>Connection error: {formatError(connectionQuery.error)}</p> : null}
      </section>

      <section>
        <h2>Prompt</h2>
        {!selectedDirectory ? <p>Select a project before starting or continuing a chat.</p> : null}
        {selectedDirectory && sendConnection === null && startConnection === null ? (
          <p>Waiting for an OpenCode sidecar connection before sending prompts.</p>
        ) : null}
        <form
          onSubmit={(event) => {
            event.preventDefault()
          }}
        >
          <p>
            <label>
              Prompt
              <br />
              <textarea value={promptText} onChange={(event) => setPromptText(event.currentTarget.value)} rows={4} cols={80} />
            </label>
          </p>
          <p>
            <label>
              Agent (optional)
              <br />
              <input value={agent} onChange={(event) => setAgent(event.currentTarget.value)} placeholder="default" />
            </label>
          </p>
          <p>
            <label>
              Provider (optional)
              <br />
              <input value={providerID} onChange={(event) => setProviderID(event.currentTarget.value)} placeholder="provider ID" />
            </label>
          </p>
          <p>
            <label>
              Model (optional)
              <br />
              <input value={modelID} onChange={(event) => setModelID(event.currentTarget.value)} placeholder="model ID" />
            </label>
          </p>
          <button
            type="button"
            disabled={!selectedDirectory || !selectedSessionID || isPromptBlank || sendConnection === null || isChatPending}
            onClick={() => {
              sendPromptMutation.mutate(buildPromptOptions(promptText, agent, providerID, modelID), {
                onSuccess: () => setPromptText('')
              })
            }}
          >
            Send to selected session
          </button>{' '}
          <button
            type="button"
            disabled={!selectedDirectory || isPromptBlank || startConnection === null || isChatPending}
            onClick={() => {
              startConversationMutation.mutate(buildPromptOptions(promptText, agent, providerID, modelID), {
                onSuccess: (session) => {
                  setSelectedSessionID(getSessionId(session))
                  setPromptText('')
                }
              })
            }}
          >
            Start new session
          </button>
        </form>
        {sendPromptMutation.isError ? <p>Prompt send error: {formatError(sendPromptMutation.error)}</p> : null}
        {startConversationMutation.isError ? <p>New session prompt error: {formatError(startConversationMutation.error)}</p> : null}
        {sendPromptMutation.isSuccess ? <p>Prompt sent. Messages will refresh shortly.</p> : null}
        {startConversationMutation.isSuccess ? <p>Session started and prompt sent. Messages will refresh shortly.</p> : null}
      </section>

      <section>
        <h2>OpenCode projects</h2>
        {connection === null ? <p>Waiting for an OpenCode sidecar connection before loading projects.</p> : null}
        {projectsQuery.isLoading ? <p>Loading projects...</p> : null}
        {projectsQuery.isError ? <p>Project load error: {formatError(projectsQuery.error)}</p> : null}
        {projectsQuery.isSuccess && projects.length === 0 ? <p>No projects found.</p> : null}
        {projects.length > 0 ? (
          <ul>
            {projects.map((project, index) => {
              const label = projectLabel(project, index)
              const isSelected = project.worktree === selectedDirectory

              return (
                <li key={project.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDirectory(project.worktree)
                      setSelectedSessionID(null)
                    }}
                  >
                    {isSelected ? 'Selected: ' : 'Select '}
                    {label}
                  </button>
                  <dl>
                    <dt>Directory</dt>
                    <dd>{project.worktree}</dd>
                    <dt>Worktree</dt>
                    <dd>{project.worktree}</dd>
                    <dt>ID</dt>
                    <dd>{project.id}</dd>
                  </dl>
                </li>
              )
            })}
          </ul>
        ) : null}
        {selectedDirectory ? (
          <p>
            Selected directory: <code>{selectedDirectory}</code>
            {selectedProject ? null : ' (project no longer in list)'}
          </p>
        ) : null}
      </section>

      <section>
        <h2>Project sessions</h2>
        {!selectedDirectory ? <p>Select a project to load sessions.</p> : null}
        {selectedDirectory && connection === null ? <p>Waiting for an OpenCode sidecar connection before loading sessions.</p> : null}
        {sessionsQuery.isLoading ? <p>Loading sessions...</p> : null}
        {sessionsQuery.isError ? <p>Session load error: {formatError(sessionsQuery.error)}</p> : null}
        {sessionsQuery.isSuccess && sessions.length === 0 ? <p>No root sessions found for this project.</p> : null}
        {sessions.length > 0 ? (
          <ul>
            {sessions.map((session, index) => {
              const sessionID = getSessionId(session)
              const title = getSessionTitle(session) ?? sessionID ?? `Session ${index + 1}`
              const isSelected = sessionID !== null && sessionID === selectedSessionID

              return (
                <li key={sessionID ?? index}>
                  <button type="button" onClick={() => setSelectedSessionID(sessionID)} disabled={!sessionID}>
                    {isSelected ? 'Selected: ' : 'Select '}
                    {title}
                  </button>
                  <dl>
                    <dt>ID</dt>
                    <dd>{sessionID ?? 'Unknown'}</dd>
                    <dt>Updated</dt>
                    <dd>{getSessionTime(session) ?? 'Unknown'}</dd>
                  </dl>
                </li>
              )
            })}
          </ul>
        ) : null}
      </section>

      <section>
        <h2>Selected session</h2>
        {!selectedSessionID ? <p>Select a session to load details and messages.</p> : null}
        {sessionQuery.isLoading ? <p>Loading session details...</p> : null}
        {sessionQuery.isError ? <p>Session detail error: {formatError(sessionQuery.error)}</p> : null}
        {sessionQuery.data ? <SessionDetails session={sessionQuery.data} /> : null}
        {messagesQuery.isLoading ? <p>Loading messages...</p> : null}
        {messagesQuery.isError ? <p>Message load error: {formatError(messagesQuery.error)}</p> : null}
        {messagesQuery.isSuccess && messages.length === 0 ? <p>No messages found for this session.</p> : null}
        {messages.length > 0 ? (
          <ol>
            {messages.map((message, index) => (
              <li key={getMessageId(message) ?? index}>
                <MessageSummary message={message} />
              </li>
            ))}
          </ol>
        ) : null}
      </section>

      <Link to="/settings">Open settings</Link>
    </main>
  )
}

function SessionDetails({ session }: { session: OpenCodeSessionDetails }): JSX.Element {
  return (
    <dl>
      <dt>ID</dt>
      <dd>{getSessionId(session) ?? 'Unknown'}</dd>
      <dt>Title</dt>
      <dd>{getSessionTitle(session) ?? 'Untitled'}</dd>
      <dt>Updated</dt>
      <dd>{getSessionTime(session) ?? 'Unknown'}</dd>
    </dl>
  )
}

function MessageSummary({ message }: { message: OpenCodeSessionMessage }): JSX.Element {
  return (
    <article>
      <header>
        <strong>{getMessageRole(message) ?? getMessageType(message) ?? 'Message'}</strong>
        {getMessageTime(message) ? ` — ${getMessageTime(message)}` : null}
      </header>
      <p>{getMessageText(message)}</p>
    </article>
  )
}

function buildPromptOptions(text: string, agent: string, providerID: string, modelID: string): OpenCodePromptOptions {
  return {
    text,
    agent: nonEmptyTrimmed(agent),
    providerID: nonEmptyTrimmed(providerID),
    modelID: nonEmptyTrimmed(modelID)
  }
}

function nonEmptyTrimmed(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
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

function getMessageType(message: OpenCodeSessionMessage): string | null {
  const info = getRecordProperty(message, 'info')
  return getStringFromRecord(info, 'type') ?? getStringFromRecord(message, 'type')
}

function getMessageTime(message: OpenCodeSessionMessage): string | null {
  const info = getRecordProperty(message, 'info')
  return getStringFromRecord(info, 'time') ?? getStringFromRecord(info, 'createdAt') ?? getStringFromRecord(message, 'time')
}

function getMessageText(message: OpenCodeSessionMessage): string {
  const direct = getStringFromRecord(message, 'text') ?? getStringFromRecord(message, 'content')
  if (direct) return direct

  const parts = getArrayProperty(message, 'parts') ?? getArrayProperty(getRecordProperty(message, 'info'), 'parts')
  if (!parts || parts.length === 0) return 'No text content.'

  const text = parts.map(formatMessagePart).filter(Boolean).join('\n')
  return text || `${parts.length} non-text message part${parts.length === 1 ? '' : 's'}.`
}

function formatMessagePart(part: unknown): string {
  if (typeof part === 'string') return part
  if (!isRecord(part)) return ''

  const text = getStringFromRecord(part, 'text') ?? getStringFromRecord(part, 'content')
  if (text) return text

  const type = getStringFromRecord(part, 'type') ?? 'part'
  return `[${type}]`
}

function getStringFromRecord(value: unknown, property: string): string | null {
  if (!isRecord(value) || !(property in value)) return null
  const propertyValue = value[property]
  return typeof propertyValue === 'string' && propertyValue.length > 0 ? propertyValue : null
}

function getRecordProperty(value: unknown, property: string): Record<string, unknown> | null {
  if (!isRecord(value) || !isRecord(value[property])) return null
  return value[property]
}

function getArrayProperty(value: unknown, property: string): unknown[] | null {
  if (!isRecord(value) || !Array.isArray(value[property])) return null
  return value[property]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
