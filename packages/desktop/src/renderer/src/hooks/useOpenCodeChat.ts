import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useOpenCodeSdk } from './opencode/client'
import {
  openCodeSessionQueryKey,
  projectSessionsQueryKey,
  sessionMessagesQueryKey
} from './useOpenCodeSessions'
import type { OpenCodeModelSelection } from './useOpenCodeModels'

const ascendingIdLength = 26
let lastAscendingTimestamp = 0
let ascendingCounter = 0

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
  return createOpenCodeID('msg')
}

function createPartID(): string {
  return createOpenCodeID('prt')
}

function createOpenCodeID(prefix: 'msg' | 'prt'): string {
  const currentTimestamp = Date.now()
  if (currentTimestamp !== lastAscendingTimestamp) {
    lastAscendingTimestamp = currentTimestamp
    ascendingCounter = 0
  }
  ascendingCounter += 1

  const sortable = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(ascendingCounter)
  const timeBytes = new Uint8Array(6)
  for (let i = 0; i < 6; i += 1) {
    timeBytes[i] = Number((sortable >> BigInt(40 - 8 * i)) & BigInt(0xff))
  }

  return `${prefix}_${bytesToHex(timeBytes)}${randomBase62(ascendingIdLength - 12)}`
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0')
  }
  return hex
}

function randomBase62(length: number): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  const bytes = getRandomBytes(length)
  let result = ''
  for (let i = 0; i < length; i += 1) {
    result += chars[bytes[i] % 62]
  }
  return result
}

function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  const cryptoObject = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (cryptoObject && typeof cryptoObject.getRandomValues === 'function') {
    cryptoObject.getRandomValues(bytes)
    return bytes
  }
  for (let i = 0; i < length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256)
  }
  return bytes
}

function createTextPart(text: string) {
  return {
    id: createPartID(),
    type: 'text' as const,
    text
  }
}
