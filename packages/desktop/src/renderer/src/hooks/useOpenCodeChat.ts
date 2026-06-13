import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useOpenCodeSdk, type createOpenCodeClient } from './opencode/client'
import {
  openCodeSessionQueryKey,
  projectSessionsQueryKey,
  sessionMessagesQueryKey
} from './useOpenCodeSessions'

type OpenCodeClient = ReturnType<typeof createOpenCodeClient>
type PromptAsyncParameters = Parameters<OpenCodeClient['session']['promptAsync']>[0]

export type OpenCodePromptOptions = {
  text: string
  agent?: string
  providerID?: string
  modelID?: string
}

function modelFromOptions(options: OpenCodePromptOptions): PromptAsyncParameters['model'] | undefined {
  if (!options.providerID || !options.modelID) return undefined
  return { providerID: options.providerID, modelID: options.modelID }
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
        noReply: true,
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
