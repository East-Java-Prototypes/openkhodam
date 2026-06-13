import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { GlobalEvent } from '@opencode-ai/sdk/v2'

import { useOpenCodeSdk } from './opencode/client'
import { openCodeProjectQueryKeys } from './opencode/projects'
import { openCodeQueryKeys } from './opencode/sidecar'
import {
  openCodeSessionQueryKey,
  projectSessionsQueryKey,
  sessionMessagesQueryKey
} from './useOpenCodeSessions'

export type OpenCodeEventsState = {
  listening: boolean
  lastEventType: string | null
  lastEventAt: number | null
  error: unknown
}

type OpenCodeEventPayload = GlobalEvent['payload']

export function useOpenCodeEvents(): OpenCodeEventsState {
  const queryClient = useQueryClient()
  const { status, connection, client } = useOpenCodeSdk()
  const statusUrl = status.url
  const statusPid = status.pid
  const statusUpdatedAt = status.updatedAt
  const [state, setState] = useState<OpenCodeEventsState>({
    listening: false,
    lastEventType: null,
    lastEventAt: null,
    error: null
  })

  useEffect(() => {
    if (connection === null) {
      setState((current) => ({ ...current, listening: false }))
      return
    }

    let cancelled = false
    const controller = new AbortController()
    const statusSnapshot = { url: statusUrl, pid: statusPid, updatedAt: statusUpdatedAt }

    setState((current) => ({ ...current, listening: true, error: null }))

    void (async () => {
      try {
        const events = await client!.global.event({
          signal: controller.signal,
          sseMaxRetryAttempts: 3
        })

        for await (const event of events.stream) {
          if (cancelled) break
          invalidateForEvent(queryClient, statusSnapshot, event)
          logEventError(event)
          setState({
            listening: true,
            lastEventType: getEventType(event),
            lastEventAt: Date.now(),
            error: null
          })
        }
        if (!cancelled) setState((current) => ({ ...current, listening: false }))
      } catch (error) {
        if (!cancelled) setState((current) => ({ ...current, listening: false, error }))
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
      setState((current) => ({ ...current, listening: false }))
    }
  }, [client, connection, queryClient, statusPid, statusUpdatedAt, statusUrl])

  return state
}

function invalidateForEvent(
  queryClient: ReturnType<typeof useQueryClient>,
  status: { url: string | null; pid: number | null; updatedAt: number },
  event: GlobalEvent
) {
  const type = getEventType(event)
  const directory = event.directory || null
  const sessionID = getSessionID(event.payload)

  if (
    type.startsWith('project.') ||
    type.startsWith('workspace.') ||
    type.startsWith('worktree.')
  ) {
    void queryClient.invalidateQueries({
      queryKey: openCodeProjectQueryKeys.list(status.url, status.pid, status.updatedAt)
    })
  }

  if (type.startsWith('session.') || type.startsWith('message.')) {
    if (!directory) {
      void queryClient.invalidateQueries({ queryKey: openCodeQueryKeys.all })
      return
    }

    void queryClient.invalidateQueries({ queryKey: projectSessionsQueryKey(status, directory) })
    if (sessionID) {
      void queryClient.invalidateQueries({
        queryKey: openCodeSessionQueryKey(status, directory, sessionID)
      })
      void queryClient.invalidateQueries({
        queryKey: sessionMessagesQueryKey(status, directory, sessionID)
      })
    }
  }
}

function getEventType(event: GlobalEvent): string {
  return typeof event.payload.type === 'string' ? event.payload.type : 'unknown'
}

function getSessionID(payload: OpenCodeEventPayload): string | null {
  const properties = 'properties' in payload ? payload.properties : undefined
  if (typeof properties !== 'object' || properties === null) return null
  const sessionID = (properties as Record<string, unknown>).sessionID
  return typeof sessionID === 'string' && sessionID.length > 0 ? sessionID : null
}

function logEventError(event: GlobalEvent): void {
  const error = getEventError(event.payload)
  if (!error) return

  console.warn('[opencode] Event error', {
    type: getEventType(event),
    directory: event.directory ?? null,
    sessionID: getSessionID(event.payload),
    error: formatEventError(error)
  })
}

function getEventError(payload: OpenCodeEventPayload): unknown {
  const properties = 'properties' in payload ? payload.properties : undefined
  if (typeof properties !== 'object' || properties === null) return null
  return (properties as Record<string, unknown>).error ?? null
}

function formatEventError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (typeof error !== 'object' || error === null) return String(error)

  const record = error as Record<string, unknown>
  const data =
    typeof record.data === 'object' && record.data !== null
      ? (record.data as Record<string, unknown>)
      : null
  const message =
    getString(record, 'message') ??
    getString(data, 'message') ??
    getString(record, 'name') ??
    getString(record, '_tag')
  return message ?? JSON.stringify(error)
}

function getString(record: Record<string, unknown> | null, property: string): string | null {
  const value = record?.[property]
  return typeof value === 'string' && value.length > 0 ? value : null
}
