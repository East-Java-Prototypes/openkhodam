import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { useOpenCodeSdk, type createOpenCodeClient } from './opencode/client'
import { openCodeQueryKeys } from './opencode/sidecar'

type OpenCodeClient = ReturnType<typeof createOpenCodeClient>
type AgentListResponse = NonNullable<
  Awaited<ReturnType<OpenCodeClient['v2']['agent']['list']>>['data']
>
type AgentListItem = AgentListResponse extends { data: ReadonlyArray<infer Agent> } ? Agent : never
type SelectableAgentPayload = Pick<AgentListItem, 'id' | 'mode'> &
  Partial<Pick<AgentListItem, 'description' | 'hidden'>>

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
  const selectedAgent =
    options.find((option) => option.id === selectedAgentID) ?? options[0] ?? null
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
  return getAgentListItems(data)
    .filter(isSelectableAgent)
    .map((agent) => {
      const mode: OpenCodeAgentOption['mode'] = agent.mode === 'all' ? 'all' : 'primary'
      const description = readStringProperty(agent, 'description') || null
      return {
        id: agent.id,
        label: humanizeAgentID(agent.id),
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

function getAgentListItems(data: AgentListResponse | undefined): AgentListItem[] {
  return Array.isArray(data?.data) ? [...data.data] : []
}

function isSelectableAgent(agent: unknown): agent is SelectableAgentPayload {
  const id = readStringProperty(agent, 'id')
  const mode = readStringProperty(agent, 'mode')
  return id.length > 0 && readBooleanProperty(agent, 'hidden') !== true && isSelectableMode(mode)
}

function isSelectableMode(mode: string): mode is OpenCodeAgentOption['mode'] {
  return mode === 'primary' || mode === 'all'
}

function readStringProperty(value: unknown, property: string): string {
  const propertyValue = readProperty(value, property)
  return typeof propertyValue === 'string' ? propertyValue : ''
}

function readBooleanProperty(value: unknown, property: string): boolean | null {
  const propertyValue = readProperty(value, property)
  return typeof propertyValue === 'boolean' ? propertyValue : null
}

function readProperty(value: unknown, property: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined
  return (value as { [key: string]: unknown })[property]
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Failed to load OpenCode agents.'
}
