import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useOpenCodeSdk, type createOpenCodeClient } from './opencode/client'
import { Identifier } from './opencode/id'
import {
  openCodeSessionQueryKey,
  projectSessionsQueryKey,
  sessionMessagesQueryKey
} from './useOpenCodeSessions'
import type { OpenCodeModelSelection } from './useOpenCodeModels'

type OpenCodeClient = ReturnType<typeof createOpenCodeClient>
type SessionCreateParameters = Parameters<OpenCodeClient['session']['create']>[0]

export type OpenCodePromptOptions = {
  text: string
  model: OpenCodeModelSelection | null
  agent: string | null
  variant: string | null
}

export type OpenCodeAdmittedPrompt = {
  id: string
  sessionID: string
  text: string
}

export function useSendOpenCodePrompt(
  directory: string | null | undefined,
  sessionID: string | null | undefined
) {
  const queryClient = useQueryClient()
  const { status, statusQuery, connection, connectionQuery, client } = useOpenCodeSdk()

  const sendPromptMutation = useMutation({
    mutationFn: async (options: OpenCodePromptOptions) => {
      const text = options.text.trim()
      if (connection === null) throw new Error('OpenCode sidecar is not connected.')
      if (!directory) throw new Error('Select a project before sending a prompt.')
      if (!sessionID) throw new Error('Select a session before sending a prompt.')
      if (!text) throw new Error('Enter a prompt before sending.')
      if (!options.model) throw new Error('Select a connected OpenCode model before sending.')

      const messageID = createOptimisticMessageID()
      const response = await client!.session.promptAsync({
        sessionID,
        messageID,
        model: options.model,
        ...(options.agent ? { agent: options.agent } : {}),
        ...(options.variant ? { variant: options.variant } : {}),
        parts: [createTextPart(text)]
      })
      if (response.error) throw response.error
      return {
        id: messageID,
        sessionID,
        text
      } satisfies OpenCodeAdmittedPrompt
    },
    onSuccess: async ({ sessionID }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectSessionsQueryKey(status, directory) }),
        queryClient.invalidateQueries({
          queryKey: openCodeSessionQueryKey(status, directory, sessionID)
        }),
        queryClient.invalidateQueries({
          queryKey: sessionMessagesQueryKey(status, directory, sessionID)
        })
      ])
    }
  })

  return { status, statusQuery, connection, connectionQuery, sendPromptMutation }
}

export function useStartOpenCodeConversation(directory: string | null | undefined) {
  const queryClient = useQueryClient()
  const { status, statusQuery, connection, connectionQuery, client } = useOpenCodeSdk()

  const startConversationMutation = useMutation({
    mutationFn: async (options: OpenCodePromptOptions) => {
      const text = options.text.trim()
      if (connection === null) throw new Error('OpenCode sidecar is not connected.')
      if (!directory) throw new Error('Select a project before starting a conversation.')
      if (!text) throw new Error('Enter a prompt before sending.')
      if (!options.model) throw new Error('Select a connected OpenCode model before sending.')

      const createResponse = await client!.session.create(
        createSessionParameters(directory, options)
      )
      if (createResponse.error) throw createResponse.error
      if (!createResponse.data?.id) throw new Error('OpenCode did not return a session id.')

      const sessionID = createResponse.data.id
      const messageID = createOptimisticMessageID()
      const promptResponse = await client!.session.promptAsync({
        sessionID,
        messageID,
        model: options.model,
        ...(options.agent ? { agent: options.agent } : {}),
        ...(options.variant ? { variant: options.variant } : {}),
        parts: [createTextPart(text)]
      })
      if (promptResponse.error) throw promptResponse.error

      return {
        sessionID,
        session: createResponse.data,
        id: messageID,
        text
      }
    },
    onSettled: async (_data, _error, _variables, _context) => {
      await queryClient.invalidateQueries({ queryKey: projectSessionsQueryKey(status, directory) })
    },
    onSuccess: async ({ sessionID }) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: openCodeSessionQueryKey(status, directory, sessionID)
        }),
        queryClient.invalidateQueries({
          queryKey: sessionMessagesQueryKey(status, directory, sessionID)
        })
      ])
    }
  })

  return { status, statusQuery, connection, connectionQuery, startConversationMutation }
}

function createOptimisticMessageID(): string {
  return Identifier.ascending('message')
}

function createSessionParameters(
  directory: string,
  options: OpenCodePromptOptions
): SessionCreateParameters {
  return {
    directory,
    ...(options.agent ? { agent: options.agent } : {}),
    ...(options.model
      ? {
          model: {
            id: options.model.modelID,
            providerID: options.model.providerID,
            ...(options.variant ? { variant: options.variant } : {})
          }
        }
      : {})
  }
}

function createPartID(): string {
  return Identifier.ascending('part')
}

function createTextPart(text: string) {
  return {
    id: createPartID(),
    type: 'text' as const,
    text
  }
}
