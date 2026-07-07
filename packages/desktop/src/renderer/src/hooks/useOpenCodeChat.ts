import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useOpenCodeSdk, type createOpenCodeClient } from './opencode/client'
import { Identifier } from './opencode/id'
import {
  openCodeSessionQueryKey,
  projectSessionsQueryKey,
  sessionStatusQueryKey,
  sessionMessagesQueryKey
} from './useOpenCodeSessions'
import type { OpenCodeModelSelection } from './useOpenCodeModels'

type OpenCodeClient = ReturnType<typeof createOpenCodeClient>
type OpenCodeStatusSnapshot = Parameters<typeof projectSessionsQueryKey>[0]
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

export type OpenCodeUndoPromptOptions = {
  messageID: string
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
        queryClient.invalidateQueries({ queryKey: sessionStatusQueryKey(status, directory) }),
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectSessionsQueryKey(status, directory) }),
        queryClient.invalidateQueries({ queryKey: sessionStatusQueryKey(status, directory) })
      ])
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

export function useAbortOpenCodeSession(
  directory: string | null | undefined,
  sessionID: string | null | undefined
) {
  const queryClient = useQueryClient()
  const { status, statusQuery, connection, connectionQuery, client } = useOpenCodeSdk()

  const abortSessionMutation = useMutation({
    mutationFn: async () => {
      if (connection === null) throw new Error('OpenCode sidecar is not connected.')
      if (!directory) throw new Error('Select a project before stopping generation.')
      if (!sessionID) throw new Error('Select a session before stopping generation.')

      const response = await client!.session.abort({ sessionID, directory })
      if (response.error) throw response.error
      return { aborted: response.data === true, sessionID }
    },
    onSettled: async () => {
      await invalidateSessionRunQueries(queryClient, status, directory, sessionID)
    }
  })

  return { status, statusQuery, connection, connectionQuery, abortSessionMutation }
}

export function useUndoOpenCodePrompt(
  directory: string | null | undefined,
  sessionID: string | null | undefined
) {
  const queryClient = useQueryClient()
  const { status, statusQuery, connection, connectionQuery, client } = useOpenCodeSdk()

  const undoPromptMutation = useMutation({
    mutationFn: async (options: OpenCodeUndoPromptOptions) => {
      if (connection === null) throw new Error('OpenCode sidecar is not connected.')
      if (!directory) throw new Error('Select a project before undoing a prompt.')
      if (!sessionID) throw new Error('Select a session before undoing a prompt.')
      if (!options.messageID) throw new Error('Select a prompt to undo.')

      await client!.session.abort({ sessionID, directory }).catch(() => undefined)

      const response = await client!.session.revert({
        sessionID,
        directory,
        messageID: options.messageID
      })
      if (response.error) throw response.error

      return {
        sessionID,
        messageID: options.messageID,
        session: response.data
      }
    },
    onSuccess: async ({ sessionID, session }) => {
      if (session) {
        queryClient.setQueryData(openCodeSessionQueryKey(status, directory, sessionID), session)
      }

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

  return { status, statusQuery, connection, connectionQuery, undoPromptMutation }
}

async function invalidateSessionRunQueries(
  queryClient: QueryClient,
  status: OpenCodeStatusSnapshot,
  directory: string | null | undefined,
  sessionID: string | null | undefined
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: projectSessionsQueryKey(status, directory) }),
    queryClient.invalidateQueries({ queryKey: sessionStatusQueryKey(status, directory) }),
    queryClient.invalidateQueries({
      queryKey: openCodeSessionQueryKey(status, directory, sessionID)
    }),
    queryClient.invalidateQueries({
      queryKey: sessionMessagesQueryKey(status, directory, sessionID)
    })
  ])
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
