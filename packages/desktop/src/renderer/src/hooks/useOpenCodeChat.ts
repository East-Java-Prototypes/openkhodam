import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useOpenCodeSdk, type createOpenCodeClient } from './opencode/client'
import {
  openCodeSessionQueryKey,
  projectSessionsQueryKey,
  sessionMessagesQueryKey,
  type OpenCodeSession
} from './useOpenCodeSessions'

type OpenCodeClient = ReturnType<typeof createOpenCodeClient>
type CreateSessionParameters = NonNullable<Parameters<OpenCodeClient['session']['create']>[0]>
type PromptAsyncParameters = Parameters<OpenCodeClient['session']['promptAsync']>[0]

export type OpenCodePromptOptions = {
  text: string
  agent?: string
  providerID?: string
  modelID?: string
}

export type OpenCodeCreateSessionOptions = Pick<CreateSessionParameters, 'agent' | 'model' | 'title'>

function modelFromOptions(options: OpenCodePromptOptions): PromptAsyncParameters['model'] | undefined {
  if (!options.providerID || !options.modelID) return undefined
  return { providerID: options.providerID, modelID: options.modelID }
}

export function useCreateOpenCodeSession(directory: string | null | undefined) {
  const queryClient = useQueryClient()
  const { status, statusQuery, connection, connectionQuery, client } = useOpenCodeSdk()

  const createSessionMutation = useMutation({
    mutationFn: async (options: OpenCodeCreateSessionOptions = {}): Promise<OpenCodeSession> => {
      if (connection === null) throw new Error('OpenCode sidecar is not connected.')
      if (!directory) throw new Error('Select a project before creating a session.')

      const response = await client!.session.create({
        directory,
        ...options
      })
      if (response.error) throw response.error
      if (!response.data) throw new Error('OpenCode did not return a created session.')
      return response.data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: projectSessionsQueryKey(status, directory) })
    }
  })

  return { status, statusQuery, connection, connectionQuery, createSessionMutation }
}

export function useSendOpenCodePrompt(directory: string | null | undefined, sessionID: string | null | undefined) {
  const queryClient = useQueryClient()
  const { status, statusQuery, connection, connectionQuery, client } = useOpenCodeSdk()

  const sendPromptMutation = useMutation({
    mutationFn: async (options: OpenCodePromptOptions) => {
      const text = options.text.trim()
      if (connection === null) throw new Error('OpenCode sidecar is not connected.')
      if (!directory) throw new Error('Select a project before sending a prompt.')
      if (!sessionID) throw new Error('Select a session before sending a prompt.')
      if (!text) throw new Error('Enter a prompt before sending.')

      const response = await client!.session.promptAsync({
        directory,
        sessionID,
        agent: options.agent || undefined,
        model: modelFromOptions(options),
        parts: [{ type: 'text', text }]
      })
      if (response.error) throw response.error
      return response.data
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectSessionsQueryKey(status, directory) }),
        queryClient.invalidateQueries({ queryKey: openCodeSessionQueryKey(status, directory, sessionID) }),
        queryClient.invalidateQueries({ queryKey: sessionMessagesQueryKey(status, directory, sessionID) })
      ])
    }
  })

  return { status, statusQuery, connection, connectionQuery, sendPromptMutation }
}

export function useStartOpenCodeConversation(directory: string | null | undefined) {
  const queryClient = useQueryClient()
  const { status, statusQuery, connection, connectionQuery, client } = useOpenCodeSdk()

  const startConversationMutation = useMutation({
    mutationFn: async (options: OpenCodePromptOptions): Promise<OpenCodeSession> => {
      const text = options.text.trim()
      if (connection === null) throw new Error('OpenCode sidecar is not connected.')
      if (!directory) throw new Error('Select a project before starting a session.')
      if (!text) throw new Error('Enter a prompt before starting a session.')

      const createResponse = await client!.session.create({
        directory,
        agent: options.agent || undefined,
        model: options.providerID && options.modelID ? { providerID: options.providerID, id: options.modelID } : undefined
      })
      if (createResponse.error) throw createResponse.error
      if (!createResponse.data) throw new Error('OpenCode did not return a created session.')

      const sessionID = getSessionId(createResponse.data)
      if (!sessionID) throw new Error('OpenCode did not return a session ID.')

      const promptResponse = await client!.session.promptAsync({
        directory,
        sessionID,
        agent: options.agent || undefined,
        model: modelFromOptions(options),
        parts: [{ type: 'text', text }]
      })
      if (promptResponse.error) throw promptResponse.error

      return createResponse.data
    },
    onSuccess: async (session) => {
      const sessionID = getSessionId(session)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectSessionsQueryKey(status, directory) }),
        queryClient.invalidateQueries({ queryKey: openCodeSessionQueryKey(status, directory, sessionID) }),
        queryClient.invalidateQueries({ queryKey: sessionMessagesQueryKey(status, directory, sessionID) })
      ])
    }
  })

  return { status, statusQuery, connection, connectionQuery, startConversationMutation }
}

function getSessionId(session: OpenCodeSession): string | null {
  if (typeof session !== 'object' || session === null) return null
  const id = (session as Record<string, unknown>).id ?? (session as Record<string, unknown>).sessionID
  return typeof id === 'string' && id.length > 0 ? id : null
}
