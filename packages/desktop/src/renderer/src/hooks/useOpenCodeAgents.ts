import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { useOpenCodeSdk, type createOpenCodeClient } from './opencode/client'
import { openCodeQueryKeys } from './opencode/sidecar'

type OpenCodeClient = ReturnType<typeof createOpenCodeClient>
type AgentListResponse = NonNullable<
  Awaited<ReturnType<OpenCodeClient['v2']['agent']['list']>>['data']
>

export type OpenCodeAgentOption = {
  id: string
  label: string
  description: string | null
  mode: 'primary' | 'all'
}

export function useOpenCodeAgents(directory: string | null | undefined) {
  const { status, statusQuery, connection, connectionQuery, client } = useOpenCodeSdk()
  const [selectedAgentID, setSelectedAgentID] = useState<string | null>(null)

  const agentsQuery = useQuery({
    queryKey: [
      ...openCodeQueryKeys.all,
      'agents',
      status.url,
      status.pid,
      status.updatedAt,
      directory
    ],
    queryFn: async (): Promise<AgentListResponse> => {
      const response = await client!.v2.agent.list({ location: { directory: directory! } })
      if (response.error) throw response.error
      return response.data!
    },
    enabled: client !== null && Boolean(directory)
  })

  const options = useMemo(() => normalizeAgentOptions(agentsQuery.data), [agentsQuery.data])
  const selectedAgent = options.find((option) => option.id === selectedAgentID) ?? options[0] ?? null
  const effectiveSelectedAgentID = selectedAgent?.id ?? null

  useEffect(() => {
    setSelectedAgentID((current) => {
      if (current && options.some((option) => option.id === current)) return current
      return options[0]?.id ?? null
    })
  }, [options])

  return {
    status,
    statusQuery,
    connection,
    connectionQuery,
    agentsQuery,
    options,
    selectedAgent,
    selectedAgentID: effectiveSelectedAgentID,
    setSelectedAgentID,
    isLoading: agentsQuery.isLoading,
    errorMessage: agentsQuery.error ? formatUnknownError(agentsQuery.error) : null
  }
}

function normalizeAgentOptions(data: AgentListResponse | undefined): OpenCodeAgentOption[] {
  if (!isRecord(data)) return []
  return getArray(data.data)
    .filter(isRecord)
    .filter((agent) => {
      const mode = getString(agent.mode)
      return agent.hidden !== true && (mode === 'primary' || mode === 'all')
    })
    .map((agent) => {
      const id = getString(agent.id)
      const mode: OpenCodeAgentOption['mode'] = getString(agent.mode) === 'all' ? 'all' : 'primary'
      const description = getString(agent.description) || null
      return {
        id,
        label: humanizeAgentID(id),
        description,
        mode
      }
    })
    .filter((option) => option.id.length > 0)
}

function humanizeAgentID(id: string): string {
  const cleaned = id.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!cleaned) return id
  return cleaned
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function getArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Failed to load OpenCode agents.'
}
