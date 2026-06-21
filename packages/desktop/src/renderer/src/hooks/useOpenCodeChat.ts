import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useOpenCodeSdk } from './opencode/client'
import { Identifier } from './opencode/id'
import { generateOpenCodeSessionTitle } from './opencode/session-title-generation'
import {
  openCodeSessionQueryKey,
  projectSessionsQueryKey,
  sessionMessagesQueryKey
} from './useOpenCodeSessions'
import type { OpenCodeModelSelection } from './useOpenCodeModels'

export type OpenCodePromptOptions = {
  text: string
  model: OpenCodeModelSelection | null
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
    },
    onSettled: (_data, _error, options) => {
      if (_data && client && directory && options.model) {
        void generateOpenCodeSessionTitle({
          client,
          queryClient,
          status,
          directory,
          sessionID: _data.sessionID,
          promptText: _data.text,
          model: options.model
        })
      }
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

      const createResponse = await client!.session.create({
        directory
      })
      if (createResponse.error) throw createResponse.error
      if (!createResponse.data?.id) throw new Error('OpenCode did not return a session id.')

      const sessionID = createResponse.data.id
      const messageID = createOptimisticMessageID()
      const promptResponse = await client!.session.promptAsync({
        sessionID,
        messageID,
        model: options.model,
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
    onSettled: async (_data, _error, options) => {
      await queryClient.invalidateQueries({ queryKey: projectSessionsQueryKey(status, directory) })
      if (_data && client && directory && options.model) {
        void generateOpenCodeSessionTitle({
          client,
          queryClient,
          status,
          directory,
          sessionID: _data.sessionID,
          promptText: _data.text,
          model: options.model
        })
      }
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
